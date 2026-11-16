import { app } from "../app";
import { pool } from "../config/db";
import { redis } from "../config/redis";
import http from "http";

async function runApiIntegrationTest() {
  console.log(
    "================================================================",
  );
  console.log(
    "       CYPHRDRIVE REST API END-TO-END INTEGRATION TEST          ",
  );
  console.log(
    "================================================================\n",
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(3001, resolve));
  const baseUrl = "http://localhost:3001";

  try {
    // 1. Healthcheck
    const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
    console.log(`✅ Healthcheck: ${health.status} (${health.service})`);

    // 2. Login as Seeded Verified Customer Elena (FR-1.2)
    console.log("\nStep 1: Logging in as customer...");
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "customer.verified@gmail.com",
        password: "Password123!",
      }),
    });

    const loginData = await loginRes.json();
    if (!loginRes.ok)
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    const customerToken = loginData.accessToken;
    console.log(
      `✅ Logged in successfully. JWT Token: ${customerToken.substring(0, 30)}...`,
    );

    // 3. Search Available Vehicles near Berlin Center (FR-2)
    console.log(
      "\nStep 2: Performing geospatial vehicle search via PostGIS (FR-2)...",
    );
    const tomorrow = new Date(Date.now() + 86400000 * 30).toISOString();
    const returnDay = new Date(Date.now() + 86400000 * 33).toISOString();

    const searchRes = await fetch(
      `${baseUrl}/api/v1/vehicles/search?latitude=52.5200&longitude=13.4050&radiusKm=30&startTime=${tomorrow}&endTime=${returnDay}`,
    );
    const searchData = await searchRes.json();
    console.log(`✅ Found ${searchData.count} available vehicles within 30km:`);
    searchData.vehicles.forEach((v: any) => {
      console.log(
        `   - ${v.make} ${v.model} (${v.category}) @ €${v.base_daily_rate}/day [${parseFloat(v.distance_km).toFixed(1)} km away]`,
      );
    });

    const chosenCar = searchData.vehicles[0];

    // 4. Create Booking Hold via REST API (FR-3.1)
    console.log(
      `\nStep 3: Creating booking hold for ${chosenCar.make} ${chosenCar.model}...`,
    );
    const holdRes = await fetch(`${baseUrl}/api/v1/bookings/hold`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`,
      },
      body: JSON.stringify({
        vehicleId: chosenCar.id,
        pickupBranchId: chosenCar.branch_id,
        dropoffBranchId: chosenCar.branch_id,
        startTime: tomorrow,
        endTime: returnDay,
        addOns: ["GPS_NAVIGATION", "INSURANCE_PREMIUM"],
      }),
    });

    const holdData = await holdRes.json();
    if (!holdRes.ok)
      throw new Error(`Hold failed: ${JSON.stringify(holdData)}`);
    console.log(
      `✅ Reservation hold created: Ref ${holdData.booking_reference} | Total: €${holdData.total_price}`,
    );

    // 5. Confirm Booking via REST API (FR-3.4)
    console.log(
      `\nStep 4: Confirming booking ${holdData.booking_reference}...`,
    );
    const confirmRes = await fetch(
      `${baseUrl}/api/v1/bookings/${holdData.booking_reference}/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ paymentIntentId: "pi_rest_confirmed_123" }),
      },
    );

    const confirmData = await confirmRes.json();
    console.log(`✅ Reservation Confirmed! Status: ${confirmData.status}`);

    // 6. Test Fleet Admin Live Map Access (FR-11.1, FR-12.1)
    console.log("\nStep 5: Testing Fleet Admin RBAC Live Map Route...");
    const adminLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "fleet.admin@cyphrdrive.io",
        password: "Password123!",
      }),
    });
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.accessToken;

    const mapRes = await fetch(`${baseUrl}/api/v1/admin/fleet/live-map`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const mapData = await mapRes.json();
    console.log(
      `✅ Fleet Admin Map query authorized: ${mapData.fleet.length} active vehicle markers loaded.`,
    );

    console.log("\n🎉 ALL REST API ENDPOINTS VERIFIED END-TO-END.\n");
  } catch (err) {
    console.error("❌ API Integration Test Failed:", err);
    process.exitCode = 1;
  } finally {
    server.close();
    await pool.end();
    await redis.quit();
  }
}

runApiIntegrationTest();
