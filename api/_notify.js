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

  const q = (question || "(not provided)").trim();
  // Subject leads with a trimmed preview of the actual question -- real
  // feedback: the old subject line ("Crew Chief needs your help — text
  // conversation") gave no way to gauge urgency from an inbox list without
  // opening every single one. This lets Jason triage at a glance.
  const questionPreview = q.length > 70 ? q.slice(0, 67) + "..." : q;
  const subject = `Crew Chief: ${questionPreview}`;

  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

  // Contact info as real clickable links when it looks like an email or
  // phone number, so following up is one tap instead of copy-pasting.
  const contact = (customerContact || "").trim();
  let contactHtml = "Not given";
  let contactText = "not given";
  if (contact) {
    const looksLikeEmail = contact.includes("@");
    const digitsOnly = contact.replace(/[^\d+]/g, "");
    const looksLikePhone = digitsOnly.length >= 7;
    if (looksLikeEmail) {
      contactHtml = `<a href="mailto:${contact}">${contact}</a>`;
    } else if (looksLikePhone) {
      contactHtml = `<a href="tel:${digitsOnly}">${contact}</a>`;
    } else {
      contactHtml = contact;
    }
    contactText = contact;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px;">
      <div style="background:#FF6A13;color:#fff;padding:12px 16px;font-weight:bold;font-size:15px;">
        Crew Chief needs your help — ${channel} conversation
      </div>
      <div style="padding:16px;border:1px solid #eee;border-top:none;">
        <div style="font-size:15px;line-height:1.5;margin-bottom:16px;">${q.replace(/</g, "&lt;")}</div>
        <table style="font-size:14px;color:#333;border-collapse:collapse;">
          <tr><td style="padding:4px 12px 4px 0;color:#888;">Customer</td><td>${customerName || "Not given"}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888;">Contact</td><td>${contactHtml}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#888;">When</td><td>${timestamp} ET</td></tr>
        </table>
      </div>
    </div>
  `;

  const text = [
    `[${channel}] ${q}`,
    "",
    `Customer: ${customerName || "not given"}`,
    `Contact: ${contactText}`,
    `When: ${timestamp} ET`
  ].join("\n");

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
        text,
        html
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

// --- Text message to Jason ------------------------------------------------
// Escalations where Daryl couldn't help also text Jason so a customer waiting
// on him doesn't sit in a shared inbox (leads Daryl handled are email-only). Uses Twilio's REST API directly (no SDK). Entirely opt-in:
// does nothing unless ALL of these are set in Vercel:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
//   TWILIO_FROM_NUMBER (E.164, e.g. +19195550100)  -- or TWILIO_MESSAGING_SERVICE_SID
//   JASON_NOTIFY_PHONE  (his mobile; a comma-separated list texts several people)
// Best-effort and non-fatal like the email -- a failed text never affects the
// customer's conversation or the email/log.
const SMS_MAX_PER_HOUR = 5; // flood guard so one bad actor can't buzz Jason all night

function toE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

function buildSmsBody({ channel, question, customerName, customerContact }) {
  const q = String(question || "(no details)").replace(/\s+/g, " ").trim();
  const qShort = q.length > 140 ? q.slice(0, 137) + "..." : q;
  const who = [customerName, customerContact].filter(Boolean).join(" ") || "no contact given";
  return `Crew Chief (${channel}): ${qShort} | ${who} | Details in your email.`;
}

// True if we've already texted the max in the past hour. Counts escalation
// rows (one per escalation). Fails OPEN: if the check can't run, send anyway --
// a missed alert is worse than an extra text.
async function smsFloodGuardTripped() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const r = await fetch(
      `${supabaseUrl}/rest/v1/rucrak_chief_escalations?created_at=gte.${encodeURIComponent(since)}&select=id&limit=${SMS_MAX_PER_HOUR + 1}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > SMS_MAX_PER_HOUR;
  } catch (err) {
    return false;
  }
}

// Text only when Daryl genuinely couldn't help. A sales lead Daryl already
// handled (customer just left contact info / wants a callback) is marked with
// a leading "LEAD" in the escalation's question -- by the model per the prompt,
// and by the code backstop for numbers it catches -- and goes by email only.
function isLeadEscalation(question) {
  return /^\s*LEAD\b/i.test(String(question || ""));
}

async function sendEscalationSms(details) {
  if (isLeadEscalation(details && details.question)) return;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const toList = String(process.env.JASON_NOTIFY_PHONE || "").split(",").map(toE164).filter(Boolean);

  if (!sid || !token || (!from && !service) || toList.length === 0) {
    return; // not configured -- quietly skip, same as the email does
  }
  if (await smsFloodGuardTripped()) {
    console.log("Escalation text skipped -- more than " + SMS_MAX_PER_HOUR + " escalations in the last hour (email still sent).");
    return;
  }

  const body = buildSmsBody(details);
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");

  await Promise.allSettled(toList.map(async (to) => {
    try {
      const params = new URLSearchParams({ To: to, Body: body });
      if (service) params.set("MessagingServiceSid", service);
      else params.set("From", from);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString()
      });
      if (!res.ok) {
        console.error("Twilio SMS failed:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Escalation text failed (non-fatal):", err.message);
    }
  }));
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
    sendEscalationSms(details),
    logEscalation(details)
  ]);
}

