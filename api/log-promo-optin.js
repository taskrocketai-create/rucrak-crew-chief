// api/log-promo-optin.js
//
// Voice-mode equivalent of the text-mode @@PROMO_OPTIN@@ marker in
// api/chat.js. Called directly by Vapi as a Custom Tool ("log_promo_optin")
// only when the customer gave a clear, explicit yes AND a real contact
// method — the prompt (api/_prompt.js) enforces that distinction, this
// endpoint just logs whatever it's handed. No email needed, this is a
// straight data-collection endpoint like log-marketing-info.
//
// Same request/response format as the other tool endpoints — see
// api/log-escalation.js's header comment for the full Vapi webhook rundown.

const { logPromoOptin } = require('./_notify.js');

function safeSingleLine(str) {
  return String(str || "").replace(/\r?\n/g, " ").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).json({ results: [] });
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

    let args = (toolCall.function && toolCall.function.arguments) || {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch (err) {
        args = {};
      }
    }

    const contactMethod = args.contactMethod || args.contact_method || null;
    const contactType = args.contactType || args.contact_type || null;

    if (!contactMethod) {
      // Nothing to log — the tool shouldn't have been called without a real
      // contact value, but fail gracefully rather than erroring the call.
      return res.status(200).json({
        results: [{ toolCallId, result: safeSingleLine("No contact info provided, nothing logged.") }]
      });
    }

    await logPromoOptin({ channel: "voice", contactMethod, contactType });

    return res.status(200).json({
      results: [{ toolCallId, result: safeSingleLine("Got it, added to the list.") }]
    });
  } catch (err) {
    console.error("log-promo-optin error (non-fatal to the call):", err.message);
    return res.status(200).json({
      results: [{ toolCallId, result: safeSingleLine("Had trouble logging that, no big deal, keep going.") }]
    });
  }
};
