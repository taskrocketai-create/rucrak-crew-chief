// api/_notify.js
//
// Shared helper for the escalation pipeline — sends a notification email via
// Resend and logs the escalation to Supabase. Used by both api/chat.js (text
// mode, detects escalation via a marker in the model's response) and
// api/log-escalation.js (voice mode, called directly by Vapi as a tool).
//
// Required environment variables for this to actually do anything:
//   RESEND_API_KEY        -> from your Resend account
//   JASON_NOTIFY_EMAIL    -> the real inbox that should receive these
//
// Optional:
//   CREWCHIEF_FROM_EMAIL  -> defaults to crewchief@rucrak.com. The domain
//                            (rucrak.com) must be verified in Resend for
//                            sending to work — see README for setup.
//   SUPABASE_URL / SUPABASE_SERVICE_KEY -> same as the existing call
//                            logging feature; if unset, Supabase logging is
//                            silently skipped (email can still work without it).
//
// Both the email send and the Supabase log are best-effort and non-fatal —
// a failure here should never break the actual customer-facing response.

async function sendEscalationEmail({ channel, question, customerName, customerContact }) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.JASON_NOTIFY_EMAIL;
  const fromEmail = process.env.CREWCHIEF_FROM_EMAIL || "crewchief@rucrak.com";

  if (!apiKey || !toEmail) {
    console.log("Escalation email skipped — RESEND_API_KEY or JASON_NOTIFY_EMAIL not set.");
    return;
  }

  const subject = `Crew Chief needs your help — ${channel} conversation`;
  const bodyLines = [
    `Channel: ${channel}`,
    "",
    `Question / situation Crew Chief couldn't resolve:`,
    question || "(not provided)",
    "",
    `Customer name: ${customerName || "not given"}`,
    `Customer contact: ${customerContact || "not given"}`
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `Crew Chief <${fromEmail}>`,
        to: [toEmail],
        subject,
        text: bodyLines.join("\n")
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend send failed:", res.status, errText);
    }
  } catch (err) {
    console.error("Escalation email failed (non-fatal):", err.message);
  }
}

async function logEscalation({ channel, question, customerName, customerContact }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return; // logging not configured — skip quietly

  try {
    await fetch(`${supabaseUrl}/rest/v1/rucrak_chief_escalations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        channel,
        question: (question || "").slice(0, 2000),
        customer_name: customerName || null,
        customer_contact: customerContact || null,
        resolved: false
      }])
    });
  } catch (err) {
    console.error("Escalation Supabase logging failed (non-fatal):", err.message);
  }
}

// Fires both, doesn't let either failure block the other, never throws.
async function handleEscalation(details) {
  await Promise.allSettled([
    sendEscalationEmail(details),
    logEscalation(details)
  ]);
}

module.exports = { sendEscalationEmail, logEscalation, handleEscalation };
