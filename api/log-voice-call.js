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

const { handleEscalation, detectLeadInTranscript } = require('./_notify.js');

function extractPlainText(text) {
  return String(text || "").trim();
}

// Did Daryl already escalate (via the flag_escalation tool) in the last 20
// minutes? If so, the backstop stays quiet. If the check itself fails or
// Supabase isn't configured, answer false -- a duplicate email is better
// than a missed lead.
async function voiceEscalationAlreadyLogged() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const r = await fetch(
      `${supabaseUrl}/rest/v1/rucrak_chief_escalations?channel=eq.voice&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    return false;
  }
}

// Contacts Daryl logged as promo-list opt-ins during this call (last 20 min).
// Those are saved in rucrak_promo_optins and listed in the weekly report, so
// they must not also email Jason as leads.
async function recentVoicePromoContacts() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return [];
  try {
    const since = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const r = await fetch(
      `${supabaseUrl}/rest/v1/rucrak_promo_optins?channel=eq.voice&created_at=gte.${encodeURIComponent(since)}&select=contact_method&limit=20`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return [];
    const rows = await r.json();
    return Array.isArray(rows) ? rows.map((x) => x.contact_method).filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

// Backstop: a phone number or email spoken during the call is a lead, whether
// or not Daryl remembered to call flag_escalation.
async function backstopVoiceLead(userTurns) {
  try {
    const promoContacts = await recentVoicePromoContacts();
    const lead = detectLeadInTranscript(userTurns.map((t) => extractPlainText(t.text)), promoContacts);
    if (!lead) return;
    if (await voiceEscalationAlreadyLogged()) return;
    await handleEscalation({ channel: "voice", ...lead });
  } catch (err) {
    console.error("Voice lead backstop failed (non-fatal):", err.message);
  }
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

    await backstopVoiceLead(userTurns);

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
