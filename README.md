# rucRak Crew Chief — Deployment Guide

Everything that could be built without your accounts/credentials is done and
tested. What's left is a short list of steps that genuinely require you —
they involve your Anthropic billing, your GitHub org, and your Vercel team,
none of which I can act on for you.

## What's built and verified

- `index.html` — the chat UI. Calls `/api/chat`, never touches your API key.
  **Now includes photo upload**: a camera button next to the text input lets
  customers attach a fitment photo, which gets resized/compressed client-side
  (max 1200px, JPEG quality 0.82) before sending, so it stays fast and cheap
  even from a full-size phone photo.
- `api/chat.js` — the serverless function. Holds the system prompt, calls
  Anthropic server-side, validates input, **rate-limits by IP**, and now
  **validates and forwards photo attachments** to Claude's vision capability
  for fitment reads (using the hitch receiver's standardized 2"x2" opening as
  a built-in size reference — no extra object needed in the photo).
- `api/health.js` — a free diagnostic endpoint to confirm deployment worked.
- `tests/chat.test.js` — **13 automated tests** (validation, error handling,
  message-history trimming, rate limiting, and image-block validation) that
  run with **zero API cost** because they mock the Anthropic call. **All 13
  currently pass.**
- `vercel.json` — explicit function config (timeouts).
- `.env.example` — documents the two environment variables you'll need.
- `.gitignore` — keeps secrets and local files out of version control.
- A local git repo, already initialized with commits on branch `main`,
  containing all of the above — ready for `git push` the moment you point it
  at a real GitHub remote.

## About the photo fitment feature

**How it works:** the customer taps the camera button, takes or picks a
photo showing their spare tire and hitch receiver, and sends it — with or
without a text question alongside it. Crew Chief reads the photo using the
hitch receiver's opening (a genuinely standardized 2"x2" size on vehicles
this product targets) as a built-in ruler, and gives an honest read: clearly
fine, clearly needs an extension kit, or "too close to call from this photo,
here's how to get a precise measurement instead."

**Why this is honest, not oversold:** it's explicitly instructed to calibrate
its own confidence and say so — a photo-based estimate is not lab-measurement
precision, and for anything borderline it's told to recommend a real
straightedge check (also documented in the system prompt) rather than fake
certainty.

**A platform detail worth knowing:** Vercel's default request body limit for
serverless functions like `api/chat.js` is roughly 4.5MB. The client-side
compression keeps a typical photo well under that (low hundreds of KB), and
the server independently caps any image at ~2.2MB decoded as a defense
against abuse — but if you ever raise the client-side compression settings
significantly, keep this ceiling in mind.

## Run the tests yourself (optional, but reassuring)

```bash
npm test
```

You should see `# pass 13` and `# fail 0`. This proves the request handling,
error responses, and rate limiter all behave correctly — before you've spent
a single cent calling the real Claude API.

## What only you can do from here

### 1. Get an Anthropic API key
Go to https://console.anthropic.com, sign in / create an account, add
billing, then **API Keys → Create Key**. Copy it somewhere safe.

*(Optional but recommended: set a spending cap in the console so a traffic
spike can't surprise you with a bill.)*

### 2. Push this to GitHub
The repo is already built and committed locally. You just need to point it
at a real remote and push:

```bash
cd rucrak-crew-chief
git remote add origin https://github.com/taskrocketai-create/rucrak-crew-chief.git
git push -u origin main
```

(Create the empty repo on GitHub first if it doesn't exist yet — no README,
no .gitignore, no license, so it doesn't conflict with what's already here.)

### 3. Import into Vercel
1. https://vercel.com/new → import the `rucrak-crew-chief` repo
2. Framework preset: **Other**
3. **Before deploying**, add environment variables (next step)

### 4. Set environment variables in Vercel
Project → **Settings → Environment Variables**:

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your real key from Step 1 |
| `ALLOWED_ORIGIN` | `https://rucrak.com` (or leave as `*` for initial testing) |

Redeploy after adding these.

### 5. Confirm it's live — for free
Visit `https://your-project-name.vercel.app/api/health`. You should see:

```json
{ "status": "ok", "hasApiKey": true, "allowedOrigin": "https://rucrak.com", ... }
```

If `hasApiKey` is `false`, the environment variable didn't get set before
the last deploy — add/fix it and redeploy.

### 6. Test the real chat
Visit `https://your-project-name.vercel.app` and talk to Crew Chief. This is
the first step that actually spends API credits.

### 7. Put it on rucrak.com
**Option A — subdomain/path (recommended):** point `support.rucrak.com` or
`rucrak.com/support` at the Vercel deployment (Vercel → Domains).

**Option B — embed as a widget:**
```html
<iframe
  src="https://your-project-name.vercel.app"
  style="width:100%; max-width:720px; height:640px; border:none; border-radius:8px;"
  title="rucRak Crew Chief Support">
</iframe>
```

## What's already hardened vs. what's still worth doing later

**Already built in:**
- API key never exposed to the browser
- CORS restriction via `ALLOWED_ORIGIN`
- Per-IP rate limiting (12 messages/minute) — blocks casual abuse/button-mashing
- Input validation (rejects malformed requests before they reach Anthropic)
- Conversation history capped at 40 messages server-side (cost/latency guard)
- Automated tests covering all of the above

**Worth doing before high-traffic launch (needs your accounts, so not built
by default):**
- **Durable rate limiting** — the current limiter resets if Vercel recycles
  the function instance (normal serverless behavior). For a hard guarantee
  under real load, swap in Vercel KV or Upstash Redis — both require
  creating a resource in your Vercel/Upstash account.
- **Spending cap** in the Anthropic console (Step 1 above) — five-minute
  task, biggest bang for the buck.
- **Analytics/logging** if you want to see what customers are actually
  asking — Vercel's built-in function logs cover basic cases for free.

## Updating the Crew Chief later

Everything he "knows" and his personality live in the `SYSTEM_PROMPT`
constant at the top of `api/chat.js`. Edit, run `npm test` to make sure
nothing broke, commit, push — Vercel auto-redeploys.
