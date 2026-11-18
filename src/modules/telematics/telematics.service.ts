import { pool } from "../../config/db";
import { redis } from "../../config/redis";
import { mqttClient } from "../../config/mqtt";
import {
  TelemetryPayload,
  TelemetryPayloadSchema,
  VehicleLiveState,
  CRITICAL_DTC_MAP,
} from "./telematics.types";

export class TelematicsService {
  private static readonly HOT_STATE_PREFIX = "vehicle:live:";

  /**
   * INGEST: Dual-write pipeline (Redis Hot State + TimescaleDB Hypertable)
   */
  public static async ingestTelemetry(rawPayload: unknown): Promise<void> {
    const data = TelemetryPayloadSchema.parse(rawPayload);
    const recordedAt = new Date(data.timestamp);

    // 1. FAST PATH: Update Redis Hot State for Fleet Admin Live Map
    const hotStateKey = `${this.HOT_STATE_PREFIX}${data.vehicleId}`;
    const liveState: VehicleLiveState = {
      vehicleId: data.vehicleId,
      latitude: data.latitude,
      longitude: data.longitude,
      speedKmh: data.speedKmh,
      batteryLevel: data.batteryLevel,
      fuelLevel: data.fuelLevel,
      doorsLocked: data.doorsLocked,
      engineRunning: data.engineRunning,
      odometer: data.odometer,
      dtcAlerts: data.diagnosticTroubleCodes,
      lastUpdated: recordedAt.toISOString(),
    };

    // Store latest state with 24h TTL
    await redis.set(hotStateKey, JSON.stringify(liveState), "EX", 86400);

    // Publish to Redis PuSub for real-time WebSocket broadcasting
    await redis.publish("fleet:live:stream", JSON.stringify(liveState));

    // 2. TIME-SERIES PATH: Persist into TimescaleDB Hypertable
    // Note: PostGIS ST_MakePoint uses (longitude, latitude) order
    const insertQuery = `
      INSERT INTO telemetry_logs (
        recorded_at, vehicle_id, location, speed_kmh, battery_level,
        fuel_level, doors_locked, engine_running, odometer, diagnostic_trouble_codes
      ) VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, $9, $10, $11)
    `;

    await pool.query(insertQuery, [
      recordedAt,
      data.vehicleId,
      data.longitude,
      data.latitude,
      data.speedKmh,
      data.batteryLevel ?? null,
      data.fuelLevel ?? null,
      data.doorsLocked,
      data.engineRunning,
      data.odometer,
      data.diagnosticTroubleCodes,
    ]);

    // 3. ALERT ENGINE: Check for critical OBD-II Codes (FR-11.1)
    await this.evaluateDiagnosticCodes(
      data.vehicleId,
      data.diagnosticTroubleCodes,
    );
  }

  private static async evaluateDiagnosticCodes(
    vehicleId: string,
    codes: string[],
  ): Promise<void> {
    const criticalDetected = codes.filter((c) => CRITICAL_DTC_MAP[c]);

    if (criticalDetected.length > 0) {
      console.warn(
        `🚨 [DTC ALERT] Vehicle ${vehicleId} emitted critical diagnostics: ${criticalDetected.join(", ")}`,
      );
    }

    // Log alert in audit trail (NFR-7.1)
    await pool.query(
      `INSERT INTO audit_logs (
        actor_role, action, resource_type, resource_id, id_address, changes
      ) VALUES ('TELEMATICS_SYSTEM', 'CRITICAL_DTC_ALERT', 'VEHICLE', $1, '127.0.0.1', $2)`,
      [
        vehicleId,
        JSON.stringify({
          detectedCodes: criticalDetected,
          descriptions: criticalDetected.map((c) => CRITICAL_DTC_MAP[c]),
        }),
      ],
    );
  }

