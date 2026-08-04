// api/generate-discount-code.js
//
// Voice-mode equivalent of the @@DISCOUNT_CODE@@ placeholder in api/chat.js.
// Unlike add_to_cart, this one IS a normal server-side Vapi Custom Tool (a
// real Server URL configured in the dashboard) -- generating a discount code
// only needs Shopify Admin API credentials, which live here on the backend;
// it doesn't need anything from the customer's own browser the way cart-add
// does. Server-side tools can return a real result back to the model (unlike
// client-side tools), so Daryl gets the actual generated code back directly
// and speaks it naturally.
//
// Vapi's tool-call webhook format -- see api/log-escalation.js for the full
// explanation. Also handles a batch of more than one tool call per request
// (see the fix note in api/add-to-cart-ack.js for why this matters -- a
// request with multiple tool calls where only the first gets a result
// leaves the rest to time out and retry).
//
// Required environment variables (see api/_discount.js for details):
//   SHOPIFY_ADMIN_API_TOKEN, SHOPIFY_STORE_DOMAIN

const { generateSessionDiscountCode } = require('./_discount.js');

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
      return res.status(200).json({
        results: [{ toolCallId: "unknown", result: "No tool call found — use the fallback code Daryl instead." }]
      });
    }

    // Generate one fresh code per tool call in the batch (in the unlikely
    // case this ever gets called more than once in the same turn) rather
    // than reusing a single code across multiple results.
    const results = await Promise.all(toolCalls.map(async (toolCall) => {
      const toolCallId = (toolCall && toolCall.id) || "unknown";
      let code;
      try {
        code = await generateSessionDiscountCode();
      } catch (err) {
        console.error("Voice session discount generation failed, falling back to static code (non-fatal):", err.message);
        code = "Daryl";
      }
      return { toolCallId, result: safeSingleLine(`${code}`) };
    }));

    return res.status(200).json({ results });
  } catch (err) {
    console.error("generate-discount-code error (non-fatal to the call):", err.message);
    let fallbackResults = [{ toolCallId: "unknown", result: "Daryl" }];
    try {
      const toolCalls = req.body && req.body.message && req.body.message.toolCallList;
      if (Array.isArray(toolCalls) && toolCalls.length) {
        fallbackResults = toolCalls.map((tc) => ({ toolCallId: (tc && tc.id) || "unknown", result: "Daryl" }));
      }
    } catch (e2) { /* keep the single fallback above */ }
    return res.status(200).json({ results: fallbackResults });
  }
};

