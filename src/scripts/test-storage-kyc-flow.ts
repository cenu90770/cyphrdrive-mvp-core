import { pool } from "../config/db";
import { redis } from "../config/redis";
import { KycService } from "../modules/kyc/kyc.service";
import { InspectionService } from "../modules/inspection/inspection.service";

async function runStorageKycTest() {
  console.log(
    "================================================================",
  );
  console.log(
    "       CYPHRDRIVE KYC & DIGITAL INSPECTION TEST                 ",
  );
  console.log(
    "================================================================\n",
  );

  const unverifiedUserId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a04"; // Jan Mueller
  const fleetAdminId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02"; // Marcus Lindner

  try {
    // -------------------------------------------------------------
    // PART 1: KYC LICENSE UPLOAD & VERIFICATION (FR-1.4)
    // -------------------------------------------------------------
    console.log(
      "Step 1: Requesting S3 Pre-Signed Upload URLs for Driver License...",
    );
    const frontUpload = await KycService.requestLicenseUploadUrl(
      unverifiedUserId,
      "FRONT",
    );
    const backUpload = await KycService.requestLicenseUploadUrl(
      unverifiedUserId,
      "BACK",
    );

    console.log(
      `✅ Front Upload URL generated:\n   -> ${frontUpload.uploadUrl.substring(0, 90)}...`,
    );
    console.log(
      `✅ Back Upload URL generated:\n   -> ${backUpload.uploadUrl.substring(0, 90)}...`,
    );

    console.log(
      "\nStep 2: Submitting uploaded document keys for verification...",
    );
    const futureExpDate = new Date(Date.now() + 86400000 * 365).toISOString(); // 1 year validity
    await KycService.submitLicenseForVerification(
      unverifiedUserId,
      frontUpload.fileKey,
      backUpload.fileKey,
      futureExpDate,
    );

    console.log(
      "\nStep 3: Simulating identity validation webhook (Persona/Onfido)...",
    );
    await KycService.processKycProviderWebhook(unverifiedUserId, "APPROVED");

    // Confirm DB status is now VERIFIED
    const checkUser = await pool.query(
      "SELECT kyc_status, kyc_verified_at FROM users WHERE id = $1",
      [unverifiedUserId],
    );
    console.log(
      `🎉 User KYC Status in Database: ${checkUser.rows[0].kyc_status} (Verified At: ${checkUser.rows[0].kyc_verified_at})`,
    );

    // -------------------------------------------------------------
    // PART 2: 4-WAY DIGITAL INSPECTION CHECKLIST (FR-8.1)
    // -------------------------------------------------------------
    console.log(
      "\nStep 4: Requesting 4-way inspection photo URLs for vehicle handover...",
    );
    const dummyBookingId = "11111111-2222-3333-4444-555555555555";

    // Create a mock confirmed booking for inspection reference
    await pool.query(
      `
      INSERT INTO bookings (
        id, booking_reference, renter_id, vehicle_id, pickup_branch_id, dropoff_branch_id,
        start_time, end_time, status, base_price, total_price, security_deposit
      ) VALUES (
        $1, 'CD-INSPECT', $2, 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01',
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        NOW(), NOW() + INTERVAL '2 days', 'ACTIVE', 100.00, 119.00, 500.00
      ) ON CONFLICT (id) DO NOTHING;
    `,
      [dummyBookingId, unverifiedUserId],
    );

    const inspectionUrls = await InspectionService.getInspectionUploadUrls(
      dummyBookingId,
      "RETURN",
    );
    console.log("✅ Generated 4-way Pre-Signed S3 Upload targets:");
    Object.keys(inspectionUrls.urls).forEach((angle) => {
      console.log(
        `   - [${angle.toUpperCase()}]: ${inspectionUrls.urls[angle].substring(0, 70)}...`,
      );
    });

    console.log(
      "\nStep 5: Logging completed return inspection checklist (FR-7.3)...",
    );
    const inspection = await InspectionService.recordInspection({
      bookingId: dummyBookingId,
      inspectorId: fleetAdminId,
      type: "RETURN",
      odometerReading: 14250,
      fuelPercentage: 100,
      photoKeys: inspectionUrls.fileKeys as any,
      remarks: "Returned in pristine condition. No scratches, clean interior.",
    });

    console.log(`✅ Inspection record created with ID: ${inspection.id}`);
    console.log(`   - Type: ${inspection.type}`);
    console.log(`   - Odometer: ${inspection.odometer_reading} km`);
    console.log(`   - Fuel: ${inspection.fuel_percentage}%`);

    console.log("\n🚀 ALL KYC AND STORAGE FLOWS VERIFIED SUCCESSFULLY.\n");
  } catch (err) {
    console.error("❌ KYC/Storage Test Failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
    await redis.quit();
  }
}

runStorageKycTest();
