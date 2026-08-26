// api/check-price-drift.js
//
// Real gap identified during a live review with Jason: he assumed pricing
// was fully real-time, but prices are actually baked into api/_prompt.js as
// plain text and only get updated when someone manually re-syncs against
// Shopify (as happened earlier in this project). His own follow-up: true
// real-time isn't required, a reasonable SCHEDULE is fine.
//
// This is deliberately an ALERT, not an auto-fix -- having a scheduled job
// silently rewrite the live prompt text on its own would be a real risk
// (no human review of what changed, no chance to catch a bad price before
// customers see it). Instead, this runs on a schedule (see vercel.json),
// compares the prices actually baked into _prompt.js against Shopify's real
// current prices for the same variants, and emails a summary ONLY when
// something's actually drifted -- silent otherwise, so it's not noise. A
// human (Alan, via a normal conversation) then does the actual re-sync,
// same reliable process already used earlier in this project.
//
// How the comparison works: rather than maintaining a second, separate
// list of "what price should this variant be" that could itself drift out
// of sync with the prompt, this reads _prompt.js's actual text directly and
// regex-extracts every "variant NNNN ... $X.XX" pair already written there
// -- the SAME source of truth the prompt itself uses, no dual-maintenance
// risk.
//
// Required environment variables (all already set for other features):
//   SHOPIFY_STOREFRONT_API_TOKEN, SHOPIFY_STORE_DOMAIN (see api/_cart.js)
//   RESEND_API_KEY, JASON_NOTIFY_EMAIL, CREWCHIEF_FROM_EMAIL (see api/_notify.js)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY (see api/_notify.js) -- used to track
//   "missing" variants across runs so a single-run blip doesn't alert (see
//   getPendingMisses/recordPendingMiss/clearPendingMiss below). Table:
//   rucrak_price_drift_pending_misses, see supabase_setup.sql. If these
//   aren't configured, missing-variant tracking is skipped gracefully and
//   every miss alerts immediately (same as before this improvement) --
//   price MISMATCHES always alert immediately regardless, since a real
//   price change is actionable right away and doesn't have the same
//   false-positive risk a "not found yet" blip does.

const fs = require('fs');
const path = require('path');

const SHOPIFY_API_VERSION = "2025-10";
const SUPABASE_TABLE = "rucrak_price_drift_pending_misses";

function supabaseConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function getPendingMisses() {
  if (!supabaseConfigured()) return new Set();
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?select=variant_id`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
    if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
    const rows = await res.json();
    return new Set(rows.map((r) => r.variant_id));
  } catch (err) {
    console.error("getPendingMisses failed (non-fatal, treating as no prior misses):", err.message);
    return new Set();
  }
}

async function recordPendingMiss(variantId) {
  if (!supabaseConfigured()) return;
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates" // already-pending variant, no-op rather than error
      },
      body: JSON.stringify({ variant_id: variantId })
    });
  } catch (err) {
    console.error("recordPendingMiss failed (non-fatal):", err.message);
  }
}

async function clearPendingMiss(variantId) {
  if (!supabaseConfigured()) return;
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?variant_id=eq.${encodeURIComponent(variantId)}`, {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      }
    });
  } catch (err) {
    console.error("clearPendingMiss failed (non-fatal):", err.message);
  }
}

function extractPricesFromPrompt() {
  const promptPath = path.join(__dirname, '_prompt.js');
  const text = fs.readFileSync(promptPath, 'utf8');
  // Matches lines like: "variant 45949390520514 — $699.95" or "$1,299.95"
  const re = /variant (\d+)[^\n]*?\$([\d,]+\.\d{2})/g;
  const found = new Map(); // variantId -> price (number), first occurrence wins
  let match;
  while ((match = re.exec(text)) !== null) {
    const variantId = match[1];
    const price = parseFloat(match[2].replace(/,/g, ''));
    if (!found.has(variantId)) {
      found.set(variantId, price);
    }
  }
  return found;
}