// --- Deterministic lead backstop ---------------------------------------
// Escalation used to depend entirely on the model deciding to emit the
// escalation marker / call flag_escalation. Real miss: a customer left a phone
// number mid-chat and nobody was told. This is the safety net -- plain code,
// no model judgment: if a customer hands over a phone number or email that
// hasn't appeared earlier in the conversation, it's a lead and Jason gets
// the email, whether or not the model remembered to escalate.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// US-style 10-digit numbers, optional +1, any common separators. Digit
// lookarounds keep long IDs (variant IDs, order numbers) from matching.
const PHONE_RE = /(?<!\d)(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)/g;

// Voice transcripts often spell numbers out ("four three four, five four seven,
// nine zero two four", "oh" for zero, "double seven"). Turn any run of spoken
// digits that adds up to a phone number (10-11 digits) into real digits so the
// phone matcher can see it. Shorter runs are left alone ("one or two kids").
const DIGIT_WORDS = { zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9" };
const WORD_ALT = Object.keys(DIGIT_WORDS).join("|");
const SPOKEN_TOKEN = `(?:(?:double|triple)\\s+(?:${WORD_ALT})|(?:${WORD_ALT})|\\d+)`;
const SPOKEN_RUN_RE = new RegExp(
  `(?<![A-Za-z0-9])${SPOKEN_TOKEN}(?:[\\s,.\\-]+${SPOKEN_TOKEN})+(?![A-Za-z0-9])`,
  "gi"
);

function normalizeSpokenDigits(text) {
  return String(text || "").replace(SPOKEN_RUN_RE, (run) => {
    const tokens = run.match(new RegExp(SPOKEN_TOKEN, "gi")) || [];
    const digits = tokens
      .map((tok) => {
        const parts = tok.toLowerCase().split(/\s+/);
        if (parts[0] === "double") return DIGIT_WORDS[parts[1]].repeat(2);
        if (parts[0] === "triple") return DIGIT_WORDS[parts[1]].repeat(3);
        return DIGIT_WORDS[parts[0]] !== undefined ? DIGIT_WORDS[parts[0]] : parts[0];
      })
      .join("");
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits[0] === "1") return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
    return run; // not phone-length: leave the customer's words untouched
  });
}

function findContacts(text) {
  const t = normalizeSpokenDigits(text);
  return [...(t.match(EMAIL_RE) || []), ...(t.match(PHONE_RE) || [])].map((s) => s.trim());
}

function contactKey(c) {
  return c.includes("@") ? c.toLowerCase() : c.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

// userTexts: customer messages in order, newest last. Returns an escalation
// payload if the newest message contains a contact not seen earlier, else null.
//
// excludeContacts: contacts to ignore -- e.g. one the customer just gave as a
// promo-list opt-in. Those go in the opt-in table and the weekly report, not
// Jason's inbox one at a time.
function excludeKeys(excludeContacts) {
  return new Set((excludeContacts || []).filter(Boolean).flatMap((c) => {
    const found = findContacts(c);
    return (found.length ? found : [String(c)]).map(contactKey);
  }));
}

function detectNewLead(userTexts, excludeContacts) {
  if (!Array.isArray(userTexts) || userTexts.length === 0) return null;
  const latest = userTexts[userTexts.length - 1];
  const seen = new Set(userTexts.slice(0, -1).flatMap(findContacts).map(contactKey));
  const skip = excludeKeys(excludeContacts);
  const fresh = findContacts(latest).filter((c) => !seen.has(contactKey(c)) && !skip.has(contactKey(c)));
  if (fresh.length === 0) return null;
  return buildLeadEscalation(userTexts.slice(-6), fresh);
}

// Voice: the whole transcript arrives at once at call end, so any contact
// anywhere in the customer's turns counts.
function detectLeadInTranscript(userTexts, excludeContacts) {
  const skip = excludeKeys(excludeContacts);
  const all = [...new Set((userTexts || []).flatMap(findContacts))].filter((c) => !skip.has(contactKey(c)));
  if (all.length === 0) return null;
  return buildLeadEscalation(userTexts.slice(-8), all);
}

function buildLeadEscalation(recentUserTexts, contacts) {
  const context = recentUserTexts.map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
  return {
    question: `LEAD — customer shared contact info. What they said: ${context}`.slice(0, 1500),
    customerName: null,
    customerContact: [...new Set(contacts)].join(", ")
  };
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
async function logPromoOptin({ channel, contactMethod, contactType, customerName }) {
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
        contact_type: contactType || null,
        customer_name: customerName ? String(customerName).trim().slice(0, 200) : null
      }])
    });
  } catch (err) {
    console.error("Promo opt-in Supabase logging failed (non-fatal):", err.message);
  }
}

module.exports = {
  sendEscalationEmail, sendEscalationSms, isLeadEscalation, buildSmsBody, toE164, logEscalation, handleEscalation, logMarketingInfo, logPromoOptin,
  findContacts, normalizeSpokenDigits, contactKey, detectNewLead, detectLeadInTranscript
};
