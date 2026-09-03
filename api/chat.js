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
//   ALLOWED_ORIGINS      -> comma-separated list of origins allowed to call
//                            this endpoint, e.g.
//                            "https://rucrak.com,https://www.rucrak.com,https://rucrak-crew-chief.vercel.app"
//                            Defaults to "*" (open, any origin) if unset —
//                            set this before/when going live on rucrak.com.
//                            CORS only supports echoing back ONE matched
//                            origin per request (not a literal list in the
//                            header), so this checks the incoming request's
//                            Origin against the allowlist and echoes back
//                            the exact match — this is the standard pattern
//                            for supporting several specific origins at once.

const SYSTEM_PROMPT = require('./_prompt.js');
const { applyLivePricing } = require('./_live_pricing.js');
const { handleEscalation, logMarketingInfo, logPromoOptin } = require('./_notify.js');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function resolveAllowedOrigin(requestOrigin) {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  // No match — return the first configured origin rather than nothing, so
  // the header is never simply missing (some browsers/tools behave oddly
  // with no CORS header at all vs. an explicit non-matching one). A direct,
  // non-browser caller (like Vapi's server-side webhook) doesn't send an
  // Origin header and isn't affected by this either way.
  return ALLOWED_ORIGINS[0] || "*";
}

// --- Escalation marker parsing -----------------------------------------------
// Text mode has no tool-calling wired up (see api/log-escalation.js for the
// voice-mode equivalent, which uses a real Vapi tool instead). When the model
// decides to escalate, it appends a line like:
//   @@ESCALATE@@{"question":"...","customerName":"...","customerContact":"..."}@@END@@
// This strips that line out before the customer ever sees it, and returns the
// parsed details (or null if no escalation marker was present).
const ESCALATION_MARKER_RE = /@@ESCALATE@@(.*?)@@END@@/s;

function extractEscalation(replyText) {
  const match = replyText.match(ESCALATION_MARKER_RE);
  if (!match) return { cleanText: replyText, escalation: null };

  const cleanText = replyText.replace(ESCALATION_MARKER_RE, "").trim();
  let escalation = null;
  try {
    const parsed = JSON.parse(match[1]);
    escalation = {
      question: parsed.question || "(not specified)",
      customerName: parsed.customerName || null,
      customerContact: parsed.customerContact || null
    };
  } catch (err) {
    console.error("Failed to parse escalation marker JSON (non-fatal):", err.message, "raw:", match[1]);
  }
  return { cleanText, escalation };
}

// --- Promo opt-in marker parsing ---------------------------------------------
// Same pattern again, third tag:
//   @@PROMO_OPTIN@@{"contactMethod":"...","contactType":"email or phone"}@@END@@
const PROMO_OPTIN_MARKER_RE = /@@PROMO_OPTIN@@(.*?)@@END@@/s;

function extractPromoOptin(replyText) {
  const match = replyText.match(PROMO_OPTIN_MARKER_RE);
  if (!match) return { cleanText: replyText, promoOptin: null };

  const cleanText = replyText.replace(PROMO_OPTIN_MARKER_RE, "").trim();
  let promoOptin = null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.contactMethod) {
      promoOptin = {
        contactMethod: parsed.contactMethod,
        contactType: parsed.contactType || null
      };
    }
  } catch (err) {
    console.error("Failed to parse promo-optin marker JSON (non-fatal):", err.message, "raw:", match[1]);
  }
  return { cleanText, promoOptin };
}
// --- Marketing info marker parsing -------------------------------------------
// Same pattern as the escalation marker, different tag:
//   @@CUSTOMER_INFO@@{"vehicle":"...","region":"...","referralSource":"...","useCase":"..."}@@END@@
// Any field not actually known should be omitted by the model rather than
// guessed — this just passes through whatever's present.
const CUSTOMER_INFO_MARKER_RE = /@@CUSTOMER_INFO@@(.*?)@@END@@/s;

function extractCustomerInfo(replyText) {
  const match = replyText.match(CUSTOMER_INFO_MARKER_RE);
  if (!match) return { cleanText: replyText, customerInfo: null };

  const cleanText = replyText.replace(CUSTOMER_INFO_MARKER_RE, "").trim();
  let customerInfo = null;
  try {
    const parsed = JSON.parse(match[1]);
    customerInfo = {
      vehicle: parsed.vehicle || null,
      region: parsed.region || null,
      referralSource: parsed.referralSource || null,
      useCase: parsed.useCase || null
    };
  } catch (err) {
    console.error("Failed to parse customer-info marker JSON (non-fatal):", err.message, "raw:", match[1]);
  }
  return { cleanText, customerInfo };
}
// --- Add-to-cart marker parsing ----------------------------------------------
// Same pattern again:
//   @@ADD_TO_CART@@{"items":[{"variantId":"...","quantity":1,"label":"..."}],"applyDiscount":false}@@END@@
// This one is different from the others in one way: it's not just a logging
// signal, it's actually an instruction the FRONTEND acts on (calling our
// real cart API from the customer's own browser session). The backend here
// just extracts and validates the shape — the actual cart mutation happens
// client-side, since that's the only place with access to the customer's
// real cart session.
//
// Accepts MULTIPLE items in one marker -- see api/_cart.js for why this
// matters: previously this only ever handled one item, requiring the model
// to reliably remember to send a SECOND marker in a follow-up reply for
// anything else that needed adding (a necessary accessory/extension
// alongside a main product) -- and that hand-off is exactly where real,
// confirmed failures kept happening. One marker, one or more items, one
// real cart action.
const ADD_TO_CART_MARKER_RE = /@@ADD_TO_CART@@(.*?)@@END@@/s;

