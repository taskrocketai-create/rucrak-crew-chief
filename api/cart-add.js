// api/cart-add.js
//
// Called directly by the browser in TEXT mode to add an item to the cart --
// the voice-mode equivalent path is api/add-to-cart-ack.js, which Vapi
// calls as a server-side tool instead. Both ultimately call the same
// addLineToCartWithFallback in api/_cart.js, so text and voice always
// operate on the same underlying Storefront API cart system.

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
    const { cartId, variantId, quantity } = req.body || {};
    if (!variantId) {
      return res.status(400).json({ error: "variantId is required" });
    }

    const result = await addLineToCartWithFallback(cartId, variantId, quantity);
    return res.status(200).json(result);
  } catch (err) {
    console.error("cart-add failed:", err.message);
    return res.status(500).json({ error: "Could not add to cart" });
  }
};
