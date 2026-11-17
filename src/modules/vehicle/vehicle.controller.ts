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
        latitude = "52.5200", // Defaults to Berlin Center (Alexanderplatz)
        longitude = "13.4050",
        radiusKm = "50", // Defaults to 50Km search radius
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

      const parsedLong = parseFloat(longitude as string);
      const parsedLat = parseFloat(latitude as string);
      const parsedRadiusMeters = parseFloat(radiusKm as string) * 1000;
      const startTimeIso = new Date(startTime as string).toISOString();
      const endTimeIso = new Date(endTime as string).toISOString(); 

      const params: any[] = [
        parsedLong,           // $1 (Longitude)
        parsedLat,            // $2 (Latitude)
        parsedRadiusMeters,   // $3 (Radius in Meter)
        startTimeIso,         // $4 (Start Time ISO String)
        endTimeIso,           // $5 (End Time ISO String)
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
          ROUND((ST_Distance(
            b.location, 
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
          ) / 1000)::numeric, 2) AS distance_km
        FROM vehicles v
        JOIN branches b ON v.branch_id = b.id
        WHERE v.status = 'AVAILABLE'
          AND ST_DWithin(b.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
          ${dynamicFilters}
          -- Ensure no confirmed booking or active hold overlaps this date range (StartA < EndB AND EndA > StartB)
          AND NOT EXISTS (
            SELECT 1 FROM bookings bk
            WHERE bk.vehicle_id = v.id
              AND (
                bk.status IN ('CONFIRMED', 'ACTIVE')
                OR (bk.status = 'HOLD_PENDING' AND bk.hold_expires_at > NOW())
              )
              AND bk.start_time < $5::timestamptz
              AND bk.end_time > $4::timestamptz
          )
        ORDER BY distance_km ASC, v.base_daily_rate ASC;
      `;

      const result = await pool.query(searchQuery, params);

      res.status(200).json({
        count: result.rowCount,
        vehicles: result.rows,
      });
    } catch (err: any) {
      console.error('[VehicleController] Search error: ', err.message);
      res.status(500).json({ error: err.message });
    }
  }
}
