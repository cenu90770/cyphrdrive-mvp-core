import Stripe from 'stripe'
import { stripe } from '../../config/stripe';
import { pool } from '../../config/db';
import { BookingService } from '../booking/booking.service';

export class PaymentWebhookHandler {
    private static readonly WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder';

    /**
     * Validates cryptographic signature and dispatches events
     */
    public static async handleWebhookEvent(rawPayload: Buffer, signature: string): Promise<{
        received: boolean
    }> {
        let event: Stripe.Event;

        try {
            event = stripe.webhooks.constructEvent(rawPayload, signature, this.WEBHOOK_SECRET);
        } catch (err: any) {
            console.error(`[Stripe Webhook] ⚠️ Signature verification failed: ${err.message}`);
            throw new Error(`Webhook Error: ${err.message}`);
        }

        console.log(`[Stripe Webhook] Received Event: ${event.type} (ID: ${event.id})`);

        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                const bookingReference = paymentIntent.metadata?.bookingReference;

                if (bookingReference) {
                    console.log(`[Stripe Webhook] 💰 Payment succeeded for booking ${bookingReference}. Confirming reservation...`);
                    await BookingService.confirmBooking(bookingReference, paymentIntent.id);
                }
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                console.warn(`[Stripe Webhook] ❌ Payment failed for Intent: ${paymentIntent.id}`);

                await pool.query(
                    `UPDATE payment_transactions
                        SET status = 'FAILD', metadata= metadata || $1:jsonb
                        WHERE gateway_transaction_id = $2`,
                    [
                        JSON.stringify({ failureMessage: paymentIntent.last_payment_error?.message}),
                        paymentIntent.id,
                    ]
                );
                break;
            }

            default:
                // Ignore unhandled event types
                break;
        }

        return { received: true };
    }
}
