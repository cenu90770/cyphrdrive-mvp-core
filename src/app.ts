import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { AuthController } from "./modules/auth/auth.controller";
import { VehicleController } from "./modules/vehicle/vehicle.controller";
import { BookingController } from "./modules/booking/booking.controller";
import { authenticateToken, requireRole } from "./middlewares/auth.middleware";
import { AdminController } from "./modules/admin/admin.controller";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// --- PUBLIC ROUTES ---
app.get("/health", (req, res) =>
  res.status(200).json({ status: "UP", service: "CyphrDrive API" }),
);
app.post("/api/v1/auth/register", AuthController.register);
app.post("/api/v1/auth/login", AuthController.loging);
app.post("/api/v1/auth/verify-otp", AuthController.verifyOtp);
app.get("/api/v1/vehicles/search", VehicleController.searchVehicles);

// --- PROTECTED RENTER ROUTES ---
app.post(
  "/api/v1/bookings/hold",
  authenticateToken,
  BookingController.createHold,
);
app.post(
  "/api/v1/bookings/:reference/confirm",
  authenticateToken,
  BookingController.confirmBooking,
);
app.get(
  "/api/v1/bookings/my-bookings",
  authenticateToken,
  BookingController.getMyBookings,
);

// --- PROTECTED FLEET ADMIN & SUPER ADMIN ROUTES (FR-11.1, FR-8.1, FR-12) ---
app.get(
  "/api/v1/admin/fleet/live-map",
  authenticateToken,
  requireRole(["FLEET_ADMIN", "SUPER_ADMIN"]),
  AdminController.getLiveFleetMap,
);

app.post(
  "/api/v1/admin/fleet/:vehicleId/command",
  authenticateToken,
  requireRole(["FLEET_ADMIN", "SUPER_ADMIN"]),
  AdminController.dispatchCommand,
);
