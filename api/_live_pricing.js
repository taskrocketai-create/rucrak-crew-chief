// api/_live_pricing.js
//
// Real request: prices baked into api/_prompt.js as plain text go stale
// between syncs -- the price-drift checker (api/check-price-drift.js)
// catches this and alerts, but still needed a human to ask Claude to fix
// it each time. This module eliminates that step entirely: instead of
// Daryl ever reading a frozen price from prompt text, the actual live
// Shopify price gets substituted in fresh, every time, before the prompt
// is used at all.
//
// Reuses the exact same "variant NNNN ... $X.XX" extraction pattern
// api/check-price-drift.js already uses -- the base prompt text stays
// exactly the same static catalog format (variant IDs, names,
// descriptions, page URLs all still live in api/_prompt.js as before),
// this just finds every price in that text and swaps it for the current
// real one.
//
// Caching: fetching every known variant's price from Shopify on every
// single chat message would be wasteful and slow. Prices are cached in
// Supabase for a few minutes -- long enough that a normal conversation's
// worth of messages reuses one fetch, short enough that a real price
// change shows up almost immediately rather than waiting on a daily
// check. Falls back to fetching live (no cache) if Supabase isn't
// configured, and falls back to the prompt's own baked-in prices if
// Shopify itself is unreachable -- this should never be the reason a
// conversation fails.
//
// Required environment variables:
//   SHOPIFY_STOREFRONT_API_TOKEN, SHOPIFY_STORE_DOMAIN (see api/_cart.js)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (see api/_notify.js) -- optional;
//   caching is skipped gracefully if not configured, at the cost of a
//   live Shopify fetch on every request instead of every few minutes.

const SHOPIFY_API_VERSION = "2025-10";
const SUPABASE_CACHE_TABLE = "rucrak_live_price_cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const PRICE_RE = /variant (\d+)[^\n]*?\$([\d,]+\.\d{2})/g;

function extractVariantIds(promptText) {
  const ids = new Set();
  let match;
  const re = new RegExp(PRICE_RE);
  while ((match = re.exec(promptText)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

function supabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function getCachedPrices() {
  if (!supabaseConfigured()) return null;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_CACHE_TABLE}?select=prices,fetched_at&order=fetched_at.desc&limit=1`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    const rows = await res.json();
    if (!rows.length) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.fetched_at).getTime();
    if (age > CACHE_TTL_MS) return null; // stale, needs a fresh fetch
    return row.prices; // { variantId: price, ... }
  } catch (err) {
    console.error("getCachedPrices failed (non-fatal, will fetch live):", err.message);
    return null;
  }
}

async function setCachedPrices(prices) {
  if (!supabaseConfigured()) return;
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_CACHE_TABLE}`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ prices, fetched_at: new Date().toISOString() })
    });
  } catch (err) {
    console.error("setCachedPrices failed (non-fatal):", err.message);
  }
}

async function fetchLivePricesFromShopify(variantIds) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_API_TOKEN;
  if (!domain || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_API_TOKEN not configured");
  }
  const gids = variantIds.map((id) => `gid://shopify/ProductVariant/${id}`);
  const query = `
    query GetPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant { id price { amount } }
      }
    }
  `;
  const res = await fetch(`https://${domain}/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({ query, variables: { ids: gids } })
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error("Shopify Storefront GraphQL error: " + JSON.stringify(json.errors));
  }
  const prices = {};
  (json.data.nodes || []).forEach((node, i) => {
    if (node && node.price) {
      prices[variantIds[i]] = parseFloat(node.price.amount);
    }
  });
  return prices;
}

// Main entry point: takes the base prompt text (whatever api/_prompt.js
// currently exports) and returns a new version with every price
// substituted for the real current Shopify price. Never throws -- on any
// failure, returns the original text unchanged so a pricing hiccup is
// never the reason a conversation breaks.
async function applyLivePricing(promptText) {
  try {
    const variantIds = extractVariantIds(promptText);
    if (variantIds.length === 0) return promptText;

    let prices = await getCachedPrices();
    if (!prices) {
      prices = await fetchLivePricesFromShopify(variantIds);
      setCachedPrices(prices).catch(() => {}); // fire-and-forget, don't block the response on this
    }

    const re = new RegExp(PRICE_RE);
    return promptText.replace(re, (fullMatch, variantId, oldPriceStr) => {
      const livePrice = prices[variantId];
      if (livePrice === undefined) return fullMatch; // not found live -- leave the baked-in value as a safe fallback rather than guessing
      const formatted = livePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return fullMatch.replace(`$${oldPriceStr}`, `$${formatted}`);
    });
  } catch (err) {
    console.error("applyLivePricing failed, using baked-in prices as fallback (non-fatal):", err.message);
    return promptText;
  }
}

module.exports = { applyLivePricing };
