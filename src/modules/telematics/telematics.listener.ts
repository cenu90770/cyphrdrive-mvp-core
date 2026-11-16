import { mqttClient } from "../../config/mqtt";
import { TelemetryService } from "./telematics.service";

export class TelematicsListener {
  private static readonly TELEMETRY_TOPIC = "vehicle/+/telemetry";

  public static initialize(): void {
    mqttClient.subscribe(this.TELEMETRY_TOPIC, { qos: 1 }, (err) => {
      if (err) {
        console.error("[MQTT Listener] Subscription failed: ", err);
      } else {
        console.log(
          `[MQTT Listener] Subscribed to wildcard topic: ${this.TELEMETRY_TOPIC}`,
        );
      }
    });

    mqttClient.on("message", async (topic, message) => {
      try {
        if (topic.endsWith("/telemetry")) {
          const payload = JSON.parse(message.toString());
          await TelemetryService.ingestTelemetry(payload);
        }
      } catch (err: any) {
        console.error(
          `[MQTT Listener] Error parsing packet on ${topic}: `,
          err.message,
        );
      }
    });
  }
}
