// api/cart-add.js
//
// Called directly by the browser in TEXT mode to add item(s) to the cart --
// the voice-mode equivalent path is api/add-to-cart-ack.js, which Vapi
// calls as a server-side tool instead. Both ultimately call the same
// addLineToCartWithFallback in api/_cart.js, so text and voice always
// operate on the same underlying Storefront API cart system.
//
// Accepts MULTIPLE items in one request (items: [{variantId, quantity}]) --
// see api/_cart.js for why this matters: sending everything in one real
// API call removes the need for the model to reliably chain multiple
// separate add actions itself, which is exactly where real add/upsell
// failures were happening (a main product would get added, but a
// necessary accessory or extension in the same "yes, add it all" moment
// would silently get dropped).
//
// Discount eligibility no longer depends on a flag the model has to
// remember to set -- real feedback showed both the discount and the
// accessory-question follow-up kept getting skipped even after the flag
// was added, since it was still relying on the model reliably deciding to
// do something correctly. addLineToCartWithFallback now checks the actual
// items being added against the real qualifying-product list itself.

const { addLineToCartWithFallback } = require('./_cart.js');

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function resolveAllowedOrigin(requestOrigin) {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOWED_ORIGINS[0] || "*";
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", resolveAllowedOrigin(req.headers.origin));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { cartId, items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required and must have at least one item" });
    }
    for (const item of items) {
      if (!item || !item.variantId) {
        return res.status(400).json({ error: "every item requires a variantId" });
      }
    }

    const result = await addLineToCartWithFallback(cartId, items);
    return res.status(200).json(result);
  } catch (err) {
    console.error("cart-add failed:", err.message);
    // Returning the real error message here (not just a generic string) so
    // it's visible directly in the browser console -- this is what's been
    // slowing down every round of debugging so far, having to go find
    // server-side logs separately instead of just seeing the real reason
    // right where the failed request shows up.
    return res.status(500).json({ error: "Could not add to cart", detail: err.message });
  }
};
