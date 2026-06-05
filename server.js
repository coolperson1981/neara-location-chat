const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DIGITALOCEAN_INFERENCE_BASE_URL = process.env.DIGITALOCEAN_INFERENCE_BASE_URL || "https://inference.do-ai.run";
const DIGITALOCEAN_INFERENCE_MODEL = process.env.DIGITALOCEAN_INFERENCE_MODEL || "mistral-3-14B";
const DIGITALOCEAN_INFERENCE_KEY = process.env.DIGITALOCEAN_INFERENCE_KEY || process.env.DIGITALOCEAN_API_KEY || process.env.DIGITALOCEAN_TOKEN || "";
const AI_PROVIDER_TIMEOUT_MS = Number(process.env.AI_PROVIDER_TIMEOUT_MS || 8000);
const ONE_MILE_METERS = 1609.344;
const PRESENCE_TIMEOUT_MS = 5 * 60_000;
const users = new Map();
const waves = new Map();
const connections = new Set();
const messages = new Map();
const draftCounts = new Map();
const eventStreams = new Map();
const profileSchemas = new Map();
const vectorStore = new Map();
const avatars = ["avatar-mint", "avatar-gold", "avatar-coral", "avatar-blue", "avatar-rose", "avatar-violet"];
const characteristicRules = [
  { category: "interests", label: "Coffee", terms: ["coffee", "cafe", "latte", "espresso", "tea", "matcha"] },
  { category: "interests", label: "Walks", terms: ["walk", "walking", "stroll", "wander"] },
  { category: "interests", label: "Food", terms: ["food", "lunch", "dinner", "brunch", "bite", "restaurant", "tacos", "sushi"] },
  { category: "interests", label: "Music", terms: ["music", "concert", "playlist", "jazz", "guitar", "dj"] },
  { category: "interests", label: "Art", terms: ["art", "gallery", "museum", "design", "painting", "photo"] },
  { category: "interests", label: "Fitness", terms: ["gym", "run", "running", "yoga", "fitness", "workout", "hike"] },
  { category: "interests", label: "Study", terms: ["study", "school", "class", "reading", "book", "library", "work"] },
  { category: "interests", label: "Outdoors", terms: ["park", "outside", "outdoor", "sun", "beach", "trail"] },
  { category: "intent", label: "Quick hello", terms: ["hello", "hi", "meet", "nearby", "say hi"] },
  { category: "intent", label: "Low pressure", terms: ["casual", "easy", "no rush", "low pressure", "chill"] },
  { category: "intent", label: "Plan soon", terms: ["soon", "now", "available", "free", "time", "when"] },
  { category: "socialStyle", label: "Public spot", terms: ["public", "safe", "open", "cafe", "park", "spot"] },
  { category: "socialStyle", label: "Curious", terms: ["curious", "learn", "explore", "try", "new"] },
  { category: "socialStyle", label: "Friendly", terms: ["friendly", "kind", "warm", "chat", "talk"] },
];
const preferenceDimensions = [
  { key: "social_openness", label: "Social openness", terms: ["meet", "chat", "talk", "new people", "open", "social", "conversation"] },
  { key: "social_energy", label: "Social energy", terms: ["energetic", "lively", "party", "group", "excited", "outgoing"] },
  { key: "pace_leisurely", label: "Leisurely pace", terms: ["slow", "leisurely", "no rush", "easy", "calm", "relaxed", "wander"] },
  { key: "pace_spontaneous", label: "Spontaneous pace", terms: ["spontaneous", "now", "soon", "quick", "impromptu", "free"] },
  { key: "mood_reflective", label: "Reflective mood", terms: ["reflective", "quiet", "thoughtful", "deep", "low key", "low-key"] },
  { key: "mood_playful", label: "Playful mood", terms: ["fun", "playful", "laugh", "silly", "adventure", "try something"] },
  { key: "food_adventurous", label: "Adventurous food", terms: ["new food", "try", "adventurous", "spicy", "tacos", "sushi", "street food"] },
  { key: "food_coffee", label: "Coffee friendly", terms: ["coffee", "cafe", "latte", "espresso", "tea", "matcha"] },
  { key: "food_light_bites", label: "Light bites", terms: ["snack", "light bite", "pastry", "dessert", "brunch", "small bite"] },
  { key: "public_comfort", label: "Public spot comfort", terms: ["public", "safe", "cafe", "park", "open", "well lit", "nearby spot"] },
  { key: "quiet_preference", label: "Quiet preference", terms: ["quiet", "calm", "less crowded", "peaceful", "low noise"] },
  { key: "group_comfort", label: "Group comfort", terms: ["group", "friends", "crowd", "event", "meetup"] },
  { key: "planning_directness", label: "Direct planning", terms: ["plan", "time", "where", "when", "specific", "decide"] },
  { key: "curiosity", label: "Curiosity", terms: ["curious", "learn", "explore", "discover", "new", "museum", "gallery"] },
  { key: "safety_priority", label: "Safety priority", terms: ["safe", "public", "comfortable", "boundaries", "low pressure", "no pressure"] },
];
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'inline-speculation-rules' chrome-extension:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  };
}

