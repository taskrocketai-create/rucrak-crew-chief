// tests/sms.test.js
//
// Run with: node --test tests/*.test.js
//
// Escalations also text Jason via Twilio. No real network calls -- fetch is
// mocked. The feature is opt-in: nothing is sent unless the Twilio env vars
// and JASON_NOTIFY_PHONE are all set.

const test = require("node:test");
const assert = require("node:assert/strict");

const { handleEscalation, buildSmsBody, toE164 } = require("../api/_notify.js");
const chatHandler = require("../api/chat.js");
const escalationHandler = require("../api/log-escalation.js");

function makeReqRes({ method = "POST", headers = {}, body = {}, ip = "1.2.3.4" } = {}) {
  const res = {
    _status: 200,
    _json: null,
    setHeader() {},
    status(code) { this._status = code; return this; },
    json(payload) { this._json = payload; return this; },
    end() { return this; }
  };
  const req = { method, headers: { "x-forwarded-for": ip, ...headers }, socket: { remoteAddress: ip }, body };
  return { req, res };
}

async function withEnvAndFetch(env, fetchImpl, fn) {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  global.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 20));

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "ACtest123",
  TWILIO_AUTH_TOKEN: "secret-token",
  TWILIO_FROM_NUMBER: "+19195550100",
  TWILIO_MESSAGING_SERVICE_SID: undefined,
  JASON_NOTIFY_PHONE: "(919) 555-0199",
  RESEND_API_KEY: undefined,
  JASON_NOTIFY_EMAIL: undefined,
  SUPABASE_URL: undefined,
  SUPABASE_SERVICE_KEY: undefined,
  ANTHROPIC_API_KEY: "test-key"
};

// Captures Twilio calls; answers everything else with an empty OK.
function twilioMocks(texts, { twilioOk = true, anthropicReply = "Got it." } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("api.twilio.com")) {
      texts.push({ url: u, headers: opts.headers, params: new URLSearchParams(opts.body) });
      return twilioOk
        ? { ok: true, status: 201, text: async () => "", json: async () => ({}) }
        : { ok: false, status: 400, text: async () => "bad", json: async () => ({}) };
    }
    if (u.includes("api.anthropic.com")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: anthropicReply }] }) };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => [] };
  };
}

// --- unit ---------------------------------------------------------------

test("toE164 normalizes common US formats and rejects junk", () => {
  assert.equal(toE164("(919) 555-0199"), "+19195550199");
  assert.equal(toE164("919-555-0199"), "+19195550199");
  assert.equal(toE164("1 919 555 0199"), "+19195550199");
  assert.equal(toE164("+19195550199"), "+19195550199");
  assert.equal(toE164("12345"), null);
  assert.equal(toE164(""), null);
});

test("buildSmsBody includes channel, question, name and contact, and trims long questions", () => {
  const b = buildSmsBody({ channel: "voice", question: "Missing rack\nstructure", customerName: "Edward Tunney", customerContact: "630-921-3779" });
  assert.ok(b.includes("(voice)"));
  assert.ok(b.includes("Missing rack structure"), "newlines collapsed");
  assert.ok(b.includes("Edward Tunney 630-921-3779"));
  const long = buildSmsBody({ channel: "text", question: "x".repeat(500), customerName: null, customerContact: null });
  assert.ok(long.length < 260, `body should stay short, got ${long.length}`);
  assert.ok(long.includes("no contact given"));
  assert.ok(long.includes("..."));
});

// --- sending ------------------------------------------------------------

test("sends a text to Jason with the right To/From/Body and Basic auth", async () => {
  const texts = [];
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts), async () => {
    await handleEscalation({ channel: "voice", question: "Missing parts", customerName: "Edward", customerContact: "630-921-3779" });
    assert.equal(texts.length, 1);
    const t = texts[0];
    assert.equal(t.url, "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json");
    assert.equal(t.params.get("To"), "+19195550199");
    assert.equal(t.params.get("From"), "+19195550100");
    assert.ok(t.params.get("Body").includes("Missing parts"));
    assert.equal(t.headers.Authorization, "Basic " + Buffer.from("ACtest123:secret-token").toString("base64"));
  });
});

test("uses a Messaging Service instead of a From number when configured", async () => {
  const texts = [];
  await withEnvAndFetch({ ...TWILIO_ENV, TWILIO_FROM_NUMBER: undefined, TWILIO_MESSAGING_SERVICE_SID: "MGabc" }, twilioMocks(texts), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.equal(texts.length, 1);
    assert.equal(texts[0].params.get("MessagingServiceSid"), "MGabc");
    assert.equal(texts[0].params.get("From"), null);
  });
});

