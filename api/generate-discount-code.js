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
// explanation; same shape here.
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

  let toolCallId = "unknown";
  try {
    const toolCall = req.body &&
      req.body.message &&
      Array.isArray(req.body.message.toolCallList) &&
      req.body.message.toolCallList[0];

    if (!toolCall) {
      return res.status(200).json({
        results: [{ toolCallId: "unknown", result: "No tool call found — use the fallback code Daryl instead." }]
      });
    }

    toolCallId = toolCall.id || "unknown";

    let code;
    try {
      code = await generateSessionDiscountCode();
    } catch (err) {
      console.error("Voice session discount generation failed, falling back to static code (non-fatal):", err.message);
      code = "Daryl";
    }

    return res.status(200).json({
      results: [{
        toolCallId,
        result: safeSingleLine(`${code}`)
      }]
    });
  } catch (err) {
    console.error("generate-discount-code error (non-fatal to the call):", err.message);
    return res.status(200).json({
      results: [{
        toolCallId,
        result: safeSingleLine("Daryl") // static fallback code -- still works, just not session-unique
      }]
    });
  }
};
