import crypto  from 'crypto';
import { PoolClient } from 'pg';
import { pool } from '../../config/db';
import { redis } from '../../config/redis';
import {
    InitiateBookingInput,
    InitiateBookingSchema,
    BookingRecord
} from './booking.types';
import { PricingService } from './pricing.service';
import {
    VehicleNotFoundError,
    KycVerificationFailedError,
    DoubleBookingConflictError,
    BookingHoldExpiredError,
    BookingDomainError
} from './booking.errors';

export class BookingService {

    private static readonly HOLD_TTL_SECONDS = 15 * 60; // 15 minutes (FR-3.1 soft lock)

    /**
     * Generates an 8-character human-readable unique booking reference, e.g. "CD-1A2B3C4D".
     * @returns 
     */
    private static generateReference(): string {
        const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `CD-${randomHex}`;
    }

    /**
     * PHASE 1: Initiate a booking hold (FR-3.1, FR-3.5)
     * Acquires Redis distributed hold and PostrgeSQL row lock to ensure zero double-booking conflicts.
     * @param input 
     * @returns 
     * @throws VehicleNotFoundError, KycVerificationFailedError, DoubleBookingConflictError, BookingDomainError
     */
    public static async initiateBookingHold(rawInput: InitiateBookingInput): Promise<BookingRecord> {
        const input = InitiateBookingSchema.parse(rawInput);
        const startDate = new Date(input.startTime);
        const endDate = new Date(input.endTime);

        // 1. FAST PATH: check user KYC status
        const userRes = await pool.query('SELECT kyc_status FROM users WHERE id = $1', [input.renterId]);
        if (userRes.rowCount === 0 || userRes.rows[0].kyc_status !== 'VERIFIED') {
            throw new KycVerificationFailedError(input.renterId);
        }

        // 2. DISTRIBUTED LOCK: prevent near-simultaneous application threads
        const lockKey = `lock:vehicle:${input.vehicleId}`;
        const acquiredKey = await redis.set(lockKey, 'in_progress', 'EX', 10, 'NX'); // 10 seconds lock
        if (!acquiredKey) {
            throw new DoubleBookingConflictError(input.vehicleId);
        }

        const client: PoolClient = await pool.connect();

        try {
            await client.query('BEGIN');

            // 3. DATABASE ROW LOCK: lock vehicle record against concurrent transactions
            const vehicleRes = await client.query(
                `SELECT id, status, base_daily_rate
                FROM vehicles
                WHERE id = $1 FOR UPDATE`,
                [input.vehicleId]
            );

            if (vehicleRes.rowCount === 0) {
                throw new VehicleNotFoundError(input.vehicleId);
            }

            const vehicle = vehicleRes.rows[0];
            if (vehicle.status !== 'AVAILABLE') {
                throw new BookingDomainError(`Vehicle with ID ${input.vehicleId} is currently not available for booking.`, 409);
            }

            // 4. OVERLAP VERIFICATION: ensure no confirmed bookings or active holds overlap with the requested dates
            const overlapQuery = `
                SELECT id FROM bookings
                WHERE vehicle_id = $1
                AND (
                status IN ('CONFIRMED', 'ACTIVE')
                OR (status = 'HOLD_PENDING' AND hold_expires_at > NOW())
                )
                AND (start_time, end_time) OVERLAPS ($2::timestamptz, $3::timestamptz)
                LIMIT 1
            `;

            const overlapRes = await client.query(overlapQuery, [input.vehicleId, startDate, endDate]);

            if (overlapRes.rows.length > 0) {
                throw new DoubleBookingConflictError(input.vehicleId);
            }

            // 5. CALCULATE DETERMINISTIC QUOTE (FR-3.3)
            const quote = PricingService.calculateQuote(
                parseFloat(vehicle.base_daily_rate),
                startDate,
                endDate,
                input.addOns
            );

            const bookingReference = BookingService.generateReference();
            const holdExpiresAt = new Date(Date.now() + BookingService.HOLD_TTL_SECONDS * 1000);

            // 6. INSERT DRAFT BOOKING RECORD
            const insertQuery = `
                INSERT INTO bookings (
                    booking_reference,
                    renter_id,
                    vehicle_id,
                    pickup_branch_id,
                    dropoff_branch_id,
                    start_time,
                    end_time,
                    status,
                    base_price,
                    add_ons_price,
                    taxes_fees,
                    total_price,
                    security_deposit,
                    add_ons,
                    hold_expires_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'HOLD_PENDING', $8, $9, $10, $11, $12, $13, $14)
                RETURNING *
            `;

            const insertRes = await client.query<BookingRecord>(insertQuery, [
                bookingReference,
                input.renterId,
                input.vehicleId,
                input.pickupBranchId,
                input.dropoffBranchId,
                startDate,
                endDate,
                quote.baseTotal.toFixed(2),
                quote.addOnsTotal.toFixed(2),
                quote.taxAmount.toFixed(2),
                quote.totalPrice.toFixed(2),
                quote.securityDeposit.toFixed(2),
                JSON.stringify(quote.addOnsBreakdown),
                holdExpiresAt
            ]);

            await client.query('COMMIT');

            // 7. STORE HOLD IN REDIS FOR 15 MINUTES (FR-3.1)
            const redisKey = `booking:hold:${input.vehicleId}:${bookingReference}`;
            await redis.set(redisKey, insertRes.rows[0].id, 'EX', this.HOLD_TTL_SECONDS);

            return insertRes.rows[0];
        
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
            await redis.del(lockKey); // Release the distributed lock
        }
    }

