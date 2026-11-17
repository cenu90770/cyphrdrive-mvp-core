import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();

const stripeSecretKey =
  process.env.STRIPE_SECRET_KEY || "sk_test_placeholder_key";

export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2026-10-28.endive",
  typescript: true,
});
