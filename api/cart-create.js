// api/cart-create.js
//
// Called directly by the browser (both text and voice mode paths lead back
// to this at some point) to create a fresh Storefront API cart when none
// exists yet. See api/_cart.js for why this replaced the classic AJAX cart.

const { createCart } = require('./_cart.js');

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
    const { cartId, checkoutUrl } = await createCart();
    return res.status(200).json({ cartId, checkoutUrl });
  } catch (err) {
    console.error("cart-create failed:", err.message);
    return res.status(500).json({ error: "Could not create cart" });
  }
};
