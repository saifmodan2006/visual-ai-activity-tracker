import { Router } from "express";
import { dashboard } from "../controllers/analytics.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/dashboard", authMiddleware, dashboard);

export default router;
