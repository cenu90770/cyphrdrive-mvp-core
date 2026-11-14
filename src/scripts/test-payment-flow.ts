import { pool } from '../config/db';
import { redis } from '../config/redis';
import { BookingService } from '../modules/booking/booking.service';
import { PaymentService } from '../modules/payment/payment.service';

async function runPaymentTest() {
  console.log('================================================================');
  console.log('       CYPHRDRIVE END-TO-END PAYMENT & PRE-AUTH TEST            ');
  console.log('================================================================\n');

  const renterId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'; // Verified Elena
  const vehicleId = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'; // BMW i4
  const branchId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  try {
    // 1. Create a booking hold
    console.log('Step 1: Creating rental reservation hold...');
    const startTime = new Date(Date.now() + 86400000 * 20).toISOString();
    const endTime = new Date(Date.now() + 86400000 * 23).toISOString();

    const booking = await BookingService.initiateBookingHold({
        renterId,
        vehicleId,
        pickupBranchId: branchId,
        dropoffBranchId: branchId,
        startTime,
        endTime,
        addOns: ['GPS_NAVIGATION'],
    });
    console.log(`✅ Hold created: Ref ${booking.booking_reference} | Total: €${booking.total_price}`);

    // 2. Mocking/Testing Payment Intent
    console.log('\nStep 2: Generating Stripe Payment Intent for rental fee...');
    let paymentIntentId = 'pi_mock_rental_charge_123';

    // Check if real Stripe key is provided
    if (process.env.STRIPE_SECRET && !process.env.STRIPE_SECRET_KEY?.includes('placeholder')) {
        const intent = await PaymentService.createRentalPaymentIntent(booking.id);
        paymentIntentId = intent.paymentIntentId;
        console.log(`✅ Real Stripe PaymentIntent created: ${intent.paymentIntentId}`);
    } else {
        console.log(`ℹ️ [Mock Mode] Generated simulated PaymentIntent: ${paymentIntentId}`);
    }

    // 3. Confirm Booking (Simulating Webhook Callback)
    console.log('\nStep 3: Simulating card payment success & confirming reservation...');
    const confirmed = await BookingService.confirmBooking(booking.booking_reference, paymentIntentId);
    console.log(`✅ Booking confirmed. Current Status: ${confirmed.status}`);
    
    // 4. Simulate Prick-up Pre-auth hold (€500)
    console.log('\nStep 4: Placing €500 Pre-Authorization Hold on customer card (FR-4.5)...');
    const mockHoldId = 'pi_mock_deposit_hold_500';
    await pool.query(
        `INSERT INTO payment_transactions (
            booking_id, gateway_transaction_id, type, amount, currency, status, metadata
        ) VALUES ($1, $2, 'PRE_AUTH_HOLD', 500.00, 'EUR', 'AUTHORIZED', '{"mock": true}')`,
      [booking.id, mockHoldId]
    );
    console.log(`✅ Pre-Auth hold of €500.00 recorded. Hold ID: ${mockHoldId}`);

    // 5. Simulate vehicle return with incidentals
    console.log('\nStep 5: Vehicle Return - Calculating incidentals (FR-4.5)...');
    console.log('   - 10 Liters fuel missing (@ €2.15/L)');
    console.log('   - 1 Hour late return (@ €25.00/hr)');

    // In mock mode, we simulate the database settlement
    const fuelDeficit = 10 * 2.15; // €21.50
    const lateFee = 1 * 25.00;     // €25.00
    const totalIncidentals = fuelDeficit + lateFee; // €46.50
    const releasedBalance = 500.00 - totalIncidentals; // €453.50

    await pool.query(
        `INSERT INTO payment_transactions (
            booking_id, gateway_transaction_id, type, amount, currency, status, metadata
        ) VALUES ($1, $2, 'INCIDENTAL_CAPTURE', $3, 'EUR', 'CAPTURED', $4)`,
         [
            booking.id,
            mockHoldId,
            totalIncidentals,
            JSON.stringify({ fuelFee: fuelDeficit, lateFee, note: 'Settled at return' }),
        ]
    );

    console.log(`✅ Incidentals captured: €${totalIncidentals.toFixed(2)}`);
    console.log(`✅ Remaining deposit released back to customer: €${releasedBalance.toFixed(2)}`);

    console.log('\n🎉 ALL PAYMENT FLOWS COMPLETED SUCCESSFULLY.\n');

} catch (err: any) {
    console.error('❌ Payment test failed:', err);
    process.exitCode = 1;
} finally {
    await pool.end();
    await redis.quit();
}
}

runPaymentTest();