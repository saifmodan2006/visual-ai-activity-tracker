import { loginUser, refreshAccessToken, registerUser } from "../services/auth.service.js";
import { loginSchema, refreshSchema, registerSchema } from "../utils/validators.js";

export async function register(req, res, next) {
  try {
    const payload = registerSchema.parse(req.body);
    const result = await registerUser(payload);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const payload = loginSchema.parse(req.body);
    const result = await loginUser(payload);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(req, res, next) {
  try {
    const payload = refreshSchema.parse(req.body);
    const result = await refreshAccessToken(payload.refreshToken);
    res.json(result);
  } catch (error) {
    next(error);
  }
}
