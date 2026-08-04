// api/add-to-cart-ack.js
//
// Real bug found via Vapi's own call logs: add_to_cart was configured as a
// pure client-side tool (no server URL), and Vapi's own docs warn that
// client-side tools can't return a proper result back to the model. What
// wasn't obvious until seeing actual call logs: without that result, the
// underlying system appears to treat the call as never having gone through,
// and re-issues the exact same tool call repeatedly -- confirmed in a real
// call, the same add_to_cart call fired 28 times in under 40 seconds with
// identical parameters.
//
// Fix: add_to_cart now ALSO needs a real Server URL pointing here. This
// endpoint does NOT perform the actual cart mutation -- it can't, it has no
// access to the customer's browser/cart session. All it does is immediately
// acknowledge the tool call with a proper result, which stops the retry
// loop at the API level. The REAL mutation still happens exactly as before,
// in the browser, via the existing vapi.on('message') handler that catches
// the same tool-calls event independently (Vapi delivers tool-call
// notifications to the browser via clientMessages regardless of whether the
// tool also has a server URL).
//
// Vapi's tool-call webhook format -- see api/log-escalation.js for the full
// explanation; same shape here.

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
      return res.status(200).json({ results: [{ toolCallId: "unknown", result: "Noted." }] });
    }

    toolCallId = toolCall.id || "unknown";

    // Deliberately NOT attempting the actual cart mutation here -- this
    // process has no access to the customer's browser session. The browser
    // itself handles the real /cart/add.js call independently, in parallel,
    // via the same tool-calls event. This endpoint exists purely to give
    // the model a fast, proper result so it stops retrying.
    return res.status(200).json({
      results: [{
        toolCallId,
        result: safeSingleLine("Cart update received and being processed on the customer's device -- the real outcome will follow shortly as a separate system message, per your instructions.")
      }]
    });
  } catch (err) {
    console.error("add-to-cart-ack error (non-fatal to the call):", err.message);
    return res.status(200).json({
      results: [{ toolCallId, result: "Noted." }]
    });
  }
};