  /**
   * LIVE MAP QUERY: Fetches from Redis. If Redis is cold, selft-heals from PostgreSQL.
   * @returns
   */
  public static async getFleetLivePositions(): Promise<VehicleLiveState[]> {
    const keys = await redis.keys(`${this.HOT_STATE_PREFIX}*`);

    // HOT-CACHE PATH: Return from Redis
    if (keys.length > 0) {
      const states = await redis.mget(keys);
      return states
        .filter((s): s is string => s !== null)
        .map((s) => JSON.parse(s) as VehicleLiveState);
    }

    // COLD-CACHE FALLBACK: Read latest telemetry or branch locations from PostgreSQL
    console.log(
      "[TelemetryService] Redis cache cold. Self-healing from PostgreSQL...",
    );
    const dbFallback = await pool.query(`
      SELECT DISTINCT ON (v.id)
        v.id as vehicle_id,
        COALESCE(ST_Y(t.location::geometry), ST_Y(b.location::geometry)) as latitude,
        COALESCE(ST_X(t.location::geometry), ST_X(b.location::geometry)) as longitude,
        COALESCE(t.speed_kmh, 0.0) as speed_kmh,
        COALESCE(t.battery_level, 95) as battery_level,
        COALESCE(t.fuel_level, 100) as fuel_level,
        COALESCE(t.doors_locked, true) as doors_locked,
        COALESCE(t.engine_running, false) as engine_running,
        COALESCE(t.odometer, 12000) as odometer,
        COALESCE(t.diagnostic_trouble_codes, '{}') as diagnostic_trouble_codes,
        COALESCE(t.recorded_at, NOW()) as last_updated
      FROM vehicles v
      JOIN branches b ON v.branch_id = b.id
      LEFT JOIN telemetry_logs t ON v.id = t.vehicle_id
      WHERE v.status = 'AVAILABLE'
      ORDER BY v.id, t.recorded_at DESC;
    `);

    const fallbackStates: VehicleLiveState[] = dbFallback.rows.map((r) => ({
      vehicleId: r.vehicle_id,
      latitude: r.latitude,
      longitude: r.longitude,
      speedKmh: r.speed_kmh,
      batteryLevel: r.battery_level,
      fuelLevel: r.fuel_level,
      doorsLocked: r.doors_locked,
      engineRunning: r.engine_running,
      odometer: r.odometer,
      dtcAlerts: r.diagnostic_trouble_codes,
      lastUpdated: new Date(r.last_updated).toISOString(),
    }));

    // Seed Redis so subsequent requests are instant
    for (const state of fallbackStates) {
      await redis.set(
        `${this.HOT_STATE_PREFIX}${state.vehicleId}`,
        JSON.stringify(state),
        "EX",
        86400,
      );
    }

    return fallbackStates;
  }

  /**
   * REMOTE COMMAND & CONTROL (FR-8.1): Remote Door Lock/Unlock via MQTT
   */
  public static async sendVehicleCommand(
    vehicleId: string,
    command: "LOCK_DOORS" | "UNLOCK_DOORS",
  ): Promise<boolean> {
    const topic = `vehicles/${vehicleId}/commands`;
    const payload = JSON.stringify({
      command,
      requestId: `cmd_${Date.now()}`,
      issuedAt: new Date().toISOString(),
    });

    return new Promise((resolve, reject) => {
      mqttClient.publish(topic, payload, { qos: 1 }, async (err) => {
        if (err) {
          console.error(
            `[TelemetryService] MQTT Failed to publish command to ${topic}:`,
            err,
          );
          return reject(err);
        }
        // Optimistically update hot cache
        const hotKey = `${this.HOT_STATE_PREFIX}${vehicleId}`;
        const raw = await redis.get(hotKey);
        if (raw) {
          const current = JSON.parse(raw) as VehicleLiveState;
          current.doorsLocked = command === "LOCK_DOORS";
          redis.set(hotKey, JSON.stringify(current), "EX", 86400);
        }

        console.log(
          `📡 [MQTT command dispatched] ${command} -> Topic: ${topic}`,
        );
        resolve(true);
      });
    });
  }
}
