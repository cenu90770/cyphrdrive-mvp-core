import { z } from 'zod';

export const IncidentalFeeSchema = z.object({
    bookingId: z.string().uuid(),
    fuelDeficitLiter: z.number().min(0).default(0),
    fuelPricePerLiter: z.number().min(0).default(2.15), // €2.15/L
    lateReturnHours: z.number().min(0).default(0),
    lateHourlyRate: z.number().min(0).default(25.00), // €25.00/hr
    damageAssignmentAmount: z.number().min(0).default(0),
    remarks: z.string().optional()
});

export type IncidentalFeeInput = z.infer<typeof IncidentalFeeSchema>;

export interface IncidentalCalculationResult {
    fuelFee: number;
    lateFee: number;
    damageFee: number;
    totalIncidentalFee: number;
    amountToRelease: number;
}