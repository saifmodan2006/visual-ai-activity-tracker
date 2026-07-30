import { prisma } from "../models/index.js";

/**
 * Optional AI service for backend analytics generation.
 * @param {string} userId
 * @returns {Promise<{insights: string[], recommendations: string[]}>}
 */
export async function generateInsights(userId) {
  const activities = await prisma.activity.findMany({ where: { userId }, orderBy: { startTime: "desc" }, take: 60 });
  const totalSeconds = activities.reduce((total, activity) => total + activity.durationSeconds, 0);
  const topSite = activities.reduce((map, activity) => {
    map.set(activity.hostname, (map.get(activity.hostname) || 0) + activity.durationSeconds);
    return map;
  }, new Map());
  const topHostname = Array.from(topSite.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || "your current mix";
  return {
    insights: [
      `You tracked ${Math.round(totalSeconds / 60)} minutes of activity recently.`,
      `Your top site was ${topHostname}.`,
      "The backend is ready to attach provider-generated insights when you opt in."
    ],
    recommendations: [
      "Group similar work into focused blocks.",
      "Limit quick switches into distracting sites during work sessions."
    ]
  };
}
