import mqtt, { MqttClient } from "mqtt";
import dotenv from "dotenv";

dotenv.config();

const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";

export const mqttClient: MqttClient = mqtt.connect(brokerUrl, {
  clientId: `cyphrdrive-mvp-core-${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  connectTimeout: 5000,
  reconnectPeriod: 2000,
});

mqttClient.on("connect", () => {
  console.log("[MQTT] Connected successfully to EMQX Broker.");
});

mqttClient.on("error", (err) => {
  console.error("[MQTT] Connection error: ", err);
});
