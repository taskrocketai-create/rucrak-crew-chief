// api/log-voice-call.js
//
// Voice-mode equivalent of api/chat.js's logHandledCall — logs every voice
// conversation to the same rucrak_chief_calls table text mode already logs
// to, tagged channel: "voice".
//
// Why this exists: rucrak_chief_calls previously only got rows from
// api/chat.js (text mode). Voice mode had its own escalation logger
// (api/log-escalation.js) but nothing logged ordinary voice conversations,
// so as customers shifted to voice, the call log looked like it had
// "stopped" — it hadn't, voice just was never wired into it.
//
// Called directly from the browser (index.html), not from Vapi — the
// browser already has the full live transcript (voiceTranscriptBuffer,
// built from Vapi's 'transcript' messages) the moment a call ends, so
// there's no need for a separate Vapi server-side end-of-call webhook.
// Fire-and-forget, same pattern as logHandledCall: never lets a logging
// failure affect the actual call experience.
//
// Expected POST body:
//   { transcript: [ { role: "user"|"assistant", text: "..." }, ... ] }

function extractPlainText(text) {
  return String(text || "").trim();
}

function renderTranscript(turns) {
  return turns
    .map((t) => {
      const who = t.role === "user" ? "Customer" : "Daryl";
      const text = extractPlainText(t.text);
      return text ? `${who}: ${text}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

module.exports = async (req, res) => {
  const requestOrigin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", requestOrigin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const turns = Array.isArray(body.transcript) ? body.transcript : [];
    const userTurns = turns.filter((t) => t && t.role === "user" && extractPlainText(t.text));

    // Nothing worth logging (e.g. call connected and ended with no speech).
    if (userTurns.length === 0) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ ok: true, skipped: true }); // logging not configured — skip quietly
    }

    const firstUserMessage = userTurns[0];
    const lastUserMessage = userTurns[userTurns.length - 1];

    await fetch(`${supabaseUrl}/rest/v1/rucrak_chief_calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        channel: "voice",
        first_message: extractPlainText(firstUserMessage.text).slice(0, 500),
        last_message: extractPlainText(lastUserMessage.text).slice(0, 500),
        message_count: userTurns.length,
        had_image: false,
        transcript: renderTranscript(turns)
      }])
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    // Never let a logging failure surface to the customer.
    console.error("Voice call logging failed (non-fatal):", err.message);
    return res.status(200).json({ ok: false });
  }
};