function json(res, status, payload) {
  res.writeHead(status, responseHeaders("application/json; charset=utf-8"));
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function cleanText(value, maxLength = 80) {
  return String(value || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function repairAiSpacing(value) {
  return String(value || "")
    .replace(/\b(coffee)(walk|chat|hello|nearby|want|sounds|if|and)\b/gi, "$1 $2")
    .replace(/\b(walk)(feeling|keeping|asking|want|wanna|would|where|what|when|with|nearby|sounds|feels|if|and)\b/gi, "$1 $2")
    .replace(/\b(chat)(want|wanna|would|where|what|when|with|nearby|sounds|if|and)\b/gi, "$1 $2")
    .replace(/\b(nearby)(if|and|with|sounds|feels|when)\b/gi, "$1 $2")
    .replace(/\b(easy)(if|and|with|when)\b/gi, "$1 $2")
    .replace(/\b(vibe)(over|nearby)\b/gi, "$1 $2")
    .replace(/\b(calm)(walk|chat|spot)\b/gi, "$1 $2");
}

function repairAwkwardAiPhrase(value) {
  const text = String(value || "").trim();
  if (/^hey!?\s*spotted you\b/i.test(text)) {
    return "Hey, coffee and a walk sound easy. Want to say hi nearby?";
  }
  if (/\b(spotted|watching|saw)\s+you\b/i.test(text)) {
    return text.replace(/\b(spotted|watching|saw)\s+you\b/gi, "noticed we both");
  }
  return text;
}

function cleanAiSuggestion(value) {
  const normalized = String(value || "")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, " - ")
    .replace(/[*_`~]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
  return cleanText(repairAwkwardAiPhrase(repairAiSpacing(normalized)), 180)
    .replace(/"/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/\s+([?.!,])/g, "$1")
    .trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = AI_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "NA";
}

function connectionKey(firstUserId, secondUserId) {
  return [firstUserId, secondUserId].sort().join(":");
}

function isActive(user) {
  return Date.now() - user.lastSeen < PRESENCE_TIMEOUT_MS;
}

function distanceMeters(first, second) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(first.lat);
  const lat2 = toRadians(second.lat);
  const deltaLat = toRadians(second.lat - first.lat);
  const deltaLng = toRadians(second.lng - first.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function unique(values, limit = 6) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function normalizeForAgent(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function includesTerm(normalizedText, term) {
  const normalizedTerm = normalizeForAgent(term);
  return normalizedTerm && ` ${normalizedText} `.includes(` ${normalizedTerm} `);
}

function outgoingMessagesFor(userId) {
  const outgoing = [];
  for (const thread of messages.values()) {
    for (const message of thread) {
      if (message.from === userId) outgoing.push(message);
    }
  }
  return outgoing.sort((a, b) => a.createdAt - b.createdAt);
}

function collectCharacteristics(text) {
  const normalized = ` ${normalizeForAgent(text)} `;
  const buckets = { interests: [], intent: [], socialStyle: [] };
  for (const rule of characteristicRules) {
    if (rule.terms.some((term) => includesTerm(normalized, term))) {
      buckets[rule.category].push(rule.label);
    }
  }
  return {
    interests: unique(buckets.interests, 5),
    intent: unique(buckets.intent, 4),
    socialStyle: unique(buckets.socialStyle, 4),
  };
}

function profileAnswerText(user) {
  const profile = user.preferenceProfile || {};
  return [
    profile.intent,
    profile.food,
    profile.energy,
    profile.mood,
    profile.pace,
    profile.notes,
  ].map((value) => cleanText(value, 260)).filter(Boolean).join(" ");
}

function scorePreferenceDimensions(text) {
  const normalized = normalizeForAgent(text);
  const dimensions = {};
  for (const dimension of preferenceDimensions) {
    const hits = dimension.terms.filter((term) => includesTerm(normalized, term)).length;
    const score = Math.max(0.08, Math.min(0.96, 0.26 + hits * 0.18));
    dimensions[dimension.key] = {
      label: dimension.label,
      score: Number(score.toFixed(2)),
    };
  }
  return dimensions;
}

function topDimensions(dimensions, limit = 5) {
  return Object.entries(dimensions)
    .filter(([, value]) => value.score >= 0.44)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([key, value]) => ({ key, label: value.label, score: value.score }));
}

function profileCompleteness(user, outgoingCount) {
  const profile = user.preferenceProfile || {};
  const answerCount = ["intent", "food", "energy", "mood", "pace", "notes"].filter((key) => cleanText(profile[key], 260)).length;
  return Math.min(1, answerCount / 4 + Math.min(outgoingCount, 4) * 0.06);
}

function embeddingFromDimensions(dimensions) {
  return preferenceDimensions.map((dimension) => dimensions[dimension.key]?.score || 0);
}

function cosineSimilarity(firstVector = [], secondVector = []) {
  let dot = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;
  for (let index = 0; index < Math.min(firstVector.length, secondVector.length); index += 1) {
    dot += firstVector[index] * secondVector[index];
    firstMagnitude += firstVector[index] ** 2;
    secondMagnitude += secondVector[index] ** 2;
  }
  if (!firstMagnitude || !secondMagnitude) return 0;
  return dot / (Math.sqrt(firstMagnitude) * Math.sqrt(secondMagnitude));
}

function dimensionOverlaps(firstSchema, secondSchema) {
  const first = firstSchema.structuredProfile?.dimensions || {};
  const second = secondSchema.structuredProfile?.dimensions || {};
  return preferenceDimensions
    .map((dimension) => {
      const firstScore = first[dimension.key]?.score || 0;
      const secondScore = second[dimension.key]?.score || 0;
      return {
        key: dimension.key,
        label: dimension.label,
        score: Number(Math.min(firstScore, secondScore).toFixed(2)),
      };
    })
    .filter((dimension) => dimension.score >= 0.54)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function matchArchetype(sharedSignals, overlaps) {
  const labels = new Set([...sharedSignals, ...overlaps.map((overlap) => overlap.label)]);
  if (labels.has("Coffee") || labels.has("Coffee friendly")) return "Coffee-walk compatibility";
  if (labels.has("Quiet preference") || labels.has("Reflective mood")) return "Quiet-understanding match";
  if (labels.has("Spontaneous pace") || labels.has("Plan soon")) return "Spontaneous nearby match";
  if (labels.has("Curiosity") || labels.has("Art")) return "Curious local explorers";
  if (labels.has("Public spot comfort") || labels.has("Low pressure")) return "Low-pressure public hello";
  return "Nearby compatibility";
}

function conversationStarters(other, sharedSignals, overlaps) {
  const lowerSignals = new Set(sharedSignals.map((signal) => signal.toLowerCase()));
  const lowerOverlaps = new Set(overlaps.map((overlap) => overlap.label.toLowerCase()));
  const starters = [];
  if (lowerSignals.has("coffee") || lowerOverlaps.has("coffee friendly")) {
    starters.push(`Ask ${other.name} if a quick coffee nearby sounds easy.`);
  }
  if (lowerSignals.has("walks") || lowerOverlaps.has("leisurely pace")) {
    starters.push(`Suggest a low-pressure walk and let them choose the pace.`);
  }
  if (lowerOverlaps.has("quiet preference") || lowerOverlaps.has("reflective mood")) {
    starters.push(`Open with something calm, like asking what kind of spot feels comfortable.`);
  }
  if (lowerOverlaps.has("curiosity")) {
    starters.push(`Ask what nearby place they have been curious to try.`);
  }
  starters.push(`Keep the first message warm and easy: "Want to say hi nearby?"`);
  return unique(starters, 3);
}

function schemaSummary(characteristics) {
  const pieces = [
    characteristics.interests[0] && `likes ${characteristics.interests[0].toLowerCase()}`,
    characteristics.intent[0] && `intent: ${characteristics.intent[0].toLowerCase()}`,
    characteristics.socialStyle[0] && `style: ${characteristics.socialStyle[0].toLowerCase()}`,
  ].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : "still learning from profile and chat signals";
}

function buildCharacteristicSchema(user, reason = "profile") {
  const outgoing = outgoingMessagesFor(user.id).slice(-12);
  const interviewText = profileAnswerText(user);
  const profileText = [user.activity, ...(user.tags || []), interviewText, interviewText].join(" ");
  const chatText = outgoing.map((message) => message.text).join(" ");
  const characteristics = collectCharacteristics(`${profileText} ${chatText}`);
  const dimensions = scorePreferenceDimensions(`${profileText} ${chatText}`);
  const embedding = embeddingFromDimensions(dimensions);
  const completeness = profileCompleteness(user, outgoing.length);
  const genericTags = new Set(["nearby", "hello", "available", "now"]);
  const fallbackTags = (user.tags || [])
    .map((tag) => cleanText(tag, 18))
    .filter((tag) => tag && !genericTags.has(tag.toLowerCase()));
  if (characteristics.interests.length === 0) characteristics.interests = unique(fallbackTags, 3);

  return {
    version: 1,
    userId: user.id,
    agentName: `${user.name}'s match agent`,
    updatedAt: Date.now(),
    updatedBecause: reason,
    source: {
      profile: true,
      ownChatMessages: outgoing.length,
    },
    characteristics,
    structuredProfile: {
      dimensions,
      topDimensions: topDimensions(dimensions),
      completeness: Number(completeness.toFixed(2)),
      profileSummary: schemaSummary(characteristics),
    },
    embedding,
    summary: schemaSummary(characteristics),
  };
}

function updateCharacteristicSchema(userId, reason = "profile") {
  const user = users.get(userId);
  if (!user) return null;
  const schema = buildCharacteristicSchema(user, reason);
  user.characteristicSchema = schema;
  profileSchemas.set(userId, schema);
  vectorStore.set(userId, schema.embedding);
  return schema;
}

function schemaFor(user) {
  return profileSchemas.get(user.id) || updateCharacteristicSchema(user.id);
}

function publicAgentSchema(user) {
  const schema = schemaFor(user);
  if (!schema) return null;
  return {
    summary: schema.summary,
    characteristics: schema.characteristics,
    structuredProfile: {
      topDimensions: schema.structuredProfile.topDimensions,
      completeness: schema.structuredProfile.completeness,
      vibeTags: unique([
        ...schema.characteristics.interests,
        ...schema.characteristics.intent,
        ...schema.characteristics.socialStyle,
        ...schema.structuredProfile.topDimensions.slice(0, 3).map((dimension) => dimension.label),
      ], 6),
    },
    updatedAt: schema.updatedAt,
  };
}

function sharedValues(first = [], second = []) {
  const secondSet = new Set(second);
  return first.filter((value) => secondSet.has(value));
}

function agentMatchRecommendation(viewer, other) {
  const viewerSchema = schemaFor(viewer);
  const otherSchema = schemaFor(other);
  if (!viewerSchema || !otherSchema) return null;

  const sharedInterests = sharedValues(viewerSchema.characteristics.interests, otherSchema.characteristics.interests);
  const sharedIntent = sharedValues(viewerSchema.characteristics.intent, otherSchema.characteristics.intent);
  const sharedStyle = sharedValues(viewerSchema.characteristics.socialStyle, otherSchema.characteristics.socialStyle);
  const overlaps = dimensionOverlaps(viewerSchema, otherSchema);
  const viewerVector = vectorStore.get(viewer.id) || viewerSchema.embedding || [];
  const otherVector = vectorStore.get(other.id) || otherSchema.embedding || [];
  const vectorSimilarity = cosineSimilarity(viewerVector, otherVector);
  const profileConfidence = Math.min(
    viewerSchema.structuredProfile?.completeness || 0,
    otherSchema.structuredProfile?.completeness || 0,
  );
  const distance = distanceMeters(viewer, other);
  let score = 34;
  score += Math.round(vectorSimilarity * 28 * profileConfidence);
  score += Math.min(sharedInterests.length * 18, 38);
  score += Math.min(sharedIntent.length * 5, 10);
  score += Math.min(sharedStyle.length * 7, 14);
  score += Math.min(overlaps.length * 4, 12);
  score += distance <= 400 ? 8 : distance <= 900 ? 5 : 2;
  if (profileConfidence < 0.25) score = Math.min(score, 52);

  const sharedSignals = unique([...sharedInterests, ...sharedIntent, ...sharedStyle], 4);
  const meaningfulSignals = unique([...sharedInterests, ...sharedStyle], 4);
  const decision = score >= 72 ? "strong" : score >= 56 ? "recommended" : score >= 44 ? "light" : "low";
  const headline = decision === "strong"
    ? "Strong match"
    : decision === "recommended"
      ? "Recommended"
      : decision === "light"
        ? "Light signal"
        : "Low signal";
  const reason = meaningfulSignals.length
    ? `Shared ${meaningfulSignals.map((signal) => signal.toLowerCase()).join(", ")} signals.`
    : overlaps.length
      ? `Preference vectors overlap on ${overlaps.slice(0, 2).map((overlap) => overlap.label.toLowerCase()).join(" and ")}.`
      : sharedIntent.length
      ? "Similar availability, but not enough interest or style signals yet."
      : "Not enough shared signals yet, so keep the first hello light.";
  const archetype = meaningfulSignals.length || overlaps.length ? matchArchetype(sharedSignals, overlaps) : "Light nearby signal";

  return {
    score: Math.max(20, Math.min(96, score)),
    decision,
    headline,
    archetype,
    reason,
    sharedSignals,
    dimensionOverlaps: overlaps,
    vectorSimilarity: Number(vectorSimilarity.toFixed(2)),
    viewerAgent: viewerSchema.summary,
    otherAgent: otherSchema.summary,
    conversationStarters: conversationStarters(other, sharedSignals, overlaps),
    recommended: score >= 56,
  };
}

function relativePosition(viewer, other) {
  const latScale = 69;
  const lngScale = 69 * Math.cos((viewer.lat * Math.PI) / 180);
  const xMiles = (other.lng - viewer.lng) * lngScale;
  const yMiles = (viewer.lat - other.lat) * latScale;
  const clamp = (number) => Math.max(10, Math.min(90, number));
  return { left: `${clamp(50 + xMiles * 35)}%`, top: `${clamp(50 + yMiles * 35)}%` };
}

function publicPerson(viewer, other) {
  const distance = distanceMeters(viewer, other);
  return {
    id: other.id,
    name: other.name,
    initials: initials(other.name),
    distance: `${Math.max(0.1, distance / ONE_MILE_METERS).toFixed(1)} mi`,
    activity: other.activity,
    tags: other.tags,
    avatar: other.avatar,
    position: relativePosition(viewer, other),
    location: { lat: other.lat, lng: other.lng },
    agentSchema: publicAgentSchema(other),
    matchRecommendation: agentMatchRecommendation(viewer, other),
  };
}

function chatHistoryFor(firstUserId, secondUserId) {
  return messages.get(connectionKey(firstUserId, secondUserId)) || [];
}

function fallbackAiSuggestion(viewer, other, history, variantIndex = 0) {
  const recent = history[history.length - 1];
  const compatibility = agentMatchRecommendation(viewer, other);
  const signals = compatibility?.sharedSignals || [];
  const overlaps = compatibility?.dimensionOverlaps || [];
  const hasSignal = (value) => signals.some((signal) => signal.toLowerCase().includes(value))
    || overlaps.some((overlap) => overlap.label.toLowerCase().includes(value));
  const pick = (options) => options[variantIndex % options.length];

  if (!recent) {
    const options = [];
    if (hasSignal("coffee")) options.push(
      `Hey ${other.name}, want to grab a quick coffee nearby if it feels easy?`,
      `Coffee sounds like a good overlap. Want to pick a close public cafe?`,
      `Want to start simple with coffee somewhere nearby?`,
      `Would a quick coffee feel like an easy first hello?`,
    );
    if (hasSignal("walk") || hasSignal("leisurely")) options.push(
      `Hey ${other.name}, want to take a low-pressure walk nearby?`,
      `A short easy walk could be nice. Want to keep it casual?`,
      `Want to say hi with a no-rush walk nearby?`,
      `A relaxed walk sounds like a good pace. Want to try that?`,
    );
    if (hasSignal("quiet") || hasSignal("reflective")) options.push(
      `Hey ${other.name}, want to say hi somewhere calm nearby?`,
      `A quieter spot sounds good to me. Want to choose one nearby?`,
      `Want to keep the first hello low-key and easy?`,
      `Something calm and public sounds good. What kind of spot feels right?`,
    );
    if (hasSignal("curious") || hasSignal("art")) options.push(
      `Hey ${other.name}, what nearby place have you been curious to try?`,
      `Want to compare one local spot each of us has been curious about?`,
      `Curious to try somewhere nearby together?`,
      `What is one nearby place you have been meaning to check out?`,
    );
    if (options.length) return pick(unique(options, 16));
    return pick([
      `Hey ${other.name}, nice to connect. Want to say hi somewhere nearby?`,
      `Want to keep it easy and say hi nearby?`,
      `Nice to connect. What kind of nearby hello feels good?`,
      `Want to start with a quick low-pressure hello?`,
      `Happy to keep this easy. What kind of nearby spot feels comfortable?`,
    ]);
  }

  if (recent.from === viewer.id) return "";
  const lower = recent.text.toLowerCase();
  if (lower.includes("time") || lower.includes("when")) return pick([
    "I can do soon. What time works best for you?",
    "Soon works for me. Want to pick a time that feels easy?",
    "I have some flexibility. What time feels comfortable?",
    "A little later works too. What timing is easiest for you?",
  ]);
  if (lower.includes("where") || lower.includes("spot") || lower.includes("meet")) return pick([
    "A close, public spot works for me. What place feels easy?",
    "Somewhere public and nearby sounds good. Any spot you like?",
    "I am good with somewhere nearby and low-key. Want to choose?",
    "A simple public spot sounds best. What feels comfortable?",
  ]);
  if (lower.includes("coffee") || lower.includes("cafe")) return pick([
    "Coffee sounds easy. Want to pick a close public cafe?",
    "I'm down for coffee. Want to keep it nearby?",
    "A nearby cafe works for me. Any place you like?",
    "Coffee is perfect. Want to make it quick and casual?",
  ]);
  if (lower.includes("walk")) return pick([
    "A short walk works for me. Want to keep it casual and nearby?",
    "A quick walk sounds nice. Want to choose the route?",
    "A relaxed walk sounds good. Want to keep it short?",
    "I am up for a low-pressure walk nearby.",
  ]);
  return pick([
    "That sounds good. Want to keep it casual and say hi nearby?",
    "I like that. Want to keep the first hello easy?",
    "Sounds good to me. What would feel low-pressure?",
    "That works for me. Want to keep it simple and nearby?",
    "Nice, I am open to that. What feels easiest?",
  ]);
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join(" ");
}

function draftPrompt(viewer, other, history) {
  const recentMessages = history.slice(-8).map((message) => ({
    speaker: message.from === viewer.id ? "You" : other.name,
    text: message.text,
  }));
  const compatibility = agentMatchRecommendation(viewer, other);
  return {
    instructions: [
      "Draft one short chat message for an opted-in nearby social app.",
      "Keep it warm, casual, low-pressure, and under 22 words.",
      "Use plain text only: no markdown, no emoji, no quotation marks, and no exact addresses.",
      "Do not say spotted you, saw you, watching you, or anything that implies surveillance.",
      "Do not mention AI. Do not include exact coordinates, addresses, or private data.",
      "You may use the compatibility archetype and shared vibe tags if helpful.",
      "Return only the message text.",
    ].join(" "),
    context: {
      you: viewer.name,
      chattingWith: other.name,
      approximateDistance: publicPerson(viewer, other).distance,
      theirActivity: other.activity,
      theirTags: other.tags,
      yourAgentSummary: schemaFor(viewer)?.summary,
      theirAgentSummary: schemaFor(other)?.summary,
      compatibility: compatibility ? {
        archetype: compatibility.archetype,
        sharedSignals: compatibility.sharedSignals,
        dimensionOverlaps: compatibility.dimensionOverlaps,
        conversationStarters: compatibility.conversationStarters,
      } : null,
      recentMessages,
    },
  };
}

function extractChatCompletionText(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

async function digitalOceanSuggestion(viewer, other, history) {
  if (!DIGITALOCEAN_INFERENCE_KEY || typeof fetch !== "function") return null;
  const prompt = draftPrompt(viewer, other, history);
  const response = await fetchWithTimeout(`${DIGITALOCEAN_INFERENCE_BASE_URL.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DIGITALOCEAN_INFERENCE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DIGITALOCEAN_INFERENCE_MODEL,
      messages: [
        { role: "system", content: prompt.instructions },
        { role: "user", content: JSON.stringify(prompt.context) },
      ],
      temperature: 0.4,
      max_tokens: 60,
    }),
  });

  if (!response.ok) throw new Error(`DigitalOcean inference request failed with status ${response.status}`);
  return cleanAiSuggestion(extractChatCompletionText(await response.json()));
}

async function openAiSuggestion(viewer, other, history) {
  if (!process.env.OPENAI_API_KEY || typeof fetch !== "function") return null;
  const prompt = draftPrompt(viewer, other, history);
  const response = await fetchWithTimeout(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "developer",
          content: prompt.instructions,
        },
        {
          role: "user",
          content: JSON.stringify(prompt.context),
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed with status ${response.status}`);
  return cleanAiSuggestion(extractOpenAiText(await response.json()));
}

async function generateAiSuggestion(viewer, other) {
  const history = chatHistoryFor(viewer.id, other.id);
  try {
    const suggestion = await digitalOceanSuggestion(viewer, other, history);
    if (suggestion) return { suggestion, provider: "digitalocean", model: DIGITALOCEAN_INFERENCE_MODEL };
  } catch (error) {
    console.warn(error.message);
  }
  try {
    const suggestion = await openAiSuggestion(viewer, other, history);
    if (suggestion) return { suggestion, provider: "openai", model: OPENAI_MODEL };
  } catch (error) {
    console.warn(error.message);
  }
  const key = connectionKey(viewer.id, other.id);
  const draftCount = draftCounts.get(key) || 0;
  draftCounts.set(key, draftCount + 1);
  return { suggestion: fallbackAiSuggestion(viewer, other, history, draftCount), provider: "local", model: null };
}

function incomingWaves(userId) {
  const viewer = users.get(userId);
  return [...waves.values()]
    .filter((wave) => wave.to === userId && wave.status === "pending")
    .map((wave) => {
      const sender = users.get(wave.from);
      if (!sender || !isActive(sender)) return null;
      return { id: wave.id, from: publicPerson(viewer, sender), createdAt: wave.createdAt };
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function connectedPeople(user) {
  return [...users.values()]
    .filter((other) => other.id !== user.id && isActive(other))
    .filter((other) => connections.has(connectionKey(user.id, other.id)))
    .map((other) => publicPerson(user, other));
}

function stateFor(userId) {
  const user = users.get(userId);
  if (!user) return null;
  const nearby = [...users.values()]
    .filter((other) => other.id !== user.id && other.visible && isActive(other))
    .map((other) => ({ other, distance: distanceMeters(user, other) }))
    .filter(({ distance }) => distance <= ONE_MILE_METERS)
    .sort((a, b) => a.distance - b.distance)
    .map(({ other }) => publicPerson(user, other));
  const connected = connectedPeople(user);
  const chatMessages = {};
  for (const person of connected) chatMessages[person.id] = messages.get(connectionKey(user.id, person.id)) || [];

  return {
    self: { id: user.id, name: user.name, initials: initials(user.name), visible: user.visible, agentSchema: publicAgentSchema(user) },
    nearby,
    incomingWaves: incomingWaves(userId),
    sentWaves: [...waves.values()].filter((wave) => wave.from === userId && wave.status === "pending").map((wave) => wave.to),
    connected,
    messages: chatMessages,
    updatedAt: Date.now(),
  };
}

function sendState(userId) {
  const state = stateFor(userId);
  const streams = eventStreams.get(userId);
  if (!state || !streams) return;
  for (const stream of streams) stream.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
}

function broadcastState() {
  for (const userId of users.keys()) sendState(userId);
}

function removeUser(userId) {
  users.delete(userId);
  profileSchemas.delete(userId);
  vectorStore.delete(userId);
  eventStreams.delete(userId);
  for (const [waveId, wave] of waves) {
    if (wave.from === userId || wave.to === userId) waves.delete(waveId);
  }
  for (const key of connections) {
    if (key.split(":").includes(userId)) {
      connections.delete(key);
      messages.delete(key);
    }
  }
}

function serveStatic(res, pathname) {
  const file = staticFiles.get(pathname);
  if (!file) return false;
  const [fileName, contentType] = file;
  fs.readFile(path.join(ROOT, fileName), (error, contents) => {
    if (error) return json(res, 500, { error: "Could not load app file" });
    res.writeHead(200, responseHeaders(contentType));
    res.end(contents);
  });
  return true;
}

async function handleApi(req, res, pathname, url) {
  if (req.method === "GET" && pathname === "/api/health") {
    json(res, 200, { ok: true, service: "neara", updatedAt: Date.now() });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    const state = stateFor(url.searchParams.get("userId"));
    json(res, state ? 200 : 404, state || { error: "Join the nearby area first" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/agent-schema") {
    const user = users.get(cleanText(url.searchParams.get("userId"), 64));
    json(res, user ? 200 : 404, user ? { schema: publicAgentSchema(user) } : { error: "Join the nearby area first" });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const userId = url.searchParams.get("userId");
    if (!users.has(userId)) {
      json(res, 404, { error: "Join the nearby area first" });
      return true;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": connected\n\n");
    if (!eventStreams.has(userId)) eventStreams.set(userId, new Set());
    eventStreams.get(userId).add(res);
    sendState(userId);
    req.on("close", () => {
      const streams = eventStreams.get(userId);
      if (!streams) return;
      streams.delete(res);
      if (streams.size === 0) eventStreams.delete(userId);
    });
    return true;
  }

  if (req.method !== "POST") return false;
  const body = await readJson(req);

  if (pathname === "/api/join") {
    const id = cleanText(body.id, 64);
    const name = cleanText(body.name, 32);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      json(res, 400, { error: "Name and exact location are required" });
      return true;
    }
    const existing = users.get(id);
    const preferenceProfile = {
      intent: cleanText(body.profile?.intent, 260),
      food: cleanText(body.profile?.food, 260),
      energy: cleanText(body.profile?.energy, 260),
      mood: cleanText(body.profile?.mood, 260),
      pace: cleanText(body.profile?.pace, 260),
      notes: cleanText(body.profile?.notes, 260),
    };
    const profileCharacteristics = collectCharacteristics(Object.values(preferenceProfile).join(" "));
    const derivedTags = unique([
      ...profileCharacteristics.interests,
      ...profileCharacteristics.intent,
      ...profileCharacteristics.socialStyle,
    ], 2).map((tag) => tag.toLowerCase());
    const user = {
      id, name, lat, lng,
      visible: body.visible !== false,
      lastSeen: Date.now(),
      activity: cleanText(body.activity, 70) || cleanText(preferenceProfile.intent, 70) || "Available for a nearby hello",
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 2).map((tag) => cleanText(tag, 18)) : derivedTags.length ? derivedTags : ["nearby", "hello"],
      preferenceProfile,
      avatar: existing?.avatar || avatars[users.size % avatars.length],
    };
    users.set(id, user);
    updateCharacteristicSchema(id, existing ? "profile_update" : "profile_join");
    json(res, 200, stateFor(id));
    broadcastState();
    return true;
  }

  if (pathname === "/api/heartbeat") {
    const user = users.get(cleanText(body.id, 64));
    if (!user) {
      json(res, 404, { error: "Session expired" });
      return true;
    }
    user.lastSeen = Date.now();
    if (typeof body.visible === "boolean") user.visible = body.visible;
    if (Number.isFinite(Number(body.lat))) user.lat = Number(body.lat);
    if (Number.isFinite(Number(body.lng))) user.lng = Number(body.lng);
    json(res, 200, stateFor(user.id));
    broadcastState();
    return true;
  }

  if (pathname === "/api/leave") {
    const userId = cleanText(body.id, 64);
    removeUser(userId);
    json(res, 200, { ok: true });
    broadcastState();
    return true;
  }

  if (pathname === "/api/waves") {
    const from = cleanText(body.from, 64);
    const to = cleanText(body.to, 64);
    if (!users.has(from) || !users.has(to) || from === to) {
      json(res, 400, { error: "Both nearby users must be online" });
      return true;
    }
    const existing = [...waves.values()].find((wave) => wave.from === from && wave.to === to && wave.status === "pending");
    if (existing) {
      json(res, 200, existing);
      return true;
    }
    const wave = { id: crypto.randomUUID(), from, to, status: "pending", createdAt: Date.now() };
    waves.set(wave.id, wave);
    json(res, 201, wave);
    sendState(from);
    sendState(to);
    return true;
  }

  const waveResponse = pathname.match(/^\/api\/waves\/([^/]+)\/respond$/);
  if (waveResponse) {
    const wave = waves.get(waveResponse[1]);
    const userId = cleanText(body.userId, 64);
    if (!wave || wave.to !== userId || wave.status !== "pending") {
      json(res, 404, { error: "This wave is no longer available" });
      return true;
    }
    wave.status = body.accept ? "accepted" : "declined";
    if (body.accept) connections.add(connectionKey(wave.from, wave.to));
    json(res, 200, wave);
    sendState(wave.from);
    sendState(wave.to);
    return true;
  }

  if (pathname === "/api/messages") {
    const from = cleanText(body.from, 64);
    const to = cleanText(body.to, 64);
    const text = cleanText(body.text, 500);
    const key = connectionKey(from, to);
    if (!text || !users.has(from) || !users.has(to) || !connections.has(key)) {
      json(res, 403, { error: "A mutual chat connection is required" });
      return true;
    }
    const message = { id: crypto.randomUUID(), from, to, text, createdAt: Date.now() };
    if (!messages.has(key)) messages.set(key, []);
    messages.get(key).push(message);
    if (messages.get(key).length > 100) messages.get(key).shift();
    updateCharacteristicSchema(from, "chat_message");
    json(res, 201, message);
    sendState(from);
    sendState(to);
    return true;
  }

  if (pathname === "/api/ai/suggest-message") {
    const userId = cleanText(body.userId, 64);
    const personId = cleanText(body.personId, 64);
    const viewer = users.get(userId);
    const other = users.get(personId);
    const key = connectionKey(userId, personId);
    if (!viewer || !other || !connections.has(key)) {
      json(res, 403, { error: "A mutual chat connection is required for AI drafts" });
      return true;
    }
    const history = chatHistoryFor(userId, personId);
    if (history[history.length - 1]?.from === userId) {
      json(res, 409, { error: "You already sent the last message. Wait for their reply before drafting again." });
      return true;
    }
    const draft = await generateAiSuggestion(viewer, other);
    json(res, 200, draft);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url.pathname, url);
      if (!handled) json(res, 404, { error: "API route not found" });
      return;
    }
    if (!serveStatic(res, url.pathname)) json(res, 404, { error: "Page not found" });
  } catch (error) {
    if (!res.headersSent) json(res, 400, { error: error.message || "Request failed" });
  }
});

setInterval(() => {
  let changed = false;
  for (const [userId, user] of users) {
    if (!isActive(user)) {
      removeUser(userId);
      changed = true;
    }
  }
  if (changed) broadcastState();
}, 20_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Neara realtime server running at http://${HOST}:${PORT}`);
});
