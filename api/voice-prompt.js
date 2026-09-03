// api/voice-prompt.js
//
// Called by the browser right before starting a voice call, returning a
// fresh copy of the voice system prompt with live pricing baked in (see
// api/_voice_prompt.js). The browser passes this back to Vapi via
// assistantOverrides.model.messages when calling vapi.start().
//
// This is the piece that makes voice mode's pricing genuinely live instead
// of frozen at whatever text was last manually pasted into Vapi's
// dashboard. Confirmed directly against Vapi's own API schema before
// building this: assistantOverrides.model and assistantOverrides.voice are
// separate, independent fields -- overriding model.messages here does NOT
// touch or reset the assistant's voice/tone, which stays exactly as
// configured in the Vapi dashboard. Only the system prompt text changes.

const { buildVoiceSystemPrompt } = require('./_voice_prompt.js');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function resolveAllowedOrigin(requestOrigin) {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0] || "*";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", resolveAllowedOrigin(req.headers.origin));
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const systemPrompt = await buildVoiceSystemPrompt();
    return res.status(200).json({ systemPrompt });
  } catch (err) {
    // Should be effectively unreachable -- buildVoiceSystemPrompt already
    // falls back through live pricing failures internally -- but if
    // something still goes wrong, fail loudly here rather than silently:
    // the browser's caller falls back to starting the call with no
    // override at all (using whatever's saved in the Vapi dashboard),
    // which is a real functioning fallback, not a broken call.
    console.error("voice-prompt failed:", err.message);
    return res.status(500).json({ error: "Could not build voice prompt", detail: err.message });
  }
};
