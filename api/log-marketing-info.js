// api/log-marketing-info.js
//
// Voice-mode equivalent of the text-mode @@CUSTOMER_INFO@@ marker in
// api/chat.js. Called directly by Vapi as a Custom Tool ("log_customer_info")
// whenever Crew Chief picks up marketing-relevant context during a call —
// vehicle type, general region, referral source, use case. No email
// notification here (unlike escalations) — this is pure aggregate data
// collection for Jason to review later, not something urgent.
//
// Same request/response format as api/log-escalation.js — see that file's
// header comment for the full rundown of Vapi's tool-call webhook rules
// (always 200, single-line result strings, etc.), including handling a
// batch of more than one tool call per request (see the fix note in
// api/add-to-cart-ack.js).

const { logMarketingInfo } = require('./_notify.js');

function safeSingleLine(str) {
  return String(str || "").replace(/\r?\n/g, " ").trim();
}

async function handleOneCall(toolCall) {
  const toolCallId = (toolCall && toolCall.id) || "unknown";
  try {
    let args = (toolCall.function && toolCall.function.arguments) || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (err) {
        args = {};
      }
    }

    await logMarketingInfo({
      channel: "voice",
      vehicle: args.vehicle || null,
      region: args.region || null,
      referralSource: args.referralSource || args.referral_source || null,
      useCase: args.useCase || args.use_case || null
    });

    return { toolCallId, result: safeSingleLine("Noted, thanks.") };
  } catch (err) {
    console.error("log-marketing-info error for one call (non-fatal to the call):", err.message);
    return { toolCallId, result: safeSingleLine("Had trouble logging that, no big deal, keep going.") };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).json({ results: [] });
  }

  const toolCalls = (req.body &&
    req.body.message &&
    Array.isArray(req.body.message.toolCallList) &&
    req.body.message.toolCallList) || [];

  if (toolCalls.length === 0) {
    return res.status(200).json({
      results: [{ toolCallId: "unknown", result: "No tool call found in request — nothing logged." }]
    });
  }

  const results = await Promise.all(toolCalls.map(handleOneCall));
  return res.status(200).json({ results });
};

