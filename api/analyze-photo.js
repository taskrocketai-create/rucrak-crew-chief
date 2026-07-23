// api/analyze-photo.js
//
// One-shot photo fitment analysis, built specifically for the voice-mode
// "photo mid-call" feature: a customer on a live Vapi voice call taps a
// photo button, this endpoint analyzes it against the same fitment rules
// as everything else, and the frontend injects the result back into the
// live call via vapi.send() so Crew Chief can speak the answer without
// ending the call.
//
// This is NOT a conversational endpoint — no message history, single photo
// (or pair) in, one factual analysis out. Uses the same shared system
// prompt as api/chat.js (api/_prompt.js) so the fitment logic never drifts
// between the text/voice-typed path and this one.
//
// Required environment variable (shared with chat.js):
//   ANTHROPIC_API_KEY
//
// Optional (shared with chat.js):
//   ALLOWED_ORIGIN

const SYSTEM_PROMPT = require('./_prompt.js');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const ANALYSIS_INSTRUCTIONS = `

=== PHOTO-MID-CALL ANALYSIS MODE ===
You are not talking to the customer directly right now. A customer on a LIVE VOICE CALL just sent a photo through a side channel (voice calls can't carry images natively), and this analysis will be handed to another instance of you — the one actually on the call — who will relay it to the customer in their own words and voice.

Because of that:
- Be factual, specific, and complete. Give the actual measurement read, the actual verdict (extensions needed or not, which kit if so), and flag anything genuinely ambiguous or fringe per the calibration rules above.
- Don't worry about spoken delivery, tone, or personality here — that's the other instance's job when it relays this. Just get the analysis right and information-dense.
- Structure it plainly: what you can tell from the photo(s), the verdict, and anything you'd want confirmed (angle issue, need the other photo, close-to-threshold, etc.) if applicable.
- Keep it tight — a few sentences to a short paragraph. This is a handoff note, not a customer-facing message.`;

// Matches the validation in api/chat.js — kept in sync manually since it's small and low-risk.
const MAX_IMAGE_BASE64_CHARS = 3_000_000; // ~2.2MB decoded per image
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 6;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const rateLimitStore = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (rateLimitStore.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  if (rateLimitStore.size > 5000) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    for (const [key, times] of rateLimitStore.entries()) {
      if (times.every((t) => t < cutoff)) rateLimitStore.delete(key);
    }
  }
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "unknown";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server misconfigured: ANTHROPIC_API_KEY is not set in Vercel environment variables."
    });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error: "Too many photo analysis requests too fast. Give it about a minute and try again."
    });
  }

  const { images, note } = req.body || {};

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "Request must include a non-empty 'images' array." });
  }
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ error: `Too many images — max ${MAX_IMAGES} per request.` });
  }

  const imageBlocks = [];
  for (const img of images) {
    if (!img || typeof img.data !== "string" || !img.media_type) {
      return res.status(400).json({ error: "Malformed image entry — expected { media_type, data }." });
    }
    if (!ALLOWED_IMAGE_TYPES.has(img.media_type)) {
      return res.status(400).json({ error: `Unsupported image type: ${img.media_type}` });
    }
    if (img.data.length > MAX_IMAGE_BASE64_CHARS) {
      return res.status(413).json({ error: "Image too large — please attach a smaller photo." });
    }
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data }
    });
  }

  const promptText = (typeof note === "string" && note.trim())
    ? note.trim()
    : "Analyze this photo for rucRak fitment per the FITMENT rules in your instructions. Give a clear, specific verdict.";

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: SYSTEM_PROMPT + ANALYSIS_INSTRUCTIONS,
        messages: [
          {
            role: "user",
            content: [...imageBlocks, { type: "text", text: promptText }]
          }
        ]
      })
    });

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      const apiMsg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
      return res.status(anthropicResponse.status).json({ error: `Anthropic API error: ${apiMsg}` });
    }

    const textBlocks = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    const analysisText = textBlocks.join("\n").trim() || "Couldn't get a clear read on that photo — ask the customer to retake it.";

    return res.status(200).json({ text: analysisText });
  } catch (err) {
    return res.status(500).json({ error: `Server error calling Anthropic API: ${err.message}` });
  }
};
