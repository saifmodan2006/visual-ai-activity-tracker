import { db } from "./db.js";
import { categorizeLocally } from "./categorizer.js";
import { clamp, sleep } from "./utils.js";

let minuteWindow = { timestamp: 0, count: 0 };
let dailyWindow = { timestamp: 0, count: 0 };

/**
 * Privacy-preserving AI wrapper with rate limiting and local fallback.
 */
export class AiService {
  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<{category: string, confidence: number, productivityScore: number, reasoning: string}>}
   */
  async categorizeActivity(payload) {
    const settings = await db.getSettings();
    const canUseAi = Boolean(settings.apiKey && settings.apiProvider && await this.consumeQuota(settings));
    if (!canUseAi) {
      return categorizeLocally(payload.url, payload.title);
    }
    try {
      const decrypted = await this.decryptSecret(settings.apiKey);
      const provider = settings.apiProvider === "gemini" ? this.callGemini : this.callOpenAI;
      const result = await provider.call(this, decrypted, payload);
      return result || categorizeLocally(payload.url, payload.title);
    } catch {
      return categorizeLocally(payload.url, payload.title);
    }
  }

  /**
   * @param {string} apiKeyCiphertext
   * @returns {Promise<string>}
   */
  async decryptSecret(apiKeyCiphertext) {
    const [ivBase64, cipherBase64] = String(apiKeyCiphertext || "").split(".");
    if (!ivBase64 || !cipherBase64) {
      return apiKeyCiphertext || "";
    }
    const keyMaterial = await db.getSecret("api-key-secret");
    if (!keyMaterial) {
      return "";
    }
    const rawKey = base64ToArray(keyMaterial);
    const cryptoKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", true, ["encrypt", "decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToArray(ivBase64) }, cryptoKey, base64ToArray(cipherBase64));
    return new TextDecoder().decode(plain);
  }

  /**
   * @param {Record<string, any>} settings
   * @returns {Promise<boolean>}
   */
  async consumeQuota(settings) {
    const now = Date.now();
    if (now - minuteWindow.timestamp > 60 * 1000) {
      minuteWindow = { timestamp: now, count: 0 };
    }
    if (now - dailyWindow.timestamp > 24 * 60 * 60 * 1000) {
      dailyWindow = { timestamp: now, count: 0 };
    }
    const minuteLimit = clamp(Number(settings.aiRateLimitPerMinute || 1), 1, 60);
    const dailyLimit = clamp(Number(settings.aiRateLimitPerDay || 50), 1, 500);
    if (minuteWindow.count >= minuteLimit || dailyWindow.count >= dailyLimit) {
      return false;
    }
    minuteWindow.count += 1;
    dailyWindow.count += 1;
    return true;
  }

  /**
   * @param {string} apiKey
   * @param {{screenshotBase64: string, url: string, title: string}} payload
   * @returns {Promise<any>}
   */
  async callOpenAI(apiKey, payload) {
    const response = await this.requestWithRetry(async () => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a productivity assistant. Analyze the provided screenshot of a web page and categorize the user's activity. Respond ONLY with a JSON object in this exact format: {\"category\": \"work|social|entertainment|learning|shopping|news|other\", \"confidence\": 0.0-1.0, \"productivityScore\": 1-10, \"reasoning\": \"brief explanation\"}. Work = coding, writing, email, docs, spreadsheets, project management, professional tools. Social = social media, messaging, forums. Entertainment = videos, games, streaming. Learning = tutorials, courses, documentation, research. Shopping = e-commerce, product browsing. News = news sites, blogs. Other = everything else. Productivity score: 8-10 for focused work, 5-7 for neutral, 1-4 for distracting."
          },
          {
            role: "user",
            content: [{ type: "text", text: `URL: ${payload.url}\nTitle: ${payload.title}` }, { type: "image_url", image_url: { url: payload.screenshotBase64 } }]
          }
        ]
      })
    }));
    const text = await response.text();
    const parsed = JSON.parse(text);
    return normalizeAiResult(parsed.choices?.[0]?.message?.content || text);
  }

  /**
   * @param {string} apiKey
   * @param {{screenshotBase64: string, url: string, title: string}} payload
   * @returns {Promise<any>}
   */
  async callGemini(apiKey, payload) {
    const response = await this.requestWithRetry(async () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "You are a productivity assistant. Analyze the provided screenshot of a web page and categorize the user's activity. Respond ONLY with a JSON object in this exact format: {\"category\": \"work|social|entertainment|learning|shopping|news|other\", \"confidence\": 0.0-1.0, \"productivityScore\": 1-10, \"reasoning\": \"brief explanation\"}." }]
        },
        contents: [{ parts: [{ text: `URL: ${payload.url}\nTitle: ${payload.title}` }, { inlineData: { mimeType: "image/jpeg", data: payload.screenshotBase64.split(",")[1] || payload.screenshotBase64 } }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
      })
    }));
    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return normalizeAiResult(text);
  }

  /**
   * @param {string} apiKey
   * @param {{screenshotBase64: string, url: string, title: string}} payload
   * @returns {Promise<any>}
   */
  async requestWithRetry(executor) {
    const delays = [2000, 4000, 8000, 16000];
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await executor();
      } catch (error) {
        if (attempt === delays.length) {
          throw error;
        }
        await sleep(delays[attempt]);
      }
    }
    return null;
  }

  /**
   * @param {Array<any>} activities
   * @returns {Promise<{insights: string[], recommendations: string[]}>}
   */
  async generateDailyInsights(activities) {
    const settings = await db.getSettings();
    const canUseAi = Boolean(settings.apiKey && settings.apiProvider && await this.consumeQuota(settings));
    if (!canUseAi) {
      return this.localInsights(activities);
    }
    try {
      const decrypted = await this.decryptSecret(settings.apiKey);
      const prompt = JSON.stringify(activities.slice(-60));
      const response = settings.apiProvider === "gemini"
        ? await this.generateGeminiInsights(decrypted, prompt)
        : await this.generateOpenAiInsights(decrypted, prompt);
      return response || this.localInsights(activities);
    } catch {
      return this.localInsights(activities);
    }
  }

  /**
   * @param {Array<any>} activities
   * @returns {{insights: string[], recommendations: string[]}}
   */
  localInsights(activities) {
    const topHosts = new Map();
    for (const activity of activities) {
      const key = activity.hostname || "unknown";
      topHosts.set(key, (topHosts.get(key) || 0) + (activity.duration || 0));
    }
    const topSite = Array.from(topHosts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || "your current mix";
    const activeSeconds = activities.reduce((total, item) => total + (item.duration || 0), 0);
    return {
      insights: [
        `You tracked ${Math.round(activeSeconds / 60)} minutes of browsing activity.`,
        `Your most active site was ${topSite}.`,
        "Local heuristics are in use, so your data stays on-device unless you opt in to AI."
      ],
      recommendations: [
        "Batch similar tasks to reduce tab switching.",
        "Keep distracting sites out of your active work window."
      ]
    };
  }

  /**
   * @param {string} apiKey
   * @param {string} prompt
   * @returns {Promise<any>}
   */
  async generateOpenAiInsights(apiKey, prompt) {
    const response = await this.requestWithRetry(async () => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Analyze this user's daily browsing activity data and provide 3-5 personalized productivity insights and 2-3 actionable recommendations. Be encouraging, not judgmental. Respond with JSON: {\"insights\": [\"...\"], \"recommendations\": [\"...\"]}" },
          { role: "user", content: prompt }
        ]
      })
    }));
    const text = await response.text();
    return JSON.parse(extractJsonText(text));
  }

  /**
   * @param {string} apiKey
   * @param {string} prompt
   * @returns {Promise<any>}
   */
  async generateGeminiInsights(apiKey, prompt) {
    const response = await this.requestWithRetry(async () => fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Analyze this user's daily browsing activity data and provide 3-5 personalized productivity insights and 2-3 actionable recommendations. Be encouraging, not judgmental. Respond with JSON: {\"insights\": [\"...\"], \"recommendations\": [\"...\"]}" }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
      })
    }));
    const json = await response.json();
    return JSON.parse(extractJsonText(json.candidates?.[0]?.content?.parts?.[0]?.text || "{}"));
  }
}

/**
 * @param {string} value
 * @returns {any}
 */
function normalizeAiResult(value) {
  const parsed = typeof value === "string" ? JSON.parse(extractJsonText(value)) : value;
  return {
    category: parsed.category || "other",
    confidence: clamp(Number(parsed.confidence || 0.5), 0, 1),
    productivityScore: clamp(Number(parsed.productivityScore || 5), 1, 10),
    reasoning: String(parsed.reasoning || "")
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function extractJsonText(value) {
  const text = String(value || "");
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
function base64ToArray(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
