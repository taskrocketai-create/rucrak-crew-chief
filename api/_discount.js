// api/_discount.js
//
// Generates a unique, single-use, time-limited "Daryl" discount code on the
// fly, one per conversation, instead of everyone sharing the same static
// "Daryl" code. Rationale: a code that's specific to that one conversation
// (a) can't leak/get shared around diluting its value, (b) creates genuine
// urgency since it actually expires, and (c) gives precise per-conversation
// attribution if ever needed.
//
// Requires two environment variables (set in Vercel):
//   SHOPIFY_ADMIN_API_TOKEN  -> Admin API access token from a custom app
//                               with write_discounts + read_discounts scopes
//   SHOPIFY_STORE_DOMAIN     -> e.g. "vpaxi8-gz.myshopify.com" (the real
//                               myshopify.com backend domain, NOT the
//                               custom rucrak.com domain -- the Admin API
//                               is only reachable at the myshopify.com one)
//
// Same discount terms as the original static "Daryl" code: $50 off, $699
// minimum (in practice GRUNT/GUNNY only), one-time use per customer -- the
// only thing that's different is the code itself is fresh and expires.

const SHOPIFY_API_VERSION = "2025-10";
const EXPIRATION_HOURS = 48;
const MIN_SUBTOTAL = "699.00";
const DISCOUNT_AMOUNT = "50.00";

// The exact GRUNT/GUNNY product GIDs the static code was scoped to (see the
// original discount, created directly in the Shopify admin). Kept in sync
// manually -- if new vehicle-specific GRUNT/GUNNY variants get added later,
// this list (and the original static code) both need updating.
const QUALIFYING_PRODUCT_GIDS = [
  "gid://shopify/Product/8197705531586", // Jeep Wrangler 1987-2006 GRUNT (Draft -- harmless to include ahead of launch)
  "gid://shopify/Product/8233148416194", // Jeep Wrangler JK GRUNT
  "gid://shopify/Product/8233148645570", // Jeep Wrangler JL GRUNT
  "gid://shopify/Product/8233149595842", // Ford Bronco GRUNT
  "gid://shopify/Product/8233149890754", // Ford Bronco Raptor GRUNT
  "gid://shopify/Product/8233285025986"  // GUNNY
];

function randomSuffix() {
  // Short, spoken-friendly (no ambiguous characters like 0/O or 1/I),
  // uppercase alphanumeric -- easy to say out loud in voice mode and easy
  // to read in text mode.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function shopifyAdminGraphQL(query, variables) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_API_TOKEN;
  if (!domain || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_TOKEN not configured");
  }
  const res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error("Shopify GraphQL error: " + JSON.stringify(json.errors));
  }
  return json.data;
}

// Creates one fresh discount code and returns it as a plain string (e.g.
// "DARYL-7F3KQ"). Throws on failure -- callers decide how to degrade
// gracefully (falling back to the static "Daryl" code is the sane default,
// see the fallback handling at each call site).
async function generateSessionDiscountCode() {
  const code = `DARYL-${randomSuffix()}`;
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + EXPIRATION_HOURS * 60 * 60 * 1000).toISOString();

  const mutation = `
    mutation CreateSessionDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    basicCodeDiscount: {
      title: `Daryl session discount (${code})`,
      code,
      startsAt,
      endsAt,
      appliesOncePerCustomer: true,
      customerSelection: { all: true },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: MIN_SUBTOTAL } },
      customerGets: {
        items: { products: { productsToAdd: QUALIFYING_PRODUCT_GIDS } },
        value: { discountAmount: { amount: DISCOUNT_AMOUNT, appliesOnEachItem: false } }
      }
    }
  };

  const data = await shopifyAdminGraphQL(mutation, variables);
  const errors = data && data.discountCodeBasicCreate && data.discountCodeBasicCreate.userErrors;
  if (errors && errors.length) {
    throw new Error("Discount creation failed: " + JSON.stringify(errors));
  }
  return code;
}

module.exports = { generateSessionDiscountCode, EXPIRATION_HOURS };
