import { BookingService } from '../modules/booking/booking.service';
import { pool } from '../config/db';
import { redis } from '../config/redis';

async function runConcurrencyTest() {
  console.log('================================================================');
  console.log('   CYPHRDRIVE CONCURRENCY TEST: ANTI-DOUBLE-BOOKING GUARD       ');
  console.log('================================================================\n');

  // Seeded verified user, vehicle (BMW i4), and Berlin branch office
  const renterId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'; // Verified Customer Elena
  const vehicleId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'; // BMW i4
  const branchId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';  // Central Station Hub

  try {
    // 1. PRE-FLIGHT CHECK: Ensure Seed Data exists
    const userCheck = await pool.query(`SELECT id, kyc_status FROM users WHERE id = $1`, [renterId]);
    if (userCheck.rows.length === 0) {
        console.error('❌ SEED DATA MISSING: Test user not found in database!');
        console.error('👉 Run: docker compose down -v && docker compose up -d');
        process.exit(1);
    }

    // 2. IDEMPOTENT PURGE: Clean any previous test bookings for this vehicle
    console.log('🧹 Cleaning previous test runs for vehicle...');
    await pool.query('DELETE FROM bookings WHERE vehicle_id = $1', [vehicleId]);
    await redis.del(`lock:vehicle:${vehicleId}`);


    // Generate a unique dynamic future window (e.g. 10 to 14 days from now)
    const randomOffset = Math.floor(Math.random() * 100) + 5;
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000 * randomOffset).toISOString();
    const endTime = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000 * (randomOffset + 3)).toISOString();
    
    console.log(`Target vehicle:    ${vehicleId}\n`);
    console.log(`Rental Window:     ${startTime} -> ${endTime}\n`);
    console.log(`Simulation:        Firing 5 concurrent threads at the same instant..\n`);
    console.log('================================================================\n');

    // 3. EXECUTE 5 CONCURRENT REQUESTS
    const attempts = [1, 2, 3, 4, 5].map((workerId) => {
        return BookingService.initiateBookingHold({
            renterId,
            vehicleId,
            pickupBranchId: branchId,
            dropoffBranchId: branchId,
            startTime,
            endTime,
            addOns: workerId % 2 === 0 ? ['GPS_NAVIGATION', 'INSURANCE_PREMIUM'] : [], // Randomly assign add-ons
        }).then((booking) => ({
            workerId,
            status: 'SUCCESS' as const,
            reference: booking.booking_reference,
            total: booking.total_price,
        })).catch((err) => ({
            workerId,
            status: 'REJECTED' as const,
            error: err.message,
            errorType: err.name,
        }));
    });

    const results = await Promise.all(attempts);
    console.log('======= EXECUTION RESULTS ========');

    results.forEach((r) => {
        if (r.status === 'SUCCESS') {
            console.log(`[Thread ${r.workerId}] 🟢 ACQUIRED HOLD -> Ref: ${r.reference} | Total: €${r.total}`);
        } else {
            console.log(`[Thread ${r.workerId}] 🔴 REJECTED      -> Error: ${r.error}`);
        }
	});

	const successCount = results.filter(r => r.status === 'SUCCESS').length;
	const rejectedCount = results.filter(r => r.status === 'REJECTED').length;

    console.log('\n===================== SUMMARY ============================');
	console.log(`Total Attempts: ${results.length}`);
	console.log(`Total Successful Holds: ${successCount} (Must be exactly 1)`);
	console.log(`Total Rejected Attempts: ${rejectedCount} (Must be exactly 4)`);
	console.log('============================================================');

    if (successCount === 1 && rejectedCount === 4) {
        const winning = results.find((r) => r.status === 'SUCCESS') as any;
        console.log(`\n✅ PASS: Double-booking mathematically prevented.`);

        // Test confirming the winner
        console.log(`\nTesting Confirmation Phase for Reference: ${winning.reference}...`);
        const confirmed = await BookingService.confirmBooking(winning.reference, 'ch_stripe_mock_123456');
        console.log(`🎉 Booking ${confirmed.booking_reference} confirmed with status: ${confirmed.status}`);
	} else {
        console.error('\n❌ FAIL: Race condition allowed double-booking!');
        process.exitCode = 1;
    }

  } catch (error) {
    console.error('Fatal test error:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
    await redis.quit();
  }

}

runConcurrencyTest();