// api/cart-checkout-url.js
//
// Called by the "Continue Shopping" button right when it's clicked, to get
// the customer's cart's real, current checkout URL -- see
// api/_cart.js's getCartCheckoutUrl for the full explanation of why this
// exists (the button previously relied on a browser-cookie-sync approach
// that was directly tested and confirmed not to work on this store).

const { getCartCheckoutUrl } = require('./_cart.js');

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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const cartId = req.query.cartId;
    if (!cartId) {
      return res.status(400).json({ error: "cartId is required" });
    }
    const checkoutUrl = await getCartCheckoutUrl(cartId);
    if (!checkoutUrl) {
      return res.status(404).json({ error: "Cart not found" });
    }
    return res.status(200).json({ checkoutUrl });
  } catch (err) {
    console.error("cart-checkout-url failed:", err.message);
    return res.status(500).json({ error: "Could not look up cart", detail: err.message });
  }
};