    /**
     * PHASE 2: Confirm a booking (FR-3.4)
     * Converts a HOLD_PENDING booking into a CONFIRMED booking upon payment successfully processed.
     */
    public static async confirmBooking(
        bookingReference: string,
        gatewayTransactionId: string
    ): Promise<BookingRecord> {

        const client: PoolClient = await pool.connect();

        try {
            await client.query('BEGIN');

            const bookingRes = await client.query<BookingRecord>(
                `SELECT * FROM bookings
                WHERE booking_reference = $1
                FOR UPDATE`,
                [bookingReference]
            );

            if (bookingRes.rowCount === 0) {
                throw new BookingDomainError(`Booking with reference ${bookingReference} not found.`, 404);
            }

            const booking = bookingRes.rows[0];

            if (booking.status === 'CONFIRMED') {
                await client.query('COMMIT');
                return booking; // Idempotent: already confirmed
            }

            if (booking.status !== 'HOLD_PENDING') {
                throw new BookingDomainError(`Booking with reference ${bookingReference} cannot be confirmed as it is in status ${booking.status}.`, 400);
            }

            // Check if the 15-minute hold has expired
            if (booking.hold_expires_at && new Date(booking.hold_expires_at) < new Date()) {
                await client.query(
                    `UPDATE bookings
                    SET status = 'CANCELLED'
                    WHERE id = $1`,
                    [booking.id]
                );
                await client.query('COMMIT');
                throw new BookingHoldExpiredError(bookingReference );
            }

            // Transition booking to CONFIRMED
            const updateRes = await client.query<BookingRecord>(
                `UPDATE bookings
                SET status = 'CONFIRMED',
                    hold_expires_at = NULL,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING *`,
                [booking.id]
            );

            // Record successful payment transaction (FR-4.3)
            await client.query(
                `INSERT INTO payment_transactions (
                    booking_id,
                    gateway_transaction_id,
                    type,
                    amount,
                    currency,
                    status,
                    metadata
                ) VALUES ($1, $2, 'CARD', $3, 'TND', 'CAPTURED', $4)`,
                [
                    booking.id,
                    gatewayTransactionId,
                    booking.total_price,
                    JSON.stringify({ confirmedAt: new Date().toISOString() })
                ]
            );

            await client.query('COMMIT');

            // teardown Redis hold key as the booking is now confirmed
            const holdKey = `booking:hold:${booking.vehicle_id}:${bookingReference}`;
            await redis.del(holdKey);

            return updateRes.rows[0];

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Cancel or release an active hold booking (FR-3.6)
     * @param bookingReference 
     * @returns
     */
    public static async cancelBooking(bookingReference: string, reason: string): Promise<void> {
        const res = await pool.query<BookingRecord>(
            `SELECT bookings
            SET status = 'CANCELLED', updated_at = NOW()
            WHERE booking_reference = $1 AND status IN ('HOLD_PENDING', 'CONFIRMED')
            RETURNING vehicle_id, id`,
            [bookingReference]
        );

        if (res.rows.length > 0) { 
            const { vehicle_id } = res.rows[0];
            await redis.del(`booking:hold:${vehicle_id}:${bookingReference}`);
        }

    }

}