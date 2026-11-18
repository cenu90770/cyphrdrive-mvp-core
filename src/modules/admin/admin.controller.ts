import { Request, Response } from "express";
import { TelematicsService } from "../telematics/telematics.service";
import { pool } from "../../config/db";

export class AdminController {
  /**
   * Fleet Admin Live Map Data (FR-11.1)
   */
  public static async getLiveFleetMap(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      // Disable HTTP caching for live polling so that polling requests always receive a full 200 OK response.
      res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate",
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", 0);

      const livePositions = await TelematicsService.getFleetLivePositions();

      // Scoping: If FleetAdmin, only return vehicles belonging to their assigned branches
      if (req.user!.role === "FLEET_ADMIN") {
        const allowedBranches = req.user!.branchIds;
        const vehicleBranchRes = await pool.query(
          `SELECT id FROM vehicles WHERE branch_id = ANY($1::uuid[])`,
          [allowedBranches],
        );
        const allowedVehicleIds = new Set(
          vehicleBranchRes.rows.map((r) => r.id),
        );
        const filteredPositions = livePositions.filter((pos) =>
          allowedVehicleIds.has(pos.vehicleId),
        );

        res.status(200).json({ fleet: filteredPositions });
        return;
      }

      // Super Admins see all vehicles
      res.status(200).json({ fleet: livePositions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Remote vehicle Unlock/Lock command (FR-8.1)
   */
  public static async dispatchCommand(
    req: Request,
    res: Response,
  ): Promise<void> {
    try {
      const { vehicleId } = req.params;
      const { command } = req.body; // 'LOCK_DOORS' | 'UNLOCK_DOORS'

      if (!["LOCK_DOORS", "UNLOCK_DOORS"].includes(command)) {
        res.status(400).json({ error: "Invalid command." });
        return;
      }

      await TelematicsService.sendVehicleCommand(vehicleId as string, command);
      res.status(200).json({ dispatched: true, vehicleId, command });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
