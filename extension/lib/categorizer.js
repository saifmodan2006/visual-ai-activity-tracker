import { matchesHostPattern, normalizeHostname } from "./utils.js";

const WORK_SITES = [
  "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com",
  "docs.google.com", "drive.google.com", "sheets.google.com", "slides.google.com", "meet.google.com",
  "notion.so", "linear.app", "atlassian.net", "jira.com", "confluence.atlassian.net", "trello.com",
  "asana.com", "monday.com", "clickup.com", "basecamp.com", "slack.com", "figma.com",
  "canva.com", "miro.com", "zoom.us", "teams.microsoft.com", "mail.google.com", "outlook.office.com",
  "outlook.live.com", "chatgpt.com", "openai.com", "claude.ai", "gemini.google.com", "perplexity.ai",
  "codepen.io", "replit.com", "codesandbox.io", "v0.dev", "huggingface.co", "aws.amazon.com",
  "console.cloud.google.com", "portal.azure.com", "vercel.com", "netlify.com", "render.com", "supabase.com"
];

const SOCIAL_SITES = [
  "twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "reddit.com",
  "threads.net", "discord.com", "linkedin.com", "pinterest.com", "tumblr.com", "quora.com",
  "whatsapp.com", "web.whatsapp.com", "telegram.org", "web.telegram.org", "snapchat.com", "mastodon.social"
];

const ENTERTAINMENT_SITES = [
  "youtube.com", "netflix.com", "twitch.tv", "hulu.com", "primevideo.com", "disneyplus.com",
  "spotify.com", "soundcloud.com", "vimeo.com", "crunchyroll.com", "hbomax.com", "max.com",
  "steampowered.com", "epicgames.com", "roblox.com", "ign.com", "kotaku.com"
];

const LEARNING_SITES = [
  "coursera.org", "udemy.com", "khanacademy.org", "edx.org", "developer.mozilla.org",
  "wikipedia.org", "w3schools.com", "geeksforgeeks.org", "leetcode.com", "hackerrank.com",
  "freecodecamp.org", "codecademy.com", "medium.com", "substack.com", "arxiv.org",
  "scholar.google.com", "sciencedirect.com", "researchgate.net", "pluralsight.com", "scrimba.com",
  "unstop.com"
];

const SHOPPING_SITES = [
  "amazon.com", "ebay.com", "etsy.com", "walmart.com", "target.com", "shopify.com",
  "aliexpress.com", "bestbuy.com", "ikea.com", "wayfair.com", "flipkart.com", "myntra.com"
];

const NEWS_SITES = [
  "nytimes.com", "bbc.com", "cnn.com", "theverge.com", "techcrunch.com", "reuters.com",
  "news.ycombinator.com", "bloomberg.com", "wsj.com", "theguardian.com", "washingtonpost.com",
  "wired.com", "ars-technica.com", "cnet.com", "mashable.com"
];

/**
 * Dynamically resolves the effective category for an activity record,
 * re-evaluating if stored as "other" or missing.
 * @param {{url?: string, hostname?: string, title?: string, category?: string}} activity
 * @param {Array<any>} [customRules=[]]
 * @returns {string}
 */
export function getEffectiveCategory(activity, customRules = []) {
  if (activity && activity.category && activity.category !== "other") {
    return activity.category;
  }
  const result = categorizeLocally(activity?.url || activity?.hostname || "", activity?.title || "", customRules);
  return result.category;
}

/**
 * @param {string} url
 * @param {string} title
 * @param {Array<{pattern: string, category: string, score?: number}>} [customRules=[]]
 * @returns {{category: string, confidence: number, productivityScore: number, reasoning: string}}
 */
