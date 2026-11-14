import { pool } from "../../config/db";
import { StorageService } from "../storage/storage.service";
import { BookingDomainError } from "../booking/booking.errors";

export interface InspectionSubmission {
  bookingId: string;
  inspectorId: string;
  type: "PICKUP" | "RETURN";
  odometerReading: number;
  fuelPercentage: number;
  photoKeys: {
    front: string;
    back: string;
    left: string;
    right: string;
  };
  remarks?: string;
}

export class InspectionService {
  /**
   * Generates 4 pre-signed URLs for vehicle check-in/out condition inspection (FR-8.1)
   */
  public static async getInspectionUploadUrls(
    bookingId: string,
    inspectionType: "PICKUP" | "RETURN",
  ) {
    const angles = ["front", "back", "left", "right"] as const;
    const urls: Record<string, string> = {};
    const fileKeys: Record<string, string> = {};

    for (const angle of angles) {
      const result = await StorageService.generateUploadUrl(
        "inspections",
        `${bookingId}_${inspectionType.toLowerCase()}`,
        `${angle}.jpg`,
        "image/jpeg",
      );
      urls[angle] = result.uploadUrl;
      fileKeys[angle] = result.fileKey;
    }

    return { urls, fileKeys };
  }

  /**
   * Saves the inspection checklist record (FR-7.3, FR-8.1)
   */
  public static async recordInspection(submission: InspectionSubmission) {
    const bookingRes = await pool.query(
      "SELECT vehicle_id FROM bookings WHERE id = $1",
      [submission.bookingId],
    );
    if (bookingRes.rowCount === 0) {
      throw new BookingDomainError(
        `Booking with ID ${submission.bookingId} not found`,
        404,
      );
    }

    const vehicleId = bookingRes.rows[0].vehicle_id;

    const res = await pool.query(
      `INSERT INTO inspection_records (
        booking_id, vehicle_id, inspector_id, type, odometer_reading, fuel_percentage, photos, remarks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        submission.bookingId,
        vehicleId,
        submission.inspectorId,
        submission.type,
        submission.odometerReading,
        submission.fuelPercentage,
        JSON.stringify(submission.photoKeys),
        submission.remarks || null,
      ],
    );

    return res.rows[0];
  }
}
