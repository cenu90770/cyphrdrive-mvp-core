import { z } from 'zod';

export const AddOnTypeEnum = z.enum([
    'GPS_NAVIGATION',
    'CHILD_SEAT',
    'ADDITIIONAL_DRIVER',
    'INSURANCE_PREMIUM',
    'INSURANCE_ZERO_DEDUCTIBLE'
]);

export type AddOnType = z.infer<typeof AddOnTypeEnum>;

export const InitiateBookingSchema = z.object({
    renterId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    pickupBranchId: z.string().uuid(),
    dropoffBranchId: z.string().uuid(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    addOns: z.array(AddOnTypeEnum).default([])
}).refine(data => new Date(data.startTime) >= new Date(), {
    message: "Start time must be in the future.",
    path: ["startTime"]
});

export type InitiateBookingInput = z.infer<typeof InitiateBookingSchema>;

export interface PriceBreakdown {
    durationDays: number;
    baseDailyrate: number;
    baseTotal: number;
    addOnsTotal: number;
    addOnsBreakdown: Array<{ type: AddOnType; cost: number }>;
    taxAmount: number;
    totalPrice: number;
    securityDeposit: number;
}

export interface BookingRecord {
    id: string;
    booking_reference: string;
    renter_id: string;
    vehicle_id: string;
    pickup_branch_id: string;
    dropoff_branch_id: string;
    start_time: Date;
    end_time: Date;
    status: 'HOLD_PENDING' | 'CONFIRMED' | 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
    base_price: string;
    add_ons_price: string;
    taxes_fees: string;
    total_price: string;
    security_deposit: string;
    hold_expires_at: string | null;
    created_at: string;
    updated_at: string;
}