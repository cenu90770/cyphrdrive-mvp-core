import { z } from "zod";

export const TelemetryPayloadSchema = z.object({
  vehicleId: z.string().uuid(),
  timestamp: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).default(0),
  batteryLevel: z.number().int().min(0).max(100).optional(), // 0-100% (EV / 12V)
  fuelLevel: z.number().int().min(0).max(100).optional(), // 0-100% (ICE / Hybrid)
  doorsLocked: z.boolean().default(true),
  engineRunning: z.boolean().default(false),
  odometer: z.number().int().min(0),
  diagnosticTroubleCodes: z.array(z.string()).default([]), // OBD-II trouble codes (e.g. ['P0300', 'P0117'])
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

export interface VehicleLiveState {
  vehicleId: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  batteryLevel?: number;
  fuelLevel?: number;
  doorsLocked: boolean;
  engineRunning: boolean;
  odometer: number;
  dtcAlerts: string[];
  lastUpdated: string;
}

// Critical OBD-II Codes mapping for alerting (FR-11.1)
export const CRITICAL_DTC_MAP: Record<string, string> = {
  P0300: "Random/Multiple Cylinder Misfire Detected (Engine risk)",
  P0117: "Engine Coolant Temperature Circuit Detected (Engine risk)",
  P0700: "Transmission Control System Malfunction",
  B0001: "Driver Airbag Circuit / Safety Restraint Failure",
  P0562: "System Voltage Low (Main 12V/HV Battery Discharge)",
};
