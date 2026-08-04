// api/add-to-cart-ack.js
//
// Voice-mode cart-add endpoint (kept at this filename/URL for continuity
// with the existing Vapi dashboard config, even though it now does real
// work, not just an acknowledgment -- renaming would mean updating the
// Server URL in Vapi again for no functional benefit).
//
// History of how this endpoint got here, since it went through a few real
// bugs before landing on the current design:
// 1. add_to_cart started as a pure CLIENT-side tool (no server URL) so the
//    browser could reach the customer's own cart session. But client-side
//    tools can't return a result to the model, and without one, calls got
//    retried indefinitely -- confirmed in real call logs, 28 identical
//    calls in under 40 seconds.
// 2. Added this endpoint as a pure acknowledgment (no real cart work) just
//    to give the model a fast result and stop the retries. That fixed the
//    single-call case, but a second real call log showed it still looping
//    when Daryl called two tools in one turn -- this endpoint only read
//    toolCallList[0], leaving the second call in the batch unanswered.
//    Fixed to loop over the whole batch.
// 3. Even after that, Vapi's own docs confirmed something more fundamental:
//    a tool is EITHER client-side (no server URL) OR server-side (has one)
//    -- never both. Adding a server URL had silently stopped Vapi from
//    delivering the tool call to the browser at all, so the real cart
//    mutation (which only ran in the browser) had stopped happening
//    entirely.
// 4. Also found that Shopify's classic cookie-based cart and the Storefront
//    API cart are documented as not reliably interoperable -- bridging
//    between the two risked two separate, unsynced carts.
//
// Current design: fully server-side, using Shopify's Storefront API
// directly (see api/_cart.js) with a cartId the model passes as a tool
// parameter (populated from {{cartId}}, set via variableValues when the
// call starts -- see index.html). This is now a completely normal
// synchronous tool, same pattern as flag_escalation: real result, real
// cart mutation, no retry loop, no client-side involvement needed at all.
//
// Vapi's tool-call webhook format -- see api/log-escalation.js for the
// full explanation, including handling a batch of more than one tool call
// per request.

const { addLineToCartWithFallback } = require('./_cart.js');

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

    const variantId = args.variantId;
    const quantity = Number(args.quantity) || 1;
    const label = args.label || "that item";
    // If cartId arrives as the literal unresolved template text (e.g. the
    // model echoed "{{cartId}}" because variableValues wasn't actually set
    // for this call), treat it as no cart ID at all rather than trying to
    // use that literal string -- addLineToCartWithFallback creates a fresh
    // cart automatically in that case.
    const rawCartId = args.cartId;
    const cartId = (rawCartId && !rawCartId.includes("{{")) ? rawCartId : null;

    if (!variantId) {
      return { toolCallId, result: safeSingleLine(`No variantId was provided for "${label}", so nothing was added. Tell the customer honestly and offer to help them add it on the site directly.`) };
    }

    const result = await addLineToCartWithFallback(cartId, variantId, quantity);
    const newCartNote = result.createdNewCart ? " (started a fresh cart since the previous one wasn't found)" : "";
    return {
      toolCallId,
      result: safeSingleLine(`Successfully added "${label}" to the cart${newCartNote}. Checkout link: ${result.checkoutUrl}. Confirm this naturally to the customer now -- you don't need to wait for anything further, this already happened.`)
    };
  } catch (err) {
    console.error("add-to-cart-ack error for one call (non-fatal to the call):", err.message);
    return { toolCallId, result: safeSingleLine("The cart update failed. Be honest with the customer that it didn't go through, don't claim success, and offer to help them add it on the site directly instead.") };
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
    return res.status(200).json({ results: [{ toolCallId: "unknown", result: "Noted." }] });
  }

  const results = await Promise.all(toolCalls.map(handleOneCall));
  return res.status(200).json({ results });
};


