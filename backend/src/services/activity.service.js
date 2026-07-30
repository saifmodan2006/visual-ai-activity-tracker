import { prisma } from "../models/index.js";

/**
 * Bulk upserts activities using user, hostname, and start time as the matching key.
 * @param {string} userId
 * @param {Array<any>} activities
 * @returns {Promise<{count: number}>}
 */
export async function syncActivities(userId, activities) {
  let count = 0;
  for (const activity of activities) {
    const startTime = new Date(activity.startTime);
    const endTime = new Date(activity.endTime);
    const existing = await prisma.activity.findFirst({ where: { userId, hostname: activity.hostname, startTime } });
    const data = {
      userId,
      url: activity.url,
      hostname: activity.hostname,
      title: activity.title || "",
      category: activity.category,
      startTime,
      endTime,
      durationSeconds: activity.duration,
      screenshots: activity.screenshots || [],
      productivityScore: activity.productivityScore ?? null,
      isIdle: Boolean(activity.isIdle)
    };
    if (existing) {
      await prisma.activity.update({ where: { id: existing.id }, data });
    } else {
      await prisma.activity.create({ data });
    }
    count += 1;
  }
  return { count };
}

/**
 * @param {string} userId
 * @returns {Promise<any[]>}
 */
export async function listActivities(userId) {
  return prisma.activity.findMany({ where: { userId }, orderBy: { startTime: "desc" } });
}

/**
 * @param {string} userId
 * @param {string} activityId
 * @returns {Promise<void>}
 */
export async function deleteActivity(userId, activityId) {
  const existing = await prisma.activity.findFirst({ where: { id: activityId, userId } });
  if (!existing) {
    const error = new Error("Activity not found");
    error.statusCode = 404;
    throw error;
  }
  await prisma.activity.delete({ where: { id: activityId } });
}

/**
 * Deletes the account data and all dependent records.
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function deleteAccountData(userId) {
  await prisma.user.delete({ where: { id: userId } });
}

/**
 * Builds dashboard analytics for the authenticated user.
 * @param {string} userId
 * @returns {Promise<any>}
 */
export async function buildAnalytics(userId) {
  const activities = await listActivities(userId);
  const summaries = await prisma.dailySummary.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 14 });
  const totalActiveSeconds = activities.reduce((total, activity) => total + activity.durationSeconds, 0);
  const categoryBreakdown = activities.reduce((accumulator, activity) => {
    accumulator[activity.category] = (accumulator[activity.category] || 0) + activity.durationSeconds;
    return accumulator;
  }, {});
  const siteBreakdown = Object.values(activities.reduce((accumulator, activity) => {
    const entry = accumulator[activity.hostname] || { hostname: activity.hostname, seconds: 0, visits: 0 };
    entry.seconds += activity.durationSeconds;
    entry.visits += 1;
    accumulator[activity.hostname] = entry;
    return accumulator;
  }, {}));
  const productivityAverage = activities.filter((activity) => typeof activity.productivityScore === "number");
  return {
    totalActiveSeconds,
    categoryBreakdown,
    siteBreakdown: siteBreakdown.sort((left, right) => right.seconds - left.seconds),
    productivityAverage: productivityAverage.length ? productivityAverage.reduce((total, activity) => total + activity.productivityScore, 0) / productivityAverage.length : null,
    recentActivities: activities.slice(0, 20),
    summaries
  };
}
