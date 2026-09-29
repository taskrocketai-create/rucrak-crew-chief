// api/weekly-report.js
//
// Triggered on a schedule by Vercel Cron (see the "crons" entry in
// vercel.json — Vercel makes a GET request to this path, no user or Vapi
// involvement at all). Pulls the last 7 days from all three Supabase
// tables, has Claude write a plain-English summary + a few concrete
// suggestions, and emails the whole thing to Jason via Resend.
//
// Required environment variables (all shared with the rest of the app):
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   RESEND_API_KEY, JASON_NOTIFY_EMAIL
//   CREWCHIEF_FROM_EMAIL (optional, same default as elsewhere)
//
// If any of these are missing, this quietly does nothing rather than
// erroring loudly — a missing weekly report is a lot less disruptive than
// a broken customer-facing feature, so this follows the same "no-op if
// unconfigured" philosophy as the rest of the notification pipeline.
//
// Security: Vercel automatically sends an Authorization: Bearer <CRON_SECRET>
// header on cron-triggered requests, using the CRON_SECRET env var it sets
// for you. This checks for it (if set) so the report can't be triggered by
// randomly hitting the URL — not a huge risk here since nothing destructive
// happens, but it does burn Anthropic/Resend quota, so worth guarding.

async function fetchSupabaseRows(table, sinceIso) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return [];

  const url = `${supabaseUrl}/rest/v1/${table}?created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=1000`;
  const res = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });
  if (!res.ok) {
    console.error(`Failed to fetch ${table}:`, res.status, await res.text());
    return [];
  }
  return res.json();
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const val = row[field];
    if (!val) continue;
    counts[val] = (counts[val] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function formatTopList(pairs, limit = 5) {
  if (pairs.length === 0) return "(none captured this week)";
  return pairs.slice(0, limit).map(([val, count]) => `${val} — ${count}`).join("\n");
}

async function generateReportText({ calls, escalations, unresolvedEscalations, marketingNotes }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const topVehicles = formatTopList(countBy(marketingNotes, "vehicle"));
  const topRegions = formatTopList(countBy(marketingNotes, "region"));
  const topReferrals = formatTopList(countBy(marketingNotes, "referral_source"));
  const topUseCases = formatTopList(countBy(marketingNotes, "use_case"));

  const dataSection = `
Conversations handled this week: ${calls.length}
Photos analyzed: ${calls.filter((c) => c.had_image).length}
Escalations (Crew Chief couldn't resolve): ${escalations.length}
Still unresolved from this week: ${unresolvedEscalations.length}

Top vehicles mentioned:
${topVehicles}

Top regions:
${topRegions}

Top referral sources:
${topReferrals}

Top use cases:
${topUseCases}
`.trim();

  const reportPrompt = `You are writing a short weekly business report for Jason, the founder of rucRak (a Jeep/Bronco cargo rack company). This is an internal report, not customer-facing — plain, professional, direct. No sarcasm, no character voice, just a clear business summary.

Here is this week's raw data from Crew Chief (the AI support assistant):

${dataSection}

Write a short report with two parts:
1. A brief summary of the week (2-4 sentences) — what happened, any notable patterns.
2. 2-4 concrete, specific suggestions based on the actual data above — e.g. if one region or referral source stands out, say so and suggest a specific action. If the data is too sparse this week to say anything meaningful, say that plainly instead of inventing a pattern that isn't really there — don't force insights out of small numbers.

Keep the whole thing tight — a business owner skimming this on their phone should get the gist in under a minute. No markdown formatting, plain text only, this goes straight into an email body.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: reportPrompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic error generating report:", data);
      return null;
    }
    const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
    return textBlocks.join("\n").trim() || null;
  } catch (err) {
    console.error("Failed to generate report text:", err.message);
    return null;
  }
}

// Builds one plain-text file holding every logged exchange's full
// transcript for the week, in order, each one clearly separated and
// timestamped. This is what gets attached to the weekly email — Jason
// gets the summary in the email body and the full conversations as a
// download, rather than one giant wall of text inline.
function buildTranscriptFile(calls) {
  const withTranscript = calls.filter((c) => c.transcript && c.transcript.trim());
  if (withTranscript.length === 0) {
    return "No conversation transcripts were logged this week.\n";
  }
  return withTranscript
    .slice()
    .reverse() // oldest first, reads top-to-bottom like a log
    .map((c, i) => {
      const when = c.created_at ? new Date(c.created_at).toLocaleString("en-US") : "(no timestamp)";
      return `--- Conversation ${i + 1} — ${when} ---\n${c.transcript}\n`;
    })
    .join("\n");
}

async function sendReportEmail(reportText, unresolvedEscalations, calls) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.JASON_NOTIFY_EMAIL;
  const fromEmail = process.env.CREWCHIEF_FROM_EMAIL || "crewchief@send.rucrak.com";
  if (!apiKey || !toEmail) {
    console.log("Weekly report email skipped — RESEND_API_KEY or JASON_NOTIFY_EMAIL not set.");
    return false;
  }

  const unresolvedSection = unresolvedEscalations.length
    ? "\n\nStill unresolved from this week:\n" + unresolvedEscalations
        .map((e) => `- ${e.question}${e.customer_contact ? ` (contact: ${e.customer_contact})` : ""}`)
        .join("\n")
    : "";

  const transcriptNote = "\n\nFull transcripts for every conversation this week are attached as a text file.";
  const body = (reportText || "(Report generation failed this week — check Vercel logs for api/weekly-report.js.)") + unresolvedSection + transcriptNote;

  const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const transcriptFile = buildTranscriptFile(calls);

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
        subject: `Crew Chief weekly report — ${dateLabel}`,
        text: body,
        attachments: [{
          filename: `crewchief-transcripts-${dateLabel.replace(/\s+/g, "-")}.txt`,
          content: Buffer.from(transcriptFile, "utf-8").toString("base64")
        }]
      })
    });
    if (!res.ok) {
      console.error("Weekly report send failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Weekly report email failed:", err.message);
    return false;
  }
}

// Retention: once Jason has the transcripts in his inbox, we don't need to
// keep holding the full text in Supabase — clear the transcript column for
// every row that went into this week's report (leaves first_message/
// last_message/message_count/had_image alone, same as before this feature).
async function clearReportedTranscripts(calls) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  const ids = calls.filter((c) => c.transcript && c.transcript.trim()).map((c) => c.id);
  if (ids.length === 0) return;

  try {
    const idList = ids.map((id) => `"${id}"`).join(",");
    const res = await fetch(`${supabaseUrl}/rest/v1/rucrak_chief_calls?id=in.(${idList})`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ transcript: null })
    });
    if (!res.ok) {
      console.error("Failed to clear reported transcripts:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Failed to clear reported transcripts:", err.message);
  }
}

module.exports = async (req, res) => {
  // Guard against random triggering — only meaningful if CRON_SECRET is set,
  // which Vercel does automatically for cron-triggered requests.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [calls, escalations, marketingNotes] = await Promise.all([
      fetchSupabaseRows("rucrak_chief_calls", sinceIso),
      fetchSupabaseRows("rucrak_chief_escalations", sinceIso),
      fetchSupabaseRows("rucrak_marketing_notes", sinceIso)
    ]);

    const unresolvedEscalations = escalations.filter((e) => !e.resolved);

    const reportText = await generateReportText({ calls, escalations, unresolvedEscalations, marketingNotes });
    const sent = await sendReportEmail(reportText, unresolvedEscalations, calls);

    // Only wipe transcripts once the email actually went out — if the send
    // failed, keep them so next run (or a manual retry) can still report them.
    if (sent) {
      await clearReportedTranscripts(calls);
    }

    return res.status(200).json({ ok: true, calls: calls.length, escalations: escalations.length, transcriptsCleared: sent });
  } catch (err) {
    console.error("Weekly report generation failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
