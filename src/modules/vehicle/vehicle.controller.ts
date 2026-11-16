import { Request, Response } from "express";
import { pool } from "../../config/db";

export class VehicleController {
  /**
   * Real-time Search & Availability Filter (FR-2.1, FR-2.5)
   */
  public static async searchVehicles(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const {
        latitude = "52.5200", // Defaults to Berlin Center
        longitude = "13.4050",
        radiusKm = "50",
        startTime,
        endTime,
        category,
        transmission,
      } = req.query;

      if (!startTime || !endTime) {
        res.status(400).json({
          error: "startTime and endTime query parameters are required.",
        });
        return;
      }

      const params: any[] = [
        parseFloat(latitude as string),
        parseFloat(longitude as string),
        parseFloat(radiusKm as string) * 1000, // converts to meters
        new Date(startTime as string),
        new Date(endTime as string),
      ];

      let dynamicFilters = "";
      if (category) {
        params.push(category);
        dynamicFilters += ` AND v.category = $${params.length}`;
      }
      if (transmission) {
        params.push(transmission);
        dynamicFilters += ` AND v.transmission = $${params.length}`;
      }

      // Geospatial query + Availability check against existing reservations
      const searchQuery = `
        SELECT
          v.id, v.make, v.model, v.year, v.category, v.transmission,
          v.fuel_type, v.base_daily_rate, v.specs, v.photos,
          b.id as branch_id, b.name as branch_name, b.city,
          ST_Distance(
            b.location,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) / 1000 AS distance_km
        FROM vehicles v
        JOIN branches b ON v.branch_id = b.id
        WHERE v.status = 'AVAILABLE'
          AND ST_DWithin(b.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
          ${dynamicFilters}
          -- Ensure no confirmed booking or active hold overlaps this date range (FR-2.5, FR-3.5)
          AND NOT EXISTS(
            SELECT 1 FROM bookings bk
            WHERE bk.vehicle_id = v.id
              AND (
                bk.status IN ('CONFIRMED', 'ACTIVE')
                OR (bk.status = 'HOLD_PENDING' AND bk.hold_expires_at > NOW())
              )
              AND (bk.start_time, bk.end_time) OVERLAPS ($4::timestamptz, $5::timestamptz)
          )
        ORDER BY distance_km ASC, v.base_daily_rate ASC;
      `;

      const result = await pool.query(searchQuery, params);
      res.status(200).json({
        count: result.rowCount,
        vehicles: result.rows,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
