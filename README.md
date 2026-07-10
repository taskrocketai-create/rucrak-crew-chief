# rucRak Crew Chief — Deployment Guide

This turns the Crew Chief chatbot into a live, standalone site (or an embeddable
widget) that talks to Claude through your own secured backend — no API key
ever touches the browser.

## What's in this folder

- `index.html` — the frontend (the chat UI you already saw). Calls `/api/chat`.
- `api/chat.js` — a Vercel serverless function. This holds the system prompt
  and your Anthropic API key (as an environment variable, never in code).
- `package.json` — minimal project file so Vercel recognizes this as a Node project.

## Step 1 — Get an Anthropic API key (if you don't have one yet)

1. Go to https://console.anthropic.com
2. Create/sign in to an account, add billing
3. Go to **API Keys** → **Create Key**
4. Copy it somewhere safe — you won't be able to see it again after this

## Step 2 — Push this to GitHub

Using your existing `taskrocketai-create` org:

```bash
cd rucrak-crew-chief
git init
git add .
git commit -m "rucRak Crew Chief chatbot"
git remote add origin https://github.com/taskrocketai-create/rucrak-crew-chief.git
git push -u origin main
```

(Create the empty repo on GitHub first if it doesn't exist yet.)

## Step 3 — Deploy to Vercel

1. Go to https://vercel.com/new
2. Import the `rucrak-crew-chief` repo (should show up under your
   `taskrocketai-create` org / your existing Vercel team)
3. Framework preset: **Other** (it's a static HTML + serverless function
   project, not a framework)
4. Before clicking Deploy, add the environment variable below

## Step 4 — Set environment variables

In the Vercel project → **Settings → Environment Variables**, add:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your real key from Step 1 |
| `ALLOWED_ORIGIN` | `https://rucrak.com` (restrict who can call your API — see note below) |

Redeploy after adding these (Vercel → Deployments → ⋯ → Redeploy).

## Step 5 — Test it

Visit `https://your-project-name.vercel.app` — the chat should now work
live, calling your own `/api/chat` function instead of Anthropic directly.

## Step 6 — Put it on rucrak.com

You have two good options:

**Option A — Subdomain or path (recommended, simplest)**
Point `support.rucrak.com` or `rucrak.com/support` at this Vercel deployment
(Vercel → Settings → Domains → add the domain, then update the DNS record
your registrar gives you).

**Option B — Embed as a widget on existing pages**
Drop this on any page on rucrak.com:

```html
<iframe
  src="https://your-project-name.vercel.app"
  style="width:100%; max-width:720px; height:640px; border:none; border-radius:8px;"
  title="rucRak Crew Chief Support">
</iframe>
```

If you go this route, set `ALLOWED_ORIGIN` to `https://rucrak.com` (Step 4)
so only pages on your actual site can call the backend.

## About `ALLOWED_ORIGIN`

This is a basic safeguard so random other websites can't quietly point their
own frontend at your `/api/chat` endpoint and run up your Anthropic bill on
your dime. It's not bulletproof (a determined bad actor can spoof headers),
but it stops casual abuse. For a public-facing production chatbot, you'll
eventually also want:

- **Rate limiting** per visitor (e.g., a Vercel KV / Upstash Redis counter
  capping messages per IP per hour) — the current function has no rate
  limiting built in, so a bad actor hammering it could run up cost.
- **A usage/cost cap** in your Anthropic console so a runaway script can't
  surprise you with a bill.

I kept the function itself simple on purpose so it's easy to read and modify
— happy to add rate limiting if you want to harden it before launch.

## Updating the Crew Chief's knowledge or personality later

Everything the Crew Chief "knows" lives in the `SYSTEM_PROMPT` constant at
the top of `api/chat.js`. To update tone, add new products, fix a fitment
number, etc.: edit that file, commit, push — Vercel auto-redeploys.
