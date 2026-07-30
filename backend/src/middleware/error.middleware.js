/**
 * Centralized error handler that returns safe JSON responses.
 * @param {any} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function errorMiddleware(error, req, res, next) {
  console.error(error);
  const statusCode = error?.statusCode || 500;
  res.status(statusCode).json({ error: error?.message || "Internal server error" });
}
