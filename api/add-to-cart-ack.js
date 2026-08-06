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
// 5. Real customer report: Daryl confidently said an item was added, but
//    clicking through to the actual cart showed it empty. Root cause: when
//    cartId didn't arrive correctly (missing, or a stale/invalid ID), this
//    endpoint was silently creating a BRAND NEW cart as a fallback and
//    reporting success -- which was real, but to a cart the browser has no
//    way of ever learning about, since voice-mode tool calls never reach
//    the browser at all (that's the whole reason this is server-side).
//    Text mode never has this problem, since the browser gets the actual
//    result in the same request/response and immediately knows the truth.
//    Fix: removed the silent-fallback behavior for voice specifically --
//    if the cart can't be reached with the ID actually provided, this now
//    reports an honest failure instead of quietly substituting a different
//    cart nobody can find. Consistent with the "never claim success you
//    don't have" principle already built into the rest of this prompt.
// 6. Real feedback: Daryl was reading the generated discount code out loud
//    character by character, which sounds awkward and unnatural in speech.
//    Fix: folded discount generation directly into this same action via a
//    new applyDiscount parameter -- the code gets embedded straight into
//    the checkout URL (Shopify auto-applies discount codes passed as a URL
//    parameter) and Daryl never sees the raw code text at all, so there's
//    nothing for him to accidentally read aloud. He just says a discount
//    was applied, which is genuinely true. This also removed the separate
//    generate_discount_code tool and @@DISCOUNT_CODE@@ placeholder
//    entirely -- one unified action instead of two coordinated ones.
// 7. Real, confirmed multi-item failure (customer + CEO both hit this
//    independently): when a customer needed a main product AND a
//    necessary accessory/extension added together, the model had to
//    reliably call this tool twice in a row -- once per item -- and that
//    hand-off between calls is exactly where it kept dropping the second
//    item, in both text and voice mode. Fixed by accepting an ITEMS ARRAY
//    instead of a single flat item -- Shopify's own cartLinesAdd mutation
//    already natively supports multiple lines in one call, so this sends
//    everything in ONE real API call instead of requiring the model to
//    chain several separate ones.
// 8. Real feedback (again): even after applyDiscount existed, both the
//    discount and the accessory follow-up kept getting skipped -- because
//    both still depended on the model reliably deciding to do something
//    correctly (setting a flag, remembering a follow-up), the same class
//    of unreliability that caused the earlier multi-item bugs. Fixed by
//    moving discount eligibility out of the model's hands entirely --
//    api/_cart.js now checks the real items being added against the actual
//    qualifying-product list itself, deterministically, no flag needed.
//    The accessory follow-up isn't fully mechanizable in voice mode the
//    way it is in text mode (text mode hardcodes it directly into the
//    guaranteed confirmation message), so this endpoint instead spells out
//    the exact required next action directly in the tool result text
//    whenever a qualifying product was added, rather than just trusting
//    the prompt's general instruction to remember it.
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

const { addLineToCart } = require('./_cart.js');

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

    let items = Array.isArray(args.items) ? args.items : [];
    // Defensive: if the model somehow still sends the old flat shape
    // (variantId/quantity/label at the top level) instead of an items
    // array, treat that as a single-item array rather than failing --
    // costs nothing and avoids a hard break during the prompt transition.
    if (items.length === 0 && args.variantId) {
      items = [{ variantId: args.variantId, quantity: args.quantity, label: args.label }];
    }
    items = items.filter((item) => item && item.variantId);

    // If cartId arrives as the literal unresolved template text (e.g. the
    // model echoed "{{cartId}}" because variableValues wasn't actually set
    // for this call), treat it as no cart ID at all.
    const rawCartId = args.cartId;
    const cartId = (rawCartId && !rawCartId.includes("{{")) ? rawCartId : null;

    if (items.length === 0) {
      return { toolCallId, result: safeSingleLine(`No valid items were provided, so nothing was added. Tell the customer honestly and offer to help them add it on the site directly.`) };
    }

    const labelList = items.map((item) => item.label || "an item").join(", ");

    if (!cartId) {
      console.error("add_to_cart called without a usable cartId -- refusing to silently create an orphaned cart the customer could never find.");
      return { toolCallId, result: safeSingleLine(`Couldn't reach the customer's cart (no valid cart ID came through) -- do NOT claim "${labelList}" was added, be honest that something went wrong on this end, and offer to help them add it themselves on the site, or suggest switching to typing so it can be added there instead.`) };
    }

    const normalizedItems = items.map((item) => ({ variantId: item.variantId, quantity: Number(item.quantity) || 1 }));
    // Discount eligibility is determined automatically from the real items
    // being added (see api/_cart.js) -- not from a flag the model has to
    // remember to set. Real feedback: even after adding that flag, both
    // the discount and the accessory follow-up kept getting skipped, since
    // it still depended on the model reliably deciding to do something.
    const { checkoutUrl, discountApplied, includesQualifyingProduct } = await addLineToCart(cartId, normalizedItems);
    const discountNote = includesQualifyingProduct
      ? (discountApplied
          ? " A $50 discount has also been applied automatically -- it's already baked into the checkout link, so don't read out or mention any code, just tell them the discount is applied."
          : " The discount specifically didn't apply this time (the item(s) themselves were still added fine) -- be honest that the discount part didn't go through if they ask, don't claim it's there.")
      : "";
    // Spelling out the accessory follow-up directly in the result text,
    // not just relying on the prompt's general instruction to remember it
    // -- real feedback showed that general instruction alone wasn't
    // reliably followed even after several rounds of strengthening it.
    const accessoryNote = includesQualifyingProduct
      ? " This includes a main product (GRUNT/GUNNY), so your very next sentence after confirming this must ask what they'll mainly be using it for (cargo, bikes, gear) to recommend one accessory -- do this now, in this same turn, don't skip it."
      : "";
    return {
      toolCallId,
      result: safeSingleLine(`Successfully added "${labelList}" to the cart.${discountNote} Checkout link: ${checkoutUrl}.${accessoryNote} Confirm this naturally to the customer now -- you don't need to wait for anything further, this already happened.`)
    };
  } catch (err) {
    console.error("add-to-cart-ack error for one call (non-fatal to the call):", err.message);
    return { toolCallId, result: safeSingleLine(`The cart update failed (${err.message}). Be honest with the customer that it didn't go through, don't claim success, and offer to help them add it on the site directly instead.`) };
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


