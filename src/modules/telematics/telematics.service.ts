import { pool } from "../../config/db";
import { redis } from "../../config/redis";
import { mqttClient } from "../../config/mqtt";
import {
  TelemetryPayload,
  TelemetryPayloadSchema,
  VehicleLiveState,
  CRITICAL_DTC_MAP,
} from "./telematics.types";

export class TelemetryService {
  private static readonly HOT_STATE_PREFIX = "vehicle:live:";

  /**
   * INGEST: Dual-write pipeline (Redis Hot State + TimescaleDB Hypertable)
   */
  public static async ingestTelemetry(rawPayload: unknown): Promise<void> {
    const data = TelemetryPayloadSchema.parse(rawPayload);
    const recordedAt = new Date(data.timestamp);

    // FAST PATH: Update Redis Hot State for Fleet Admin Live Map
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

  public static async getFleetLivePositions(): Promise<VehicleLiveState[]> {
    const keys = await redis.keys(`${this.HOT_STATE_PREFIX}*`);
    if (keys.length === 0) return [];

    const states = await redis.mget(keys);
    return states
      .filter((s): s is string => s !== null)
      .map((s) => JSON.parse(s) as VehicleLiveState);
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
      mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to publish command to ${topic}:`, err);
          return reject(err);
        }
        console.log(`📡 [MQTT Command Sent] ${command} -> Topic: ${topic}`);
        resolve(true);
      });
    });
  }
}
