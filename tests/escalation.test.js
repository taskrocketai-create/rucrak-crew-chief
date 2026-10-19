// tests/escalation.test.js
//
// Run with: node --test tests/
//
// Covers the deterministic lead backstop: a phone number or email handed over
// by a customer must reach Jason by email even when the model forgets to
// escalate. No real network calls -- fetch is mocked.

const test = require("node:test");
const assert = require("node:assert/strict");

const { detectNewLead, detectLeadInTranscript, findContacts, normalizeSpokenDigits } = require("../api/_notify.js");
const chatHandler = require("../api/chat.js");
const voiceLogHandler = require("../api/log-voice-call.js");

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

const ENV = {
  ANTHROPIC_API_KEY: "test-key",
  RESEND_API_KEY: "re_test",
  JASON_NOTIFY_EMAIL: "jason@example.com",
  SUPABASE_URL: undefined,
  SUPABASE_SERVICE_KEY: undefined
};

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

// --- unit: detection ----------------------------------------------------

test("detects a phone number in common formats", () => {
  for (const s of ["434-547-9024", "(434) 547-9024", "434.547.9024", "4345479024", "+1 434 547 9024"]) {
    assert.equal(findContacts(`call me at ${s} thanks`).length, 1, s);
  }
});

test("detects an email address", () => {
  assert.deepEqual(findContacts("it's bob.smith+rack@gmail.com"), ["bob.smith+rack@gmail.com"]);
});

test("does not mistake long IDs or short numbers for a phone number", () => {
  assert.equal(findContacts("variant 41234567890123 and order 123456").length, 0);
  assert.equal(findContacts("it holds 150 lbs on a 2 inch hitch, 2018 Jeep").length, 0);
});

test("detectNewLead fires on a new phone number and carries conversation context", () => {
  const lead = detectNewLead(["Are there other color options?", "2023 Ford Bronco", "my number is 434-547-9024"]);
  assert.ok(lead);
  assert.equal(lead.customerContact, "434-547-9024");
  assert.ok(lead.question.startsWith("LEAD"));
  assert.ok(lead.question.includes("2023 Ford Bronco"));
});

test("detectNewLead stays quiet when the contact already appeared earlier", () => {
  assert.equal(detectNewLead(["call 434-547-9024", "also do you have a cover?"]), null);
  assert.equal(detectNewLead(["call 434-547-9024", "again: (434) 547-9024"]), null, "same number, different format");
});

test("detectNewLead returns null with no contact info", () => {
  assert.equal(detectNewLead(["2018 2-door Jeep", "is there a cover system?"]), null);
});

test("detectLeadInTranscript finds a contact anywhere in the customer's turns", () => {
  const lead = detectLeadInTranscript(["hi", "my email is a@b.co", "thanks"]);
  assert.equal(lead.customerContact, "a@b.co");
});

// --- unit: spoken (voice) numbers ----------------------------------------

test("spoken phone numbers become real digits", () => {
  assert.deepEqual(findContacts("it is four three four five four seven nine zero two four"), ["434-547-9024"]);
  assert.deepEqual(findContacts("four three four, five four seven, nine oh two four"), ["434-547-9024"], "commas and 'oh'");
  assert.deepEqual(findContacts("six three zero nine two one nine three double seven"), ["630-921-9377"], "'double'");
  assert.deepEqual(findContacts("4 3 4 5 4 7 9 0 2 4"), ["434-547-9024"], "single digits with spaces");
  assert.deepEqual(findContacts("one four three four five four seven nine zero two four"), ["+1 434-547-9024"], "leading one");
});

test("short or non-phone spoken number runs are left alone", () => {
  assert.equal(normalizeSpokenDigits("I have two or three kids"), "I have two or three kids");
  assert.equal(normalizeSpokenDigits("one two three four five"), "one two three four five");
  assert.equal(findContacts("it weighs one hundred fifty pounds").length, 0);
});

// --- integration: text chat ---------------------------------------------

function textMocks(replyText, sent) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: replyText }] }) };
    }
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    throw new Error("unexpected fetch to " + u);
  };
}

test("text chat: emails Jason when a customer leaves a phone number and the model did NOT escalate", async () => {
  const sent = [];
  await withEnvAndFetch(ENV, textMocks("Got it, thanks!", sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.0.1",
      body: {
        messages: [
          { role: "user", content: "I have a 2023 Ford Bronco" },
          { role: "assistant", content: "Nice, the GRUNT fits that." },
          { role: "user", content: "great, call me at 434-547-9024" }
        ]
      }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(res._status, 200);
    assert.equal(sent.length, 1, "exactly one email to Jason");
    assert.deepEqual(sent[0].to, ["jason@example.com"]);
    assert.ok(sent[0].text.includes("434-547-9024"));
    assert.ok(sent[0].subject.includes("LEAD"));
  });
});