function extractAddToCart(replyText) {
  const match = replyText.match(ADD_TO_CART_MARKER_RE);
  if (!match) return { cleanText: replyText, addToCart: null };

  const cleanText = replyText.replace(ADD_TO_CART_MARKER_RE, "").trim();
  let addToCart = null;
  try {
    const parsed = JSON.parse(match[1]);
    let rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    // Defensive: accept the old flat single-item shape too, in case the
    // model falls back to it during the prompt transition.
    if (rawItems.length === 0 && parsed.variantId) {
      rawItems = [{ variantId: parsed.variantId, quantity: parsed.quantity, label: parsed.label }];
    }
    const items = rawItems
      .map((item) => {
        const variantId = String((item && item.variantId) || "").trim();
        const quantity = Number(item && item.quantity) || 1;
        if (variantId && /^\d+$/.test(variantId) && quantity > 0) {
          return { variantId, quantity, label: (item && item.label) || null };
        }
        return null;
      })
      .filter(Boolean);

    if (items.length > 0) {
      addToCart = { items, applyDiscount: parsed.applyDiscount === true };
    } else {
      console.error("Add-to-cart marker had no valid items (non-fatal):", match[1]);
    }
  } catch (err) {
    console.error("Failed to parse add-to-cart marker JSON (non-fatal):", err.message, "raw:", match[1]);
  }
  return { cleanText, addToCart };
}
// ----------------------------------------------------------------------------


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
  res.setHeader("Access-Control-Allow-Origin", resolveAllowedOrigin(req.headers.origin));
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
    // Real prices, fetched fresh (or from a short cache) every request --
    // see api/_live_pricing.js for why: baked-in prices in SYSTEM_PROMPT
    // go stale between manual syncs, this eliminates that entirely rather
    // than just alerting on it. Falls back to SYSTEM_PROMPT's own baked-in
    // prices unchanged if this fails for any reason -- a pricing hiccup
    // should never be why a conversation breaks.
    const livePricedSystemPrompt = await applyLivePricing(SYSTEM_PROMPT);

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
        system: livePricedSystemPrompt,
        messages: trimmedMessages
      })
    });

    const data = await anthropicResponse.json();

    if (!anthropicResponse.ok) {
      const apiMsg = (data && data.error && data.error.message) ? data.error.message : JSON.stringify(data);
      // Log the real reason server-side (visible in Vercel's function logs) —
      // but NEVER expose raw API/billing errors to the customer. A credit
      // balance or auth error is an internal problem, not something a
      // customer should ever see verbatim.
      console.error("Anthropic API error:", anthropicResponse.status, apiMsg);
      return res.status(200).json({
        text: "Well shoot, I'm having some trouble getting connected right now — nothing you did wrong. Give it a few minutes and try again, or reach out to rucRak support directly if it keeps up."
      });
    }

    const textBlocks = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    const rawReplyText = textBlocks.join("\n").trim() || "Hang on, lost my train of thought — say that again?";

    // Strip any escalation marker before the customer ever sees it, and fire
    // the notification pipeline (email + Supabase log) if one was present.
    const { cleanText: afterEscalation, escalation } = extractEscalation(rawReplyText);
    if (escalation) {
      handleEscalation({ channel: "text", ...escalation }).catch(() => {});
    }

    // Same deal for the marketing-info marker — can appear in the same reply
    // as an escalation marker, or on its own, or not at all.
    const { cleanText: afterCustomerInfo, customerInfo } = extractCustomerInfo(afterEscalation);
    if (customerInfo) {
      logMarketingInfo({ channel: "text", ...customerInfo }).catch(() => {});
    }

    // And the promo opt-in marker, chained the same way — any combination
    // of these three can appear in a single reply, or none at all.
    const { cleanText: afterPromoOptin, promoOptin } = extractPromoOptin(afterCustomerInfo);
    if (promoOptin) {
      logPromoOptin({ channel: "text", ...promoOptin }).catch(() => {});
    }

    // Add-to-cart is different from the three above: it's not just a backend
    // log, it's an actual instruction the frontend needs to act on (calling
    // Shopify's real cart API from the customer's own browser session, which
    // only the browser has access to). So instead of firing a background
    // pipeline, this one gets passed through in the response itself.
    //
    // Discount generation used to be a separate @@DISCOUNT_CODE@@ text
    // placeholder handled here, coordinated with a separate add-to-cart step.
    // Real feedback: this produced awkward results (Daryl reading a raw
    // generated code string aloud/writing it out) and required correctly
    // coordinating two separate actions. Folded directly into the add-to-cart
    // action itself now (see api/_cart.js's applyDiscount) -- the discount
    // gets embedded straight into the checkout URL, Daryl never sees or
    // needs to mention the raw code at all, and there's only one action to
    // get right instead of two.
    const { cleanText: afterAddToCart, addToCart } = extractAddToCart(afterPromoOptin);

    const replyText = afterAddToCart || "Let me get you the right answer on that — hang tight.";

    // Fire-and-forget: log that this call was handled, without delaying the reply.
    const userMessages = trimmedMessages.filter((m) => m.role === "user");
    const hadImage = userMessages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "image")
    );
    logHandledCall({ userMessages, hadImage }).catch(() => {});

    return res.status(200).json({ text: replyText, addToCart: addToCart || undefined });
  } catch (err) {
    console.error("Server error calling Anthropic API:", err.message);
    return res.status(200).json({
      text: "Well shoot, I'm having some trouble getting connected right now — nothing you did wrong. Give it a few minutes and try again, or reach out to rucRak support directly if it keeps up."
    });
  }
};
