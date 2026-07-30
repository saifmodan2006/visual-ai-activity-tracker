import { matchesHostPattern, normalizeHostname } from "./utils.js";

const WORK_SITES = ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "docs.google.com", "notion.so", "linear.app", "atlassian.net", "jira.com", "mail.google.com", "outlook.office.com"];
const SOCIAL_SITES = ["twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "threads.net", "discord.com", "linkedin.com"];
const ENTERTAINMENT_SITES = ["youtube.com", "netflix.com", "twitch.tv", "hulu.com", "primevideo.com", "disneyplus.com", "spotify.com"];
const LEARNING_SITES = ["coursera.org", "udemy.com", "khanacademy.org", "edx.org", "developer.mozilla.org", "wikipedia.org"];
const SHOPPING_SITES = ["amazon.com", "ebay.com", "etsy.com", "walmart.com", "target.com", "shopify.com"];
const NEWS_SITES = ["nytimes.com", "bbc.com", "cnn.com", "theverge.com", "techcrunch.com", "reuters.com", "news.ycombinator.com"];

/**
 * @param {string} url
 * @param {string} title
 * @returns {{category: string, confidence: number, productivityScore: number, reasoning: string}}
 */
export function categorizeLocally(url, title) {
  const hostname = normalizeHostname(extractHostname(url));
  const normalizedTitle = String(title || "").toLowerCase();

  if (matchesHostPattern(hostname, WORK_SITES)) {
    return { category: "work", confidence: 0.95, productivityScore: 9, reasoning: "Known work-related site." };
  }
  if (matchesHostPattern(hostname, SOCIAL_SITES)) {
    return { category: "social", confidence: 0.95, productivityScore: 2, reasoning: "Known social or messaging site." };
  }
  if (matchesHostPattern(hostname, ENTERTAINMENT_SITES)) {
    return { category: "entertainment", confidence: 0.95, productivityScore: 1, reasoning: "Known entertainment site." };
  }
  if (matchesHostPattern(hostname, LEARNING_SITES) || /(tutorial|course|documentation|docs|learn|guide|reference|api)/i.test(normalizedTitle)) {
    return { category: "learning", confidence: 0.85, productivityScore: 8, reasoning: "Educational or documentation content." };
  }
  if (matchesHostPattern(hostname, SHOPPING_SITES) || /(shop|cart|checkout|buy|product|sale|store)/i.test(normalizedTitle)) {
    return { category: "shopping", confidence: 0.9, productivityScore: 3, reasoning: "Shopping or product browsing." };
  }
  if (matchesHostPattern(hostname, NEWS_SITES) || /(news|article|headline|blog|press)/i.test(normalizedTitle)) {
    return { category: "news", confidence: 0.8, productivityScore: 4, reasoning: "News or editorial content." };
  }
  return { category: "other", confidence: 0.5, productivityScore: 5, reasoning: "No strong pattern match." };
}

/**
 * @param {string} url
 * @returns {string}
 */
function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
