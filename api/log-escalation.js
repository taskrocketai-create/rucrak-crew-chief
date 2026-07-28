// api/log-escalation.js
//
// Voice-mode equivalent of the text-mode escalation marker in api/chat.js.
// This is NOT called by our own frontend — it's called directly by Vapi,
// as a Custom Tool the Crew Chief voice assistant invokes when it decides
// to escalate (see the "flag_escalation" tool setup in the Vapi dashboard).
//
// Vapi's tool-call webhook format (confirmed against their docs):
//   Incoming:  req.body.message.toolCallList[0].id
//              req.body.message.toolCallList[0].function.arguments
//   Required response shape (Vapi is strict about this):
//     { "results": [ { "toolCallId": "<id>", "result": "<single-line string>" } ] }
//   Rules Vapi enforces:
//     - ALWAYS return HTTP 200, even on error — any other status is ignored
//       entirely and the assistant never finds out anything went wrong.
//     - result must be a single-line string (no literal line breaks) or
//       Vapi's parser chokes on it.
//
// Required environment variables (shared with chat.js/_notify.js):
//   ANTHROPIC_API_KEY is NOT needed here — this endpoint doesn't call Claude,
//   it just logs/notifies.
//   RESEND_API_KEY, JASON_NOTIFY_EMAIL — see api/_notify.js for what these do.

const { handleEscalation } = require('./_notify.js');

function safeSingleLine(str) {
  return String(str || "").replace(/\r?\n/g, " ").trim();
}

module.exports = async (req, res) => {
  // Vapi doesn't send an Origin header the way a browser does, and this
  // endpoint is never called from the browser directly — no CORS needed.

  if (req.method !== "POST") {
    return res.status(200).json({ results: [] }); // always 200 per Vapi's rules, even for a wrong method
  }

  let toolCallId = "unknown";
  try {
    const toolCall = req.body &&
      req.body.message &&
      Array.isArray(req.body.message.toolCallList) &&
      req.body.message.toolCallList[0];

    if (!toolCall) {
      return res.status(200).json({
        results: [{ toolCallId: "unknown", result: "No tool call found in request — nothing logged." }]
      });
    }

    toolCallId = toolCall.id || "unknown";

    // Vapi's function-call arguments may arrive as an object or as a JSON
    // string depending on version/config — handle both defensively.
    let args = (toolCall.function && toolCall.function.arguments) || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (err) {
        args = {};
      }
    }

    const question = args.question || "(not specified)";
    const customerName = args.customerName || args.customer_name || null;
    const customerContact = args.customerContact || args.customer_contact || null;

    // Fire-and-forget-ish, but we do wait for it here since this whole
    // function call is short-lived anyway and we want the email/log attempt
    // to actually happen before the serverless function exits.
    await handleEscalation({ channel: "voice", question, customerName, customerContact });

    return res.status(200).json({
      results: [{
        toolCallId,
        result: safeSingleLine("Logged for Jason to follow up on.")
      }]
    });
  } catch (err) {
    console.error("log-escalation error (non-fatal to the call):", err.message);
    // Still 200, per Vapi's rules — an error status is silently ignored anyway,
    // so returning it as a "result" string is the only way the assistant
    // could theoretically react to it.
    return res.status(200).json({
      results: [{
        toolCallId,
        result: safeSingleLine("Had trouble logging that, but go ahead and let the customer know you'll follow up.")
      }]
    });
  }
};