test("texts every number in a comma-separated list", async () => {
  const texts = [];
  await withEnvAndFetch({ ...TWILIO_ENV, JASON_NOTIFY_PHONE: "919-555-0199, 252-555-0111" }, twilioMocks(texts), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.deepEqual(texts.map((t) => t.params.get("To")).sort(), ["+12525550111", "+19195550199"]);
  });
});

test("does nothing when Twilio is not configured (no Twilio call, no crash)", async () => {
  for (const missing of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "JASON_NOTIFY_PHONE"]) {
    const texts = [];
    await withEnvAndFetch({ ...TWILIO_ENV, [missing]: undefined }, twilioMocks(texts), async () => {
      await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
      assert.equal(texts.length, 0, `should skip when ${missing} is missing`);
    });
  }
  const texts = [];
  await withEnvAndFetch({ ...TWILIO_ENV, TWILIO_FROM_NUMBER: undefined }, twilioMocks(texts), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.equal(texts.length, 0, "needs a From number or a Messaging Service");
  });
});

test("a Twilio failure never throws or blocks the rest of the escalation", async () => {
  const texts = [];
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts, { twilioOk: false }), async () => {
    await assert.doesNotReject(handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null }));
    assert.equal(texts.length, 1);
  });
});

// --- flood guard --------------------------------------------------------

function floodMocks(texts, escalationRows, { ok = true } = {}) {
  const base = twilioMocks(texts);
  return async (url, opts) => {
    if (String(url).includes("rucrak_chief_escalations")) {
      return ok
        ? { ok: true, status: 200, json: async () => escalationRows }
        : { ok: false, status: 500, json: async () => ({}), text: async () => "err" };
    }
    return base(url, opts);
  };
}

const SUPA = { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key" };

test("flood guard: stops texting after more than 5 escalations in an hour", async () => {
  const texts = [];
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }));
  await withEnvAndFetch({ ...TWILIO_ENV, ...SUPA }, floodMocks(texts, rows), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.equal(texts.length, 0);
  });
});

test("flood guard: still texts when under the limit", async () => {
  const texts = [];
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: String(i) }));
  await withEnvAndFetch({ ...TWILIO_ENV, ...SUPA }, floodMocks(texts, rows), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.equal(texts.length, 1);
  });
});

test("flood guard fails open: texts anyway if the count can't be checked", async () => {
  const texts = [];
  await withEnvAndFetch({ ...TWILIO_ENV, ...SUPA }, floodMocks(texts, [], { ok: false }), async () => {
    await handleEscalation({ channel: "text", question: "Q", customerName: null, customerContact: null });
    assert.equal(texts.length, 1);
  });
});

// --- real entry points --------------------------------------------------

test("voice flag_escalation tool call texts Jason", async () => {
  const texts = [];
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts), async () => {
    const { req, res } = makeReqRes({
      body: { message: { toolCallList: [{ id: "tc1", function: { arguments: { question: "Basket lost on highway", customerName: "Ralph", customerContact: "919-555-0123" } } }] } }
    });
    await escalationHandler(req, res);
    assert.equal(res._json.results[0].toolCallId, "tc1");
    assert.equal(texts.length, 1);
    assert.ok(texts[0].params.get("Body").includes("Basket lost on highway"));
    assert.ok(texts[0].params.get("Body").includes("Ralph 919-555-0123"));
  });
});

test("text chat: a customer leaving a phone number texts Jason (lead backstop)", async () => {
  const texts = [];
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.5.1",
      body: { messages: [{ role: "user", content: "call me about a bulk order, 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(texts.length, 1);
    assert.ok(texts[0].params.get("Body").includes("434-547-9024"));
  });
});

test("text chat: a promo opt-in does NOT text Jason", async () => {
  const texts = [];
  const reply = 'You are on the list!\n@@PROMO_OPTIN@@{"contactMethod":"434-547-9024","contactType":"phone","customerName":"Dave"}@@END@@';
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts, { anthropicReply: reply }), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.5.2",
      body: { messages: [{ role: "user", content: "yes add me, I'm Dave, 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(texts.length, 0);
  });
});

test("text chat: an ordinary question with no escalation does NOT text Jason", async () => {
  const texts = [];
  await withEnvAndFetch(TWILIO_ENV, twilioMocks(texts), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.5.3",
      body: { messages: [{ role: "user", content: "does it fit a 2018 Jeep JK?" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(texts.length, 0);
  });
});
