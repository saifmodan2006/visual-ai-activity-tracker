import { Router } from "express";
import { deleteData } from "../controllers/activity.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = Router();

router.delete("/data", authMiddleware, deleteData);

export default router;