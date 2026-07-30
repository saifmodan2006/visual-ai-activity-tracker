import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import authRoutes from "./routes/auth.routes.js";
import activityRoutes from "./routes/activity.routes.js";
import accountRoutes from "./routes/account.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { generalLimiter } from "./middleware/rate-limit.middleware.js";
import { prisma } from "./models/index.js";

dotenv.config();

const app = express();
const allowedOrigin = process.env.CORS_ORIGIN || "chrome-extension://";

app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (origin.startsWith("chrome-extension://") || origin === allowedOrigin) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS blocked"));
  },
  credentials: true
}));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "visual-ai-activity-tracker-backend" });
});
app.use("/api/auth", authRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use(errorMiddleware);

const port = Number(process.env.PORT || 3000);

prisma.$connect().then(() => {
  app.listen(port, () => {
    console.log(`Visual AI Activity Tracker backend listening on port ${port}`);
  });
}).catch((error) => {
  console.error("Failed to connect to database", error);
  process.exitCode = 1;
});
