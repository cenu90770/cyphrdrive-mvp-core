import { AddOnType, PriceBreakdown } from './booking.types';

export class PricingService {
    private static readonly TAX_RATE = 0.15; // 15% tax rate
    private static readonly SECURITY_DEPOSIT_DEFFAULT = 500.00; // Default security deposit amount

    private static readonly ADD_ON_DAILY_RATES: Record<AddOnType, number> = {
        'GPS_NAVIGATION': 12.00,
        'CHILD_SEAT': 9.50,
        'ADDITIIONAL_DRIVER': 15.00,
        'INSURANCE_PREMIUM': 22.00,
        'INSURANCE_ZERO_DEDUCTIBLE': 35.00,
    };

    public static calculateQuote(
        baseDailyRate: number,
        startTime: Date,
        endTime: Date,
        addOns: AddOnType[]
    ): PriceBreakdown {

        const diffMs = endTime.getTime() - startTime.getTime();
        const durationDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

        const baseTotal = parseFloat((baseDailyRate * durationDays).toFixed(2));

        const addOnsBreakdown = addOns.map(addOn => {
            const dailyPrice = this.ADD_ON_DAILY_RATES[addOn] || 0;
            const totalCost = parseFloat((dailyPrice * durationDays).toFixed(2));
            return { type: addOn, cost: totalCost };
        });

        const addOnsTotal = parseFloat(
            addOnsBreakdown.reduce((sum, item) => sum + item.cost, 0).toFixed(2));

        const subTotal = baseTotal + addOnsTotal;
        const taxAmount = parseFloat((subTotal * this.TAX_RATE).toFixed(2));
        const totalPrice = parseFloat((subTotal + taxAmount).toFixed(2));
        const securityDeposit = this.SECURITY_DEPOSIT_DEFFAULT;

        return {
            durationDays,
            baseDailyrate: baseDailyRate,
            baseTotal,
            addOnsTotal,
            addOnsBreakdown,
            taxAmount,
            totalPrice,
            securityDeposit
        };

    }

}