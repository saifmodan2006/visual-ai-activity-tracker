import { generateInsights } from "../services/ai.service.js";

/**
 * Returns productivity insights for the authenticated user.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
export async function dashboard(req, res, next) {
  try {
    const insights = await generateInsights(req.user.sub);
    res.json(insights);
  } catch (error) {
    next(error);
  }
}