async function fetchLivePrices(variantIds) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_STOREFRONT_API_TOKEN;
  if (!domain || !token) {
    throw new Error("SHOPIFY_STORE_DOMAIN or SHOPIFY_STOREFRONT_API_TOKEN not configured");
  }

  const gids = variantIds.map((id) => `gid://shopify/ProductVariant/${id}`);
  const query = `
    query GetPrices($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          price { amount }
          product { title }
        }
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

  const live = new Map(); // variantId -> { price, title } | null (null = not found/deleted)
  (json.data.nodes || []).forEach((node, i) => {
    const variantId = variantIds[i];
    if (node && node.price) {
      live.set(variantId, { price: parseFloat(node.price.amount), title: node.product && node.product.title });
    } else {
      live.set(variantId, null);
    }
  });
  return live;
}

async function sendDriftEmail(discrepancies, missingVariants) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.JASON_NOTIFY_EMAIL;
  const fromEmail = process.env.CREWCHIEF_FROM_EMAIL || "crewchief@send.rucrak.com";

  if (!apiKey || !toEmail) {
    console.log("Price-drift email skipped — RESEND_API_KEY or JASON_NOTIFY_EMAIL not set.");
    return;
  }

  const lines = [
    "Daryl's prompt has stale prices compared to the live Shopify catalog.",
    "This is just a heads-up -- nothing has been changed automatically. Ask Claude to re-sync the catalog when you get a chance.",
    ""
  ];

  if (discrepancies.length > 0) {
    lines.push(`PRICE MISMATCHES (${discrepancies.length}):`);
    discrepancies.forEach((d) => {
      lines.push(`  - Variant ${d.variantId} (${d.title || 'unknown product'}): prompt says $${d.promptPrice.toFixed(2)}, Shopify says $${d.livePrice.toFixed(2)}`);
    });
    lines.push("");
  }

  if (missingVariants.length > 0) {
    lines.push(`VARIANTS NO LONGER FOUND ON SHOPIFY (${missingVariants.length}) -- may have been deleted/discontinued:`);
    missingVariants.forEach((v) => lines.push(`  - Variant ${v}`));
    lines.push("");
  }

  const subject = `Crew Chief: ${discrepancies.length + missingVariants.length} catalog item(s) need re-syncing`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `Crew Chief <${fromEmail}>`,
        to: [toEmail],
        subject,
        text: lines.join("\n")
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error("Resend send failed:", res.status, errText);
    }
  } catch (err) {
    console.error("Price-drift email failed (non-fatal):", err.message);
  }
}

module.exports = async (req, res) => {
  try {
    const promptPrices = extractPricesFromPrompt();
    const variantIds = Array.from(promptPrices.keys());

    if (variantIds.length === 0) {
      return res.status(200).json({ checked: 0, discrepancies: 0, message: "No variant/price pairs found to check." });
    }

    const livePrices = await fetchLivePrices(variantIds);
    const priorPendingMisses = await getPendingMisses();

    const discrepancies = [];
    const missingThisRun = [];

    for (const [variantId, promptPrice] of promptPrices.entries()) {
      const live = livePrices.get(variantId);
      if (live === null || live === undefined) {
        missingThisRun.push(variantId);
      } else if (Math.abs(live.price - promptPrice) > 0.001) {
        // Price mismatches always alert immediately -- a real price change
        // is actionable right away, and doesn't carry the same
        // false-positive risk a "not found yet" blip does.
        discrepancies.push({ variantId, promptPrice, livePrice: live.price, title: live.title });
      }
    }

    // Two-consecutive-misses rule: only alert on a variant that was ALSO
    // missing on the prior run, not the first time it comes up missing.
    // Real false alarm this fixes: a brand-new product came back "missing"
    // on its very first check purely from a brief propagation delay right
    // after being published -- confirmed directly, it was genuinely fine.
    const confirmedMissing = [];
    for (const variantId of missingThisRun) {
      if (priorPendingMisses.has(variantId)) {
        confirmedMissing.push(variantId);
        // Stays recorded -- will keep alerting each run until it either
        // resolves (cleared below) or someone acts on it.
      } else {
        await recordPendingMiss(variantId);
      }
    }
    // Anything previously pending but NOT missing this run has resolved --
    // clear it so a future blip starts its own fresh two-run count rather
    // than being treated as a continuation of an old, already-resolved one.
    const missingThisRunSet = new Set(missingThisRun);
    for (const variantId of priorPendingMisses) {
      if (!missingThisRunSet.has(variantId)) {
        await clearPendingMiss(variantId);
      }
    }

    if (discrepancies.length > 0 || confirmedMissing.length > 0) {
      await sendDriftEmail(discrepancies, confirmedMissing);
    }

    return res.status(200).json({
      checked: variantIds.length,
      discrepancies: discrepancies.length,
      missingThisRun: missingThisRun.length,
      confirmedMissing: confirmedMissing.length,
      emailed: discrepancies.length > 0 || confirmedMissing.length > 0
    });
  } catch (err) {
    console.error("check-price-drift failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