test("text chat: no duplicate email when the model already escalated this turn", async () => {
  const sent = [];
  const reply = 'Passing that to Jason!\n@@ESCALATE@@{"question":"wants a quote","customerName":"Bob","customerContact":"434-547-9024"}@@END@@';
  await withEnvAndFetch(ENV, textMocks(reply, sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.0.2",
      body: { messages: [{ role: "user", content: "call me at 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(sent.length, 1, "model's own escalation only");
    assert.ok(sent[0].subject.includes("wants a quote"));
  });
});

test("text chat: no email when there is no contact info and no escalation", async () => {
  const sent = [];
  await withEnvAndFetch(ENV, textMocks("Sure thing.", sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.0.3",
      body: { messages: [{ role: "user", content: "does it fit a 2018 Jeep JK?" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(sent.length, 0);
  });
});

test("text chat: does not re-email on later turns once the number was already given", async () => {
  const sent = [];
  await withEnvAndFetch(ENV, textMocks("Anytime!", sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.0.4",
      body: {
        messages: [
          { role: "user", content: "my number is 434-547-9024" },
          { role: "assistant", content: "Thanks, I'll pass it along." },
          { role: "user", content: "do you make a cover?" }
        ]
      }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(sent.length, 0);
  });
});

// --- integration: voice call end ----------------------------------------

function voiceMocks({ sent, recentEscalationRows, promoRows = [] }) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    if (u.includes("rucrak_promo_optins")) {
      return { ok: true, status: 200, json: async () => promoRows };
    }
    if (u.includes("rucrak_chief_escalations")) {
      return { ok: true, status: 200, json: async () => recentEscalationRows };
    }
    if (u.includes("rucrak_chief_calls")) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error("unexpected fetch to " + u);
  };
}

const VOICE_ENV = { ...ENV, SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key" };
const VOICE_BODY = {
  transcript: [
    { role: "user", text: "Does it fit a 2023 Bronco?" },
    { role: "assistant", text: "It does." },
    { role: "user", text: "Great, my number is 434 547 9024" }
  ]
};

test("voice: emails Jason at call end when a number was spoken and Daryl never escalated", async () => {
  const sent = [];
  await withEnvAndFetch(VOICE_ENV, voiceMocks({ sent, recentEscalationRows: [] }), async () => {
    const { req, res } = makeReqRes({ body: VOICE_BODY });
    await voiceLogHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes("434 547 9024"));
  });
});

test("voice: stays quiet when Daryl already escalated during the call", async () => {
  const sent = [];
  await withEnvAndFetch(VOICE_ENV, voiceMocks({ sent, recentEscalationRows: [{ id: "abc" }] }), async () => {
    const { req, res } = makeReqRes({ body: VOICE_BODY });
    await voiceLogHandler(req, res);
    assert.equal(sent.length, 0);
  });
});

test("voice: a number spoken in words is recorded as digits in the email to Jason", async () => {
  const sent = [];
  await withEnvAndFetch(VOICE_ENV, voiceMocks({ sent, recentEscalationRows: [] }), async () => {
    const { req, res } = makeReqRes({
      body: {
        transcript: [
          { role: "user", text: "Does it fit a 2023 Bronco?" },
          { role: "assistant", text: "It does." },
          { role: "user", text: "Great, call me at four three four, five four seven, nine zero two four" }
        ]
      }
    });
    await voiceLogHandler(req, res);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes("Contact: 434-547-9024"), "contact should be the digits, not the words");
  });
});

// --- promo opt-in saves the name along with the contact -------------------

const OPTIN_ENV = { ANTHROPIC_API_KEY: "test-key", RESEND_API_KEY: undefined, JASON_NOTIFY_EMAIL: undefined, SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key" };

function optinMocks(replyText, inserted) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: replyText }] }) };
    }
    if (u.includes("rucrak_promo_optins")) {
      inserted.push(JSON.parse(opts.body)[0]);
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (u.includes("rucrak_live_price_cache")) {
      return { ok: false, status: 404, json: async () => [] };
    }
    return { ok: true, status: 201, json: async () => ({}) }; // calls log, escalation log, etc.
  };
}

test("text chat: promo opt-in saves the customer's name and number", async () => {
  const inserted = [];
  const reply = 'Done, you are on the list!\n@@PROMO_OPTIN@@{"contactMethod":"434-547-9024","contactType":"phone","customerName":"Dave"}@@END@@';
  await withEnvAndFetch(OPTIN_ENV, optinMocks(reply, inserted), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.1.1",
      body: { messages: [{ role: "user", content: "yes, add me. I'm Dave, 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].customer_name, "Dave");
    assert.equal(inserted[0].contact_method, "434-547-9024");
    assert.equal(inserted[0].contact_type, "phone");
    assert.ok(!res._json.text.includes("@@"), "marker must be stripped from what the customer sees");
  });
});

test("text chat: promo opt-in without a name still saves the contact", async () => {
  const inserted = [];
  const reply = 'You are on the list!\n@@PROMO_OPTIN@@{"contactMethod":"dave@example.com","contactType":"email"}@@END@@';
  await withEnvAndFetch(OPTIN_ENV, optinMocks(reply, inserted), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.1.2",
      body: { messages: [{ role: "user", content: "sure, dave@example.com" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].customer_name, null);
    assert.equal(inserted[0].contact_method, "dave@example.com");
  });
});

test("voice: log_promo_optin tool saves the name and number", async () => {
  const promoHandler = require("../api/log-promo-optin.js");
  const inserted = [];
  await withEnvAndFetch(OPTIN_ENV, optinMocks("", inserted), async () => {
    const { req, res } = makeReqRes({
      body: { message: { toolCallList: [{ id: "tc1", function: { arguments: { contactMethod: "4345479024", contactType: "phone", customerName: "Dave" } } }] } }
    });
    await promoHandler(req, res);
    assert.equal(res._json.results[0].toolCallId, "tc1");
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].customer_name, "Dave");
    assert.equal(inserted[0].contact_method, "4345479024");
  });
});

