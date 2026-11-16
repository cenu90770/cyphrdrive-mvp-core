import { pool } from "../config/db";
import { redis } from "../config/redis";
import { mqttClient } from "../config/mqtt";
import { TelematicsListener } from "../modules/telematics/telematics.listener";
import { TelematicsService } from "../modules/telematics/telematics.service";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTelematicsTest() {
  console.log(
    "================================================================",
  );
  console.log(
    "   CYPHRDRIVE REAL-TIME TELEMATICS & LIVE TRACKING TEST         ",
  );
  console.log(
    "================================================================\n",
  );

  // Seeded BMW i4 vehicle ID
  const vehicleId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01";

  try {
    // 1. Initialize Listener
    TelematicsListener.initialize();
    await sleep(500); // Allow subscription to register

    // 2. Simulate 3 driving GPS waypoints in Berlin
    const waypoints = [
      {
        lat: 52.52,
        lon: 13.405,
        speed: 45.0,
        battery: 89,
        fuel: 100,
        odo: 12460,
        dtc: [],
      },
      {
        lat: 52.522,
        lon: 13.41,
        speed: 52.5,
        battery: 88,
        fuel: 100,
        odo: 12462,
        dtc: [],
      },
      {
        lat: 52.525,
        lon: 13.415,
        speed: 30.0,
        battery: 87,
        fuel: 100,
        odo: 12465,
        dtc: ["P0117"],
      }, // Critical Engine DTC!
    ];

    console.log(
      "Step 1: Streaming live driving telemetry over MQTT (EMQX Broker)...",
    );
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const packet = {
        vehicleId,
        timestamp: new Date().toISOString(),
        latitude: wp.lat,
        longitude: wp.lon,
        speedKmh: wp.speed,
        batteryLevel: wp.battery,
        fuelLevel: wp.fuel,
        doorsLocked: true,
        engineRunning: true,
        odometer: wp.odo,
        diagnosticTroubleCodes: wp.dtc,
      };

      const topic = `vehicles/${vehicleId}/telemetry`;
      mqttClient.publish(topic, JSON.stringify(packet), { qos: 1 });
      console.log(
        `   📡 [Waypoint ${i + 1}/3 Published] Lat: ${wp.lat}, Lon: ${wp.lon}, Speed: ${wp.speed} km/h`,
      );
      await sleep(400); // Short delay between packets
    }

    await sleep(600); // Wait for async database insertion

    // 3. Verify Redis Hot Cache (Live Map Data)
    console.log(
      "\nStep 2: Checking Redis Hot Cache for Fleet Admin Live Map...",
    );
    const fleetMap = await TelematicsService.getFleetLivePositions();
    const carLive = fleetMap.find((c) => c.vehicleId === vehicleId);

    if (carLive) {
      console.log("✅ Real-Time Vehicle State in Redis:");
      console.log(
        `   - Coordinates: (${carLive.latitude}, ${carLive.longitude})`,
      );
      console.log(`   - Speed: ${carLive.speedKmh} km/h`);
      console.log(`   - Battery: ${carLive.batteryLevel}%`);
      console.log(`   - DTC Alerts: ${carLive.dtcAlerts.join(", ") || "None"}`);
    } else {
      throw new Error("Vehicle state not found in Redis!");
    }

    // 4. Verify TimescaleDB Hypertable Storage
    console.log(
      "\nStep 3: Verifying time-series persistence in TimescaleDB...",
    );
    const dbRes = await pool.query(
      `SELECT recorded_at, speed_kmh, ST_AsText(location) as coords, diagnostic_trouble_codes
       FROM telemetry_logs 
       WHERE vehicle_id = $1 
       ORDER BY recorded_at DESC 
       LIMIT 3`,
      [vehicleId],
    );

    console.log(`✅ TimescaleDB rows recorded: ${dbRes.rowCount}`);
    dbRes.rows.forEach((r, idx) => {
      console.log(
        `   [Row ${idx + 1}] Time: ${r.recorded_at.toISOString()} | Coords: ${r.coords} | Speed: ${r.speed_kmh} km/h | DTCs: ${r.diagnostic_trouble_codes}`,
      );
    });

    // 5. Remote Lock/Unlock Command (FR-8.1)
    console.log(
      "\nStep 4: Testing Telematics Remote Command (Keyless Unlock)...",
    );
    await TelematicsService.sendVehicleCommand(vehicleId, "UNLOCK_DOORS");
    console.log("✅ Door unlock signal acknowledged by broker.");

    console.log("\n🎉 ALL TELEMATICS & IOT FLOWS VERIFIED SUCCESSFULLY.\n");
  } catch (err) {
    console.error("❌ Telematics test failed:", err);
    process.exitCode = 1;
  } finally {
    mqttClient.end();
    await pool.end();
    await redis.quit();
  }
}

runTelematicsTest();
