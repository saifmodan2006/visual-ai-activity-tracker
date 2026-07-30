import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../models/index.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_DAYS = 7;

/**
 * Creates a user and returns auth tokens.
 * @param {{email: string, password: string}} payload
 * @returns {Promise<{token: string, refreshToken: string, user: {id: string, email: string}}>} 
 */
export async function registerUser(payload) {
  const existing = await prisma.user.findUnique({ where: { email: payload.email } });
  if (existing) {
    const error = new Error("Email already registered");
    error.statusCode = 409;
    throw error;
  }
  const passwordHash = await bcrypt.hash(payload.password, 12);
  const user = await prisma.user.create({ data: { email: payload.email, passwordHash } });
  return issueTokens(user);
}

/**
 * Authenticates an existing user.
 * @param {{email: string, password: string}} payload
 * @returns {Promise<{token: string, refreshToken: string, user: {id: string, email: string}}>} 
 */
export async function loginUser(payload) {
  const user = await prisma.user.findUnique({ where: { email: payload.email } });
  if (!user) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }
  const valid = await bcrypt.compare(payload.password, user.passwordHash);
  if (!valid) {
    const error = new Error("Invalid credentials");
    error.statusCode = 401;
    throw error;
  }
  return issueTokens(user);
}

/**
 * Refreshes an access token using a hashed refresh token stored in the database.
 * @param {string} refreshToken
 * @returns {Promise<{token: string}>}
 */
export async function refreshAccessToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  const record = await prisma.refreshToken.findFirst({ where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
  if (!record) {
    const error = new Error("Invalid refresh token");
    error.statusCode = 401;
    throw error;
  }
  const token = jwt.sign({ sub: record.user.id, email: record.user.email }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  return { token };
}

/**
 * Issues a new JWT pair and stores the refresh token hash.
 * @param {{id: string, email: string}} user
 * @returns {Promise<{token: string, refreshToken: string, user: {id: string, email: string}}>} 
 */
async function issueTokens(user) {
  const token = jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  return { token, refreshToken, user: { id: user.id, email: user.email } };
}

/**
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
