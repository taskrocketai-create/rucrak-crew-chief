// api/health.js
//
// Lightweight endpoint to confirm the deployment is live and the required
// environment variable is set — without spending any Anthropic API credits.
//
// Visit: https://your-deployment.vercel.app/api/health
// Expected response: { "status": "ok", "hasApiKey": true }
//
// If "hasApiKey" is false, you forgot to set ANTHROPIC_API_KEY in Vercel's
// environment variables (Settings -> Environment Variables), or you deployed
// before adding it and need to redeploy.

module.exports = (req, res) => {
  res.status(200).json({
    status: "ok",
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    allowedOrigin: process.env.ALLOWED_ORIGIN || "* (not restricted — set ALLOWED_ORIGIN before going live)",
    timestamp: new Date().toISOString()
  });
};
