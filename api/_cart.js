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

// Adds one line item to an existing cart. Returns { checkoutUrl, discountApplied }.
// Throws if the cart doesn't exist (e.g. an expired/invalid ID) -- callers
// should catch this and create a fresh cart as a fallback.
//
// applyDiscount: if true, generates a fresh session-specific discount code
// (see api/_discount.js) and embeds it directly into the returned
// checkoutUrl so it auto-applies -- the raw code itself is never returned
// here, on purpose, so it can't accidentally end up in anything Daryl
// reads aloud or writes out. If discount generation fails for any reason,
// the cart-add itself still succeeds; discountApplied just comes back false
// so the caller can be honest about that specific part not working.
async function addLineToCart(cartId, variantId, quantity, applyDiscount) {
  const mutation = `
    mutation AddToCart($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { id checkoutUrl }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    cartId,
    lines: [{ merchandiseId: `gid://shopify/ProductVariant/${variantId}`, quantity: quantity || 1 }]
  };
  const data = await shopifyStorefrontGraphQL(mutation, variables);
  const errors = data && data.cartLinesAdd && data.cartLinesAdd.userErrors;
  if (errors && errors.length) {
    throw new Error("Add to cart failed: " + JSON.stringify(errors));
  }
  if (!data.cartLinesAdd.cart) {
    throw new Error("Cart not found (likely an invalid/expired cart ID)");
  }

  let checkoutUrl = data.cartLinesAdd.cart.checkoutUrl;
  let discountApplied = false;
  if (applyDiscount) {
    try {
      const code = await generateSessionDiscountCode();
      checkoutUrl = embedDiscountInUrl(checkoutUrl, code);
      discountApplied = true;
    } catch (err) {
      console.error("Discount generation failed during add-to-cart, cart-add itself still succeeded (non-fatal):", err.message);
    }
  }

  return { checkoutUrl, discountApplied };
}

// Adds a line item, automatically creating a fresh cart and retrying once
// if the given cart ID turns out to be invalid/expired -- this is the
// function both cart-add endpoints should actually call, rather than
// addLineToCart directly, so a stale ID never just fails outright.
async function addLineToCartWithFallback(cartId, variantId, quantity, applyDiscount) {
  if (cartId) {
    try {
      const result = await addLineToCart(cartId, variantId, quantity, applyDiscount);
      return { cartId, checkoutUrl: result.checkoutUrl, discountApplied: result.discountApplied, createdNewCart: false };
    } catch (err) {
      console.error("addLineToCart failed with existing cartId, creating a fresh cart instead (non-fatal):", err.message);
    }
  }
  const newCart = await createCart();
  const result = await addLineToCart(newCart.cartId, variantId, quantity, applyDiscount);
  return { cartId: newCart.cartId, checkoutUrl: result.checkoutUrl, discountApplied: result.discountApplied, createdNewCart: true };
}

module.exports = { createCart, addLineToCart, addLineToCartWithFallback };
