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
// api/log-escalation.js's header comment for the full Vapi webhook rundown,
// including handling a batch of more than one tool call per request (see
// the fix note in api/add-to-cart-ack.js).

const { logPromoOptin } = require('./_notify.js');

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

    const contactMethod = args.contactMethod || args.contact_method || null;
    const contactType = args.contactType || args.contact_type || null;

    if (!contactMethod) {
      return { toolCallId, result: safeSingleLine("No contact info provided, nothing logged.") };
    }

    await logPromoOptin({ channel: "voice", contactMethod, contactType });
    return { toolCallId, result: safeSingleLine("Got it, added to the list.") };
  } catch (err) {
    console.error("log-promo-optin error for one call (non-fatal to the call):", err.message);
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

