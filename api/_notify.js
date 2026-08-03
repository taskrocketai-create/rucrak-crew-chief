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
//   CREWCHIEF_FROM_EMAIL  -> defaults to crewchief@send.rucrak.com (the
//                            actually-verified sending domain). The domain
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
  const fromEmail = process.env.CREWCHIEF_FROM_EMAIL || "crewchief@send.rucrak.com";

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

// --- Marketing context logging -----------------------------------------
// Separate from escalations — this is just aggregate data collection, no
// email notification needed (nobody needs to be paged over "customer is in
// Colorado, drives a Wrangler"). Same Supabase env vars as everything else.
async function logMarketingInfo({ channel, vehicle, region, referralSource, useCase }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return; // logging not configured — skip quietly

  // Skip entirely if nothing useful was actually captured.
  if (!vehicle && !region && !referralSource && !useCase) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/rucrak_marketing_notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        channel,
        vehicle: vehicle || null,
        region: region || null,
        referral_source: referralSource || null,
        use_case: useCase || null
      }])
    });
  } catch (err) {
    console.error("Marketing info Supabase logging failed (non-fatal):", err.message);
  }
}

// --- Promotional list opt-in logging -------------------------------------
// Distinct from logMarketingInfo above — this one requires explicit,
// affirmative consent (checked in the prompt, not here) and stores real
// contact info, since it's for an actual promotional contact list. Separate
// table on purpose, so it's never accidentally mixed with the anonymous
// aggregate marketing-context data.
async function logPromoOptin({ channel, contactMethod, contactType }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return; // logging not configured — skip quietly
  if (!contactMethod) return; // nothing to log without an actual contact value

  try {
    await fetch(`${supabaseUrl}/rest/v1/rucrak_promo_optins`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        channel,
        contact_method: contactMethod,
        contact_type: contactType || null
      }])
    });
  } catch (err) {
    console.error("Promo opt-in Supabase logging failed (non-fatal):", err.message);
  }
}

module.exports = { sendEscalationEmail, logEscalation, handleEscalation, logMarketingInfo, logPromoOptin };
