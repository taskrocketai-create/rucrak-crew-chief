// api/chat.js
//
// Vercel serverless function — this is the ONLY place your Anthropic API key
// lives. It never touches the browser. The frontend (index.html) calls this
// endpoint instead of api.anthropic.com directly.
//
// Required environment variable (set in Vercel project settings):
//   ANTHROPIC_API_KEY   -> your real Anthropic API key
//
// Optional environment variable:
//   ALLOWED_ORIGIN       -> e.g. "https://rucrak.com" to restrict who can call
//                            this endpoint. Defaults to "*" (open) if unset —
//                            you should set this before going live.

const SYSTEM_PROMPT = require('./_prompt.js');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// --- Call log ---------------------------------------------------------------
// Best-effort record of "a question got handled" — nothing fancier than that.
// Requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars; if either is
// missing, logging is silently skipped (never blocks or breaks a chat reply
// over a logging failure — this is a nice-to-have, not a critical path).
function extractPlainText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === "text");
    return textBlock ? textBlock.text : "";
  }
  return "";
}

async function logHandledCall({ userMessages, hadImage }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return; // logging not configured — skip quietly

  const lastUserMessage = userMessages[userMessages.length - 1];
  const firstUserMessage = userMessages[0];

  try {
    await fetch(`${supabaseUrl}/rest/v1/rucrak_chief_calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        first_message: extractPlainText(firstUserMessage && firstUserMessage.content).slice(0, 500),
        last_message: extractPlainText(lastUserMessage && lastUserMessage.content).slice(0, 500),
        message_count: userMessages.length,
        had_image: hadImage
      }])
    });
  } catch (err) {
    // Never let a logging failure break the actual chat response.
    console.error("Call logging failed (non-fatal):", err.message);
  }
}
// ----------------------------------------------------------------------------

// --- Basic rate limiting ---------------------------------------------------
// This is a best-effort, in-memory limiter. Vercel serverless functions are
// stateless between cold starts, so this does NOT guarantee a hard cap across
// all traffic — a function instance can be recycled at any time, resetting
// its counters. What it DOES do: stop a single sustained burst from one
// visitor (the common "someone's mashing the button" case) on a warm
// instance, at zero extra cost and zero extra setup.
//
// For a real guarantee under production traffic, replace this with a shared
// store (Vercel KV or Upstash Redis) — see README.md "Hardening for
// production" section. That requires creating an account/resource, which is
// why it isn't wired in by default here.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 12; // per IP, per window
const rateLimitStore = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (rateLimitStore.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );
  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);

  // Keep the map from growing unbounded on a long-lived warm instance.
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
// ----------------------------------------------------------------------------

module.exports = async (req, res) => {
  // CORS headers so your website's frontend is allowed to call this endpoint
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
      error: "Whoa there — too many messages too fast. Give it about a minute and try again."
    });
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Request must include a non-empty 'messages' array." });
  }

  // Validate any image blocks: reasonable size cap and only jpeg/png/webp/gif,
  // matching what the Anthropic API itself accepts. Kept well under Vercel's
  // default ~4.5MB total request body limit (this is base64 text, plus JSON
  // overhead, plus whatever conversation history is riding along) — a
  // properly client-side-compressed photo (see index.html: 1200px max
  // dimension, JPEG quality 0.82) should land in the low hundreds of KB, so
  // this ceiling is a generous abuse guard, not a normal-use bottleneck.
  const MAX_IMAGE_BASE64_CHARS = 3_000_000; // ~2.2MB decoded per image
  const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type !== "image") continue;
      const src = block.source || {};
      if (src.type !== "base64" || typeof src.data !== "string") {
        return res.status(400).json({ error: "Malformed image block in request." });
      }
      if (!ALLOWED_IMAGE_TYPES.has(src.media_type)) {
        return res.status(400).json({ error: `Unsupported image type: ${src.media_type}` });
      }
      if (src.data.length > MAX_IMAGE_BASE64_CHARS) {
        return res.status(413).json({ error: "Image too large — please attach a smaller photo." });
      }
    }
  }

  // Basic safety cap so one runaway conversation can't balloon cost/latency.
  const trimmedMessages = messages.slice(-40);

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
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: trimmedMessages
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
    const replyText = textBlocks.join("\n").trim() || "Hang on, lost my train of thought — say that again?";

    // Fire-and-forget: log that this call was handled, without delaying the reply.
    const userMessages = trimmedMessages.filter((m) => m.role === "user");
    const hadImage = userMessages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image")
    );
    logHandledCall({ userMessages, hadImage }).catch(() => {});

    return res.status(200).json({ text: replyText });
  } catch (err) {
    return res.status(500).json({ error: `Server error calling Anthropic API: ${err.message}` });
  }
};
