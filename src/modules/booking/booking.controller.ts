import { Request, Response } from "express";
import { BookingService } from "./booking.service";
import { pool } from "../../config/db";

export class BookingController {
  public static async createHold(req: Request, res: Response): Promise<void> {
    try {
      const renterId = req.user!.userId;
      const booking = await BookingService.initiateBookingHold({
        ...req.body,
        renterId,
      });
      res.status(201).json(booking);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message });
    }
  }

  public static async confirmBooking(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const { reference } = req.params;
      const { paymentIntentId = "pi_mock_charge_confirmed" } = req.body;
      const confirmed = await BookingService.confirmBooking(
        reference as string,
        paymentIntentId,
      );
      res.status(200).json(confirmed);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: err.message });
    }
  }

  public static async getMyBookings(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const renterId = req.user!.userId;
      const bookings = await pool.query(
        `SELECT b.*, v.make, v.model, v.license_plate
        FROM bookings b
        JOIN vehicles v ON b.vehicle_id = v.id
        WHERE b.renter_id = $1
        ORDER BY b.created_at DESC`,
        [renterId],
      );
      res.status(200).json(bookings.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
