// api/_cart.js
//
// Unified cart operations for BOTH text mode and voice mode, using
// Shopify's Storefront API exclusively -- NOT the classic AJAX cart
// (/cart/add.js) that text mode originally used. Real, documented reason
// for this rebuild: Shopify's own community confirms the classic
// cookie-based cart and Storefront API carts are not reliably
// interoperable -- a cart created on one system often can't be seen or
// modified by the other. Using ONE system consistently for both modes
// avoids ending up with two separate, unsynced carts depending on which
// mode the customer used.
//
// Required environment variables (set in Vercel):
//   SHOPIFY_STOREFRONT_API_TOKEN  -> Storefront API access token (different
//                                    from the Admin API token used for
//                                    discount generation -- this one is
//                                    scoped for public/storefront use)
//   SHOPIFY_STORE_DOMAIN          -> same myshopify.com domain already used
//                                    for the Admin API (see api/_discount.js)

const SHOPIFY_API_VERSION = "2025-10";

const { generateSessionDiscountCode } = require('./_discount.js');

// Shopify supports auto-applying a discount code by appending it as a URL
// parameter -- the customer never has to type or even see the raw code,
// it's just already applied when they land on checkout. This is what lets
// Daryl say "I've applied a $50 discount" without ever needing to read out
// or write down an awkward code string like "DARYL-7F3KQ".
function embedDiscountInUrl(checkoutUrl, discountCode) {
  if (!checkoutUrl || !discountCode) return checkoutUrl;
  const separator = checkoutUrl.includes('?') ? '&' : '?';
  return `${checkoutUrl}${separator}discount=${encodeURIComponent(discountCode)}`;
}

// The exact GRUNT/GUNNY variant IDs that qualify for the discount -- kept
// here (not just in the prompt) so eligibility is a real, deterministic
// fact the code checks itself, instead of something the model has to
// remember to flag correctly every time. Real feedback: even after
// building the applyDiscount parameter, both the discount AND the
// accessory-question follow-up kept getting skipped -- both were still
// depending on the model reliably remembering to do something on its own,
// the same class of problem that caused the original multi-item cart bugs.
// Moving the "is this actually a qualifying purchase" decision out of the
// model's hands and into code removes that dependency entirely for the
// part that can be made deterministic. Keep in sync manually if new
// GRUNT/GUNNY variants get added -- same maintenance note as elsewhere in
// this codebase.
const QUALIFYING_PRODUCT_VARIANT_IDS = new Set([
  "45949390520514", // GRUNT -- Jeep Wrangler JK
  "45949391831234", // GRUNT -- Jeep Wrangler JL
  "45949397270722", // GRUNT -- Ford Bronco
  "45949398122690", // GRUNT -- Ford Bronco Raptor
  "47653240340674", // GUNNY -- Driver / Straight
  "47653240373442", // GUNNY -- Driver / 4" Riser
  "47653240406210", // GUNNY -- Passenger / Straight
  "47653240438978"  // GUNNY -- Passenger / 4" Riser
]);

function includesQualifyingProduct(items) {
  return items.some((item) => QUALIFYING_PRODUCT_VARIANT_IDS.has(String(item.variantId)));
}

async function shopifyStorefrontGraphQL(query, variables) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_API_TOKEN;
  if (!domain || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_API_TOKEN not configured");
  }
  const res = await fetch(`https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error("Shopify Storefront GraphQL error: " + JSON.stringify(json.errors));
  }
  return json.data;
}

// Creates a brand new, empty cart. Returns { cartId, checkoutUrl }.
async function createCart() {
  const mutation = `
    mutation CreateCart {
      cartCreate {
        cart { id checkoutUrl }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyStorefrontGraphQL(mutation, {});
  const errors = data && data.cartCreate && data.cartCreate.userErrors;
  if (errors && errors.length) {
    throw new Error("Cart creation failed: " + JSON.stringify(errors));
  }
  const cart = data.cartCreate.cart;
  return { cartId: cart.id, checkoutUrl: cart.checkoutUrl };
}

// Adds one or more line items to an existing cart in a SINGLE real API
// call. Returns { checkoutUrl, discountApplied, includesQualifyingProduct }.
// Throws if the cart doesn't exist (e.g. an expired/invalid ID) -- callers
// should catch this and create a fresh cart as a fallback.
//
// items: array of { variantId, quantity }. Shopify's cartLinesAdd mutation
// natively accepts multiple lines in one call -- this was previously
// wrapped to only ever send one, which is exactly what caused real,
// confirmed failures: when a customer needed a main product AND a
// necessary accessory (e.g. GRUNT + stud extensions) added together, the
// model had to reliably chain two SEPARATE add actions itself, and that
// hand-off between them is where it kept dropping the second item, in
// both text and voice mode. Sending everything in one real call removes
// the need for that fragile hand-off entirely.
//
// Discount eligibility is now determined automatically from the actual
// items being added (see includesQualifyingProduct above), not from a
// flag the model has to remember to set correctly -- if any qualifying
// GRUNT/GUNNY variant is in this batch, the discount is generated and
// applied, full stop, regardless of what (if anything) the caller passes.
async function addLineToCart(cartId, items) {
  const mutation = `
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { id checkoutUrl }
        userErrors { field message }
      }
    }
  `;
  const lines = items.map((item) => ({
    merchandiseId: `gid://shopify/ProductVariant/${item.variantId}`,
    quantity: item.quantity || 1
  }));
  const variables = { cartId, lines };
  const data = await shopifyStorefrontGraphQL(mutation, variables);
  const errors = data && data.cartLinesAdd && data.cartLinesAdd.userErrors;
  if (errors && errors.length) {
    throw new Error("Add to cart failed: " + JSON.stringify(errors));
  }
  if (!data.cartLinesAdd.cart) {
    throw new Error("Cart not found (likely an invalid/expired cart ID)");
  }

  const qualifies = includesQualifyingProduct(items);
  let checkoutUrl = data.cartLinesAdd.cart.checkoutUrl;
  let discountApplied = false;
  if (qualifies) {
    try {
      const code = await generateSessionDiscountCode();
      checkoutUrl = embedDiscountInUrl(checkoutUrl, code);
      discountApplied = true;
    } catch (err) {
      console.error("Discount generation failed during add-to-cart, cart-add itself still succeeded (non-fatal):", err.message);
    }
  }

  return { checkoutUrl, discountApplied, includesQualifyingProduct: qualifies };
}

// Adds one or more line items, automatically creating a fresh cart and
// retrying once if the given cart ID turns out to be invalid/expired --
// this is the function both cart-add endpoints should actually call,
// rather than addLineToCart directly, so a stale ID never just fails
// outright.
async function addLineToCartWithFallback(cartId, items) {
  if (cartId) {
    try {
      const result = await addLineToCart(cartId, items);
      return { cartId, checkoutUrl: result.checkoutUrl, discountApplied: result.discountApplied, includesQualifyingProduct: result.includesQualifyingProduct, createdNewCart: false };
    } catch (err) {
      console.error("addLineToCart failed with existing cartId, creating a fresh cart instead (non-fatal):", err.message);
    }
  }
  const newCart = await createCart();
  const result = await addLineToCart(newCart.cartId, items);
  return { cartId: newCart.cartId, checkoutUrl: result.checkoutUrl, discountApplied: result.discountApplied, includesQualifyingProduct: result.includesQualifyingProduct, createdNewCart: true };
}

module.exports = { createCart, addLineToCart, addLineToCartWithFallback };
