import { z } from "zod";

const passwordSchema = z.string().min(8, "Password must be at least 8 characters long.").regex(/[a-z]/, "Password must contain a lowercase letter.").regex(/[A-Z]/, "Password must contain an uppercase letter.").regex(/[0-9]/, "Password must contain a number.");

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(16)
});

export const screenshotSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  thumbnail: z.string().min(1)
});

export const activitySchema = z.object({
  url: z.string().url(),
  hostname: z.string().min(1),
  title: z.string().default(""),
  category: z.enum(["work", "social", "entertainment", "learning", "shopping", "news", "other"]),
  startTime: z.union([z.string(), z.number()]),
  endTime: z.union([z.string(), z.number()]),
  duration: z.number().int().nonnegative(),
  screenshots: z.array(screenshotSchema).default([]),
  productivityScore: z.number().int().min(1).max(10).nullable().optional(),
  isIdle: z.boolean().default(false)
});

export const syncActivitiesSchema = z.object({
  activities: z.array(activitySchema).min(1)
});

export const settingsSchema = z.object({
  trackingEnabled: z.boolean().optional(),
  screenshotEnabled: z.boolean().optional(),
  screenshotInterval: z.number().int().min(15000).max(60000).optional(),
  storeFullUrl: z.boolean().optional(),
  maxScreenshotAge: z.number().int().min(7).max(365).optional(),
  maxDataAge: z.number().int().min(7).max(365).optional(),
  cloudSyncEnabled: z.boolean().optional(),
  dailyGoalMinutes: z.number().int().min(7).max(1440).optional(),
  theme: z.enum(["dark", "light"]).optional()
});