export function categorizeLocally(url, title, customRules = []) {
  const hostname = normalizeHostname(extractHostname(url));
  const fullUrl = String(url || "").toLowerCase();
  const normalizedTitle = String(title || "").toLowerCase();

  // 1. Check custom user rules first
  if (Array.isArray(customRules) && customRules.length > 0) {
    for (const rule of customRules) {
      if (!rule?.pattern) continue;
      const pattern = normalizeHostname(rule.pattern);
      if (hostname === pattern || hostname.endsWith(`.${pattern}`) || fullUrl.includes(pattern)) {
        return {
          category: rule.category || "other",
          confidence: 1.0,
          productivityScore: typeof rule.score === "number" ? rule.score : 7,
          reasoning: `Custom user rule matched (${rule.pattern}).`
        };
      }
    }
  }

  // 2. Special path-aware overrides (e.g., YouTube Educational vs Music vs Shorts)
  if (hostname.includes("youtube.com")) {
    if (fullUrl.includes("/shorts")) {
      return { category: "entertainment", confidence: 0.98, productivityScore: 1, reasoning: "YouTube Shorts stream." };
    }
    if (fullUrl.includes("music.youtube.com")) {
      return { category: "entertainment", confidence: 0.95, productivityScore: 4, reasoning: "YouTube Music background audio." };
    }
    if (/(lecture|tutorial|course|documentation|learn|coding|programming|math|science|conference|talk)/i.test(normalizedTitle)) {
      return { category: "learning", confidence: 0.88, productivityScore: 8, reasoning: "Educational video content." };
    }
  }

  if (hostname.includes("reddit.com")) {
    if (/(programming|webdev|javascript|reactjs|node|python|machinelearning|datascience|learnprogramming)/i.test(fullUrl) ||
        /(programming|webdev|javascript|reactjs|node|python|machinelearning|datascience)/i.test(normalizedTitle)) {
      return { category: "learning", confidence: 0.90, productivityScore: 8, reasoning: "Developer community on Reddit." };
    }
  }

  // 3. Domain pattern matching
  if (matchesHostPattern(hostname, WORK_SITES)) {
    return { category: "work", confidence: 0.95, productivityScore: 9, reasoning: "Known professional & developer tool." };
  }
  if (matchesHostPattern(hostname, SOCIAL_SITES)) {
    return { category: "social", confidence: 0.95, productivityScore: 2, reasoning: "Known social network or messaging site." };
  }
  if (matchesHostPattern(hostname, ENTERTAINMENT_SITES)) {
    return { category: "entertainment", confidence: 0.95, productivityScore: 1, reasoning: "Known streaming or gaming site." };
  }
  if (matchesHostPattern(hostname, LEARNING_SITES)) {
    return { category: "learning", confidence: 0.95, productivityScore: 8, reasoning: "Known learning & documentation site." };
  }
  if (matchesHostPattern(hostname, SHOPPING_SITES)) {
    return { category: "shopping", confidence: 0.90, productivityScore: 3, reasoning: "Known e-commerce platform." };
  }
  if (matchesHostPattern(hostname, NEWS_SITES)) {
    return { category: "news", confidence: 0.85, productivityScore: 4, reasoning: "Known news or technology publisher." };
  }

  // 4. Keyword fallback heuristics
  if (/(tutorial|course|documentation|docs|learn|guide|reference|api|manual|cheatsheet|lecture|textbook)/i.test(normalizedTitle)) {
    return { category: "learning", confidence: 0.82, productivityScore: 8, reasoning: "Title contains learning keywords." };
  }
  if (/(shop|cart|checkout|buy|product|sale|store|deals|price|discount)/i.test(normalizedTitle)) {
    return { category: "shopping", confidence: 0.85, productivityScore: 3, reasoning: "Title contains shopping keywords." };
  }
  if (/(news|article|headline|blog|press|breaking|editorial)/i.test(normalizedTitle)) {
    return { category: "news", confidence: 0.78, productivityScore: 4, reasoning: "Title contains news keywords." };
  }
  if (/(dashboard|admin|console|management|analytics|report|crm|erp|project|issue|pull request|kanban)/i.test(normalizedTitle)) {
    return { category: "work", confidence: 0.80, productivityScore: 8, reasoning: "Title contains work keywords." };
  }

  return { category: "other", confidence: 0.50, productivityScore: 5, reasoning: "General web activity." };
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

