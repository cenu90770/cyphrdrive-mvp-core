import { pool } from '../../config/db';
import { stripe } from '../../config/stripe';
import { BookingDomainError } from '../booking/booking.errors';
import { IncidentalFeeInput, IncidentalCalculationResult, IncidentalFeeSchema } from './payment.types';

export class PaymentService {
    private static readonly CURRENCY = (process.env.STRIPE_CURRENCY) || 'eur';

    /**
     * Helper: converts EUR to Cents for stripe (e.g. 10.50 -> 1050)
     */
    private static toCents(amount: number): number {
        return Math.round(amount * 100);
    }

    /**
     * Helper: converts Cents to EUR (e.g. 1050 -> 10.50)
     */
    private static toEuros(cents: number): number {
        return parseFloat((cents / 100).toFixed(2));
    }

    /**
     * STEP 1: Create rental fee payment intent (FR-4.1)
     * generates a client_secret for the frontend checkout.
     */
    public static async createRentalPaymentIntent(bookingId: string): Promise<{
        clientSecret: string;
        paymentIntentId: string;
        amount: number
    }> {

        const bookingRes = await pool.query(
            `SELECT id, total_price, booking_reference, renter_id FROM bookings WHERE id = $1`,
            [bookingId]
        );

        if (bookingRes.rows.length === 0) {
            throw new BookingDomainError(`Booking with ID ${bookingId} not found`, 404);
        }

        const booking = bookingRes.rows[0];
        const amountInCents = this.toCents(parseFloat(booking.total_price));

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: this.CURRENCY,
            capture_method: 'automatic', // immediate settlement upon card authentication
            metadata: {
                bookingId: booking.id,
                bookingReference: booking.booking_reference,
                renterId: booking.renter_id,
                transactionType: 'RENTAL_CHARGE',
            },
        });

        // Record pending transaction
        await pool.query(
            `INSERT INTO payment_transactions (
                booking_id, gateway_transaction_id, type, amount, currency, status, metadata
            ) VALUES ($1, $2, 'CARD', $3, $4, 'REQUIRES_PAYMENT_METHOD', $5)`,
            [
                booking.id,
                paymentIntent.id,
                booking.total_price,
                this.CURRENCY.toUpperCase(),
                JSON.stringify({ clientSecret: paymentIntent.client_secret})
            ]
        );

        return {
            clientSecret: paymentIntent.client_secret!,
            paymentIntentId: paymentIntent.id,
            amount: parseFloat(booking.total_price),
        };
    }

    /**
     * STEP 2: Pre-authorize security deposit hold (FR-4.5)
     * Places a manual-capture authorization hold (e.g., €500.00)
     */
    public static async createSecurityDepositHold(
        bookingId: string,
        paymentMethodId: string
    ): Promise<{ holdId: string; amount: number }> {

        const bookingRes = await pool.query(
            `SELECT id, security_deposit, booking_reference, renter_id FROM bookings WHERE id = $1`,
            [bookingId]
        );
        
        if (bookingRes.rowCount === 0) {
            throw new BookingDomainError(`Booking with ID ${bookingId} not found`, 404);
        }

        const booking = bookingRes.rows[0];
        const depositAmount = parseFloat(booking.security_deposit);
        const amountInCents = this.toCents(depositAmount);

        // manual capture = PRE-AUTH HOLD
        const holdIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: this.CURRENCY,
            payment_method: paymentMethodId,
            capture_method: 'manual',
            confirm: true,
            off_session: true, // server-initiated hold prior to vehicle handover
            metadata: {
                bookingId: booking.id,
                bookingReference: booking.booking_reference,
                transactionType: 'SECURITY_DEPOSIT_HOLD',
            },
        });

        // Record payment transaction
        await pool.query(
            `INSERT INTO payment_transactions (
                booking_id, gateway_transaction_id, type, amount, currency, status, metadata
            ) VALUES ($1, $2, 'PRE_AUTH_HOLD', $3, $4, 'AUTHORIZED', $5)`,
            [
                booking.id,
                holdIntent.id,
                depositAmount,
                this.CURRENCY.toUpperCase(),
                JSON.stringify({ status: holdIntent.status }),
            ]
        );

        return { holdId: holdIntent.id, amount: depositAmount };
    }

    /**
     * STEP 3: Settle incidentals & release balance (FR-4.5)
     * Captures damage/fuel/late fees from the pre-auth hold and cancels the remainders.
     */
    public static async settleIncidentalsAndReleaseHold(rawInput: IncidentalFeeInput): Promise<IncidentalCalculationResult> {
        const input = IncidentalFeeSchema.parse(rawInput);

        // 1. Calculate Incidental fees
        const fuelFee = parseFloat((input.fuelDeficitLiter * input.fuelPricePerLiter).toFixed(2));
        const lateFee = parseFloat((input.lateReturnHours * input.lateHourlyRate).toFixed(2));
        const damageFee = parseFloat(input.damageAssignmentAmount.toFixed(2));
        const totalIncidentalFee = parseFloat((fuelFee + lateFee + damageFee).toFixed(2));

        // 2. Fetch the active deposit hold
        const txRes = await pool.query(
            `SELECT gateway_transaction_id, amount
                FROM payment_transactions
                WHERE booking_id = $1 AND type = 'PRE_AUTH_HOLD' AND status = 'AUTHORIZED'
                ORDER BY created_at DESC LIMIT 1`,
            [input.bookingId]
        );

        if (txRes.rowCount === 0) {
            throw new BookingDomainError(`No active authorized security deposit found for booking ${input.bookingId}.`);
        }

        const { gateway_transaction_id: holdId, amount: authorizedDeposit } = txRes.rows[0];
        const authorizedAmount = parseFloat(authorizedDeposit);

        if (totalIncidentalFee > authorizedAmount) {
            throw new BookingDomainError(`
                Incidentals (${this.CURRENCY} ${totalIncidentalFee}) exceeded authorized deposit (${authorizedAmount})
            `);
        }

        const amountToRelease = parseFloat((authorizedAmount - totalIncidentalFee).toFixed(2));

        // 3. Capture incidental amount (if any) or release entire hold.
        if (totalIncidentalFee > 0) {
            // Partial capture captures the specified amount and automatically releases the rest
            await stripe.paymentIntents.capture(holdId, {
                amount_to_capture: this.toCents(totalIncidentalFee),
            });

            // Record payment transaction
            await pool.query(
                `INSERT INTO payment_transactions (
                    booking_id, gateway_transaction_id, type, amount, currency, status, metadata
                ) VALUES ($1, $2, 'INCIDENTAL_CAPTURE', $3, $4, 'CAPTURED', $5)`,
                 [
                    input.bookingId,
                    holdId,
                    totalIncidentalFee,
                    this.CURRENCY.toUpperCase(),
                    JSON.stringify({ fuelFee, lateFee, damageFee, remarks: input.remarks }),
                 ]
            );
        } else {
            // No incidentals: cancel authorization entirely to release 100% of the funds.
            await stripe.paymentIntents.cancel(holdId);
        }

        // Mark pre-auth hold record setteled
        await pool.query(
            `UPDATE payment_transactions SET status = 'CAPTURED' WHERE gateway_transaction_id = $1`,
            [holdId]
        );

        return {
            fuelFee,
            lateFee,
            damageFee,
            totalIncidentalFee,
            amountToRelease,
        };
    }

    /**
     * STEP 4: Process automated refunds (FR-4.4)
     */
    public static async processRefund(
        bookingId: string,
        refundAmount?: number,
        reason?: 'requested_by_customer' | 'fraudulent' | 'duplicate',
    ): Promise<{ refundId: string; amountToRefund: number }> {

        reason = reason || 'requested_by_customer';

        const txRes = await pool.query(
            `SELECT gateway_transaction_id, amount
                FROM payment_transactions
                WHERE booking_id = $1 AND type = 'CARD' AND status = 'CAPTURED'
                ORDER BY created_at DESC LIMIT 1`,
            [bookingId]
        );

        if (txRes.rowCount === 0) {
            throw new BookingDomainError(
                `No captured card charge found for booking with ID ${bookingId}.`, 
                404
            );
        }

        const { gateway_transaction_id: paymentIntentId, amount: chargedAmount } = txRes.rows[0];
        const finalRefundAmount = refundAmount ? refundAmount : parseFloat(chargedAmount);

        const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            amount: this.toCents(finalRefundAmount),
            reason,
        });

        await pool.query(
            `INSERT INTO payment_transactions (
                booking_id, gateway_transaction_id, type, amount, currency, status, metadata
            ) VALUES ($1, $2, 'REFUND', $3, $4, 'REFUNDED', $5)`,
            [
                bookingId,
                refund.id,
                finalRefundAmount,
                this.CURRENCY.toUpperCase(),
                JSON.stringify({ stripeRefundId: refund.id, reason })
            ]
        );

        return {
            refundId: refund.id,
            amountToRefund: finalRefundAmount,
        };
    }
}