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
// Fix (round 1): add_to_cart now ALSO needs a real Server URL pointing
// here. This endpoint does NOT perform the actual cart mutation -- it
// can't, it has no access to the customer's browser/cart session. All it
// does is immediately acknowledge the tool call with a proper result, which
// stops the retry loop at the API level. The REAL mutation still happens
// exactly as before, in the browser, via the existing vapi.on('message')
// handler that catches the same tool-calls event independently (Vapi
// delivers tool-call notifications to the browser via clientMessages
// regardless of whether the tool also has a server URL).
//
// Fix (round 2 -- found via a second real call log): retries were still
// happening, just less frequently. Root cause: when Daryl calls add_to_cart
// for TWO items in the same turn (e.g. GRUNT + an accessory together), Vapi
// batches BOTH tool calls into a single webhook request with two entries in
// toolCallList -- but this endpoint was only reading toolCallList[0] and
// only ever returning ONE result. The second tool call in the batch got no
// response at all, Vapi's own "No result returned" fallback kicked in for
// it, and that unanswered half of the pair kept the retry cycle alive.
// Fixed by looping over every entry in toolCallList and returning a result
// for each one, not just the first.
//
// Vapi's tool-call webhook format -- see api/log-escalation.js for the full
// explanation; same shape here, except this endpoint may receive (and must
// respond to) more than one tool call per request.

function safeSingleLine(str) {
  return String(str || "").replace(/\r?\n/g, " ").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(200).json({ results: [] });
  }

  try {
    const toolCalls = (req.body &&
      req.body.message &&
      Array.isArray(req.body.message.toolCallList) &&
      req.body.message.toolCallList) || [];

    if (toolCalls.length === 0) {
      return res.status(200).json({ results: [{ toolCallId: "unknown", result: "Noted." }] });
    }

    // Deliberately NOT attempting the actual cart mutation here -- this
    // process has no access to the customer's browser session. The browser
    // itself handles the real /cart/add.js call independently, in parallel,
    // via the same tool-calls event. This endpoint exists purely to give
    // the model a fast, proper result for EVERY call in the batch so
    // nothing gets left unanswered and retried.
    const results = toolCalls.map((toolCall) => ({
      toolCallId: (toolCall && toolCall.id) || "unknown",
      result: safeSingleLine("Cart update received and being processed on the customer's device -- the real outcome will follow shortly as a separate system message, per your instructions.")
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error("add-to-cart-ack error (non-fatal to the call):", err.message);
    // Best-effort: still try to acknowledge whatever tool call IDs we can
    // find, even after an error, rather than leaving all of them unanswered.
    let fallbackResults = [{ toolCallId: "unknown", result: "Noted." }];
    try {
      const toolCalls = req.body && req.body.message && req.body.message.toolCallList;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        fallbackResults = toolCalls.map((tc) => ({ toolCallId: (tc && tc.id) || "unknown", result: "Noted." }));
      }
    } catch (e2) { /* keep the single fallback above */ }
    return res.status(200).json({ results: fallbackResults });
  }
};