// --- promo opt-ins are saved + reported weekly, NOT emailed one by one -----

const OPTIN_EMAIL_ENV = { ...OPTIN_ENV, RESEND_API_KEY: "re_test", JASON_NOTIFY_EMAIL: "jason@example.com" };

function optinWithResendMocks(replyText, inserted, sent) {
  const base = optinMocks(replyText, inserted);
  return async (url, opts) => {
    if (String(url).includes("api.resend.com")) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    return base(url, opts);
  };
}

test("text chat: a promo opt-in is saved but does NOT email Jason", async () => {
  const inserted = [];
  const sent = [];
  const reply = 'You are on the list!\n@@PROMO_OPTIN@@{"contactMethod":"434-547-9024","contactType":"phone","customerName":"Dave"}@@END@@';
  await withEnvAndFetch(OPTIN_EMAIL_ENV, optinWithResendMocks(reply, inserted, sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.2.1",
      body: { messages: [{ role: "user", content: "yes add me, I'm Dave, 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(inserted.length, 1, "opt-in saved");
    assert.equal(sent.length, 0, "no lead email for a promo opt-in");
  });
});

test("text chat: a separate callback number alongside a promo opt-in still emails Jason", async () => {
  const inserted = [];
  const sent = [];
  const reply = 'Both noted!\n@@PROMO_OPTIN@@{"contactMethod":"dave@example.com","contactType":"email","customerName":"Dave"}@@END@@';
  await withEnvAndFetch(OPTIN_EMAIL_ENV, optinWithResendMocks(reply, inserted, sent), async () => {
    const { req, res } = makeReqRes({
      ip: "10.9.2.2",
      body: { messages: [{ role: "user", content: "sign me up at dave@example.com, and call me about a bulk order at 434-547-9024" }] }
    });
    await chatHandler(req, res);
    await tick();
    assert.equal(inserted.length, 1);
    assert.equal(sent.length, 1, "the callback number is a real lead");
    assert.ok(sent[0].text.includes("434-547-9024"));
    assert.ok(!sent[0].text.includes("Contact: dave@example.com"), "the promo email is not the lead contact");
  });
});

test("voice: a number logged as a promo opt-in during the call does NOT email Jason", async () => {
  const sent = [];
  await withEnvAndFetch(
    VOICE_ENV,
    voiceMocks({ sent, recentEscalationRows: [], promoRows: [{ contact_method: "4345479024" }] }),
    async () => {
      const { req, res } = makeReqRes({ body: VOICE_BODY });
      await voiceLogHandler(req, res);
      assert.equal(sent.length, 0);
    }
  );
});

test("weekly report lists promo sign-ups with name and number", async () => {
  const reportHandler = require("../api/weekly-report.js");
  const sent = [];
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "Quiet week." }] }) };
    }
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    if (u.includes("rucrak_promo_optins")) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { customer_name: "Dave", contact_method: "434-547-9024", contact_type: "phone", channel: "voice" },
          { customer_name: null, contact_method: "sam@example.com", contact_type: "email", channel: "text" }
        ]
      };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  await withEnvAndFetch({ ...ENV, SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key", CRON_SECRET: undefined }, fetchImpl, async () => {
    const { req, res } = makeReqRes({ method: "GET", headers: {} });
    await reportHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(sent.length, 1);
    const body = sent[0].text;
    assert.ok(body.includes("New promo list sign-ups this week (2):"));
    assert.ok(body.includes("Dave — 434-547-9024 (phone, voice)"));
    assert.ok(body.includes("(name not given) — sam@example.com (email, text)"));
  });
});

test("weekly report says so when there were no promo sign-ups", async () => {
  const reportHandler = require("../api/weekly-report.js");
  const sent = [];
  const fetchImpl = async (url, opts) => {
    const u = String(url);
    if (u.includes("api.anthropic.com")) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "Quiet week." }] }) };
    }
    if (u.includes("api.resend.com")) {
      sent.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "" };
    }
    return { ok: true, status: 200, json: async () => [] };
  };
  await withEnvAndFetch({ ...ENV, SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key", CRON_SECRET: undefined }, fetchImpl, async () => {
    const { req, res } = makeReqRes({ method: "GET", headers: {} });
    await reportHandler(req, res);
    assert.ok(sent[0].text.includes("New promo list sign-ups this week: none."));
  });
});
