import { app } from "./app";
import { TelematicsListener } from "./modules/telematics/telematics.listener";

const PORT = process.env.PORT || 3000;

// Initialize background MQTT telematics subscriber
TelematicsListener.initialize();

app.listen(PORT, () => {
  console.log(
    `🚀 CyphrDrive REST API Server is listening on http://localhost:${PORT}`,
  );
});
