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
  await new Promise<void>((resolve) => server.listen(3002, resolve));
  const baseUrl = "http://localhost:3002";

  try {
    // 1. Healthcheck
    const health = await fetch(`${baseUrl}/health`).then((r) => r.json());
    console.log(`✅ Healthcheck: ${health.status} (${health.service})`);

    // 2. Customer Login (FR-1.2)
    console.log("\nStep 1: Logging in as verified customer...");
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
      `✅ Customer Logged in! JWT Token: ${customerToken.substring(0, 30)}...`,
    );

    // 3. Search Available Vehicles near Berlin Center (FR-2)
    console.log(
      "\nStep 2: Searching available vehicles near Berlin Alexanderplatz...",
    );

    // Use dynamic dates 40 days in the future to avoid colliding with any previous tests
    const futureOffset = 40;
    const startTime = new Date(
      Date.now() + 86400000 * futureOffset,
    ).toISOString();
    const endTime = new Date(
      Date.now() + 86400000 * (futureOffset + 3),
    ).toISOString();

    const searchUrl = `${baseUrl}/api/v1/vehicles/search?latitude=52.5200&longitude=13.4050&radiusKm=50&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      throw new Error(
        `Search API failed with status ${searchRes.status}: ${JSON.stringify(searchData)}`,
      );
    }

    if (!searchData.vehicles || searchData.vehicles.length === 0) {
      throw new Error("No available vehicles found matching the query.");
    }

    console.log(`✅ Found ${searchData.count} available vehicles:`);
    searchData.vehicles.forEach((v: any) => {
      console.log(
        `   - ${v.make} ${v.model} (${v.category}) @ €${v.base_daily_rate}/day [${v.distance_km} km away]`,
      );
    });

    const chosenCar = searchData.vehicles[0];

    // 4. Create Booking Hold via REST API (FR-3.1)
    console.log(
      `\nStep 3: Creating reservation hold for ${chosenCar.make} ${chosenCar.model}...`,
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
        startTime,
        endTime,
        addOns: ["GPS_NAVIGATION", "INSURANCE_PREMIUM"],
      }),
    });

    const holdData = await holdRes.json();
    if (!holdRes.ok)
      throw new Error(`Hold failed: ${JSON.stringify(holdData)}`);
    console.log(
      `✅ Hold created: Ref ${holdData.booking_reference} | Total: €${holdData.total_price}`,
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
        body: JSON.stringify({ paymentIntentId: "pi_test_confirmed_3002" }),
      },
    );

    const confirmData = await confirmRes.json();
    if (!confirmRes.ok)
      throw new Error(`Confirm failed: ${JSON.stringify(confirmData)}`);
    console.log(`✅ Reservation Confirmed! Status: ${confirmData.status}`);

    // 6. Test Fleet Admin Live Map Access (FR-11.1, FR-12.1)
    console.log("\nStep 5: Testing Fleet Admin RBAC Live Map Access...");
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
      `✅ Fleet Admin Map authorized: ${mapData.fleet.length} active vehicle markers loaded.`,
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
