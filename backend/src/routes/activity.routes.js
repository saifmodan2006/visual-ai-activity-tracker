import { Router } from "express";
import { list, remove, sync } from "../controllers/activity.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { syncLimiter } from "../middleware/rate-limit.middleware.js";

const router = Router();

router.post("/sync", authMiddleware, syncLimiter, sync);
router.get("/", authMiddleware, list);
router.delete("/:id", authMiddleware, remove);

export default router;
