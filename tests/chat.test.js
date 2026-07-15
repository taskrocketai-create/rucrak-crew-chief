// tests/chat.test.js
//
// Run with: node --test tests/
//
// These tests exercise api/chat.js directly (no real network calls — fetch
// is mocked) so you can verify the request-handling logic — validation,
// error shapes, and rate limiting — works correctly before ever deploying
// or spending a cent on the real Anthropic API.

const test = require("node:test");
const assert = require("node:assert/strict");

// Minimal mock of Vercel's (req, res) so we can call the handler directly.
function makeReqRes({ method = "POST", headers = {}, body = {}, ip = "1.2.3.4" } = {}) {
  const res = {
    _status: 200,
    _json: null,
    _ended: false,
    _headers: {},
    setHeader(k, v) {
      this._headers[k] = v;
    },
    status(code) {
      this._status = code;
      return this;
    },
    json(payload) {
      this._json = payload;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    }
  };
  const req = {
    method,
    headers: { "x-forwarded-for": ip, ...headers },
    socket: { remoteAddress: ip },
    body
  };
  return { req, res };
}

function withMockedFetch(mockImpl, fn) {
  const original = global.fetch;
  global.fetch = mockImpl;
  return fn().finally(() => {
    global.fetch = original;
  });
}

function withEnv(vars, fn) {
  const original = { ...process.env };
  Object.assign(process.env, vars);
  for (const key of Object.keys(vars)) {
    if (vars[key] === undefined) delete process.env[key];
  }
  return fn().finally(() => {
    process.env = original;
  });
}

// Fresh require of the handler per test file run (module-level rate-limit
// state persists across tests in this file by design — see the dedicated
// rate-limit test below, which accounts for that with a unique IP).
const handler = require("../api/chat.js");

test("rejects non-POST methods with 405", async () => {
  const { req, res } = makeReqRes({ method: "GET" });
  await handler(req, res);
  assert.equal(res._status, 405);
  assert.match(res._json.error, /Method not allowed/);
});

test("OPTIONS preflight returns 200 and ends", async () => {
  const { req, res } = makeReqRes({ method: "OPTIONS" });
  await handler(req, res);
  assert.equal(res._status, 200);
  assert.equal(res._ended, true);
});

test("returns 500 with a clear message if ANTHROPIC_API_KEY is missing", async () => {
  await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
    const { req, res } = makeReqRes({ body: { messages: [{ role: "user", content: "hi" }] }, ip: "10.0.0.1" });
    await handler(req, res);
    assert.equal(res._status, 500);
    assert.match(res._json.error, /ANTHROPIC_API_KEY is not set/);
  });
});

test("returns 400 when messages is missing or not an array", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    const { req, res } = makeReqRes({ body: {}, ip: "10.0.0.2" });
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._json.error, /non-empty 'messages' array/);
  });
});

test("happy path: extracts text from a mocked successful Anthropic response", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "text", text: "Well shoot, that's an easy fix." }]
        })
      }),
      async () => {
        const { req, res } = makeReqRes({
          body: { messages: [{ role: "user", content: "why is my rack loose" }] },
          ip: "10.0.0.3"
        });
        await handler(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.text, "Well shoot, that's an easy fix.");
      }
    );
  });
});

test("propagates an Anthropic API error with its status code", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    await withMockedFetch(
      async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "invalid x-api-key" } })
      }),
      async () => {
        const { req, res } = makeReqRes({
          body: { messages: [{ role: "user", content: "hi" }] },
          ip: "10.0.0.4"
        });
        await handler(req, res);
        assert.equal(res._status, 401);
        assert.match(res._json.error, /invalid x-api-key/);
      }
    );
  });
});

test("trims conversation history to the last 40 messages before sending upstream", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    let capturedBody = null;
    await withMockedFetch(
      async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) };
      },
      async () => {
        const longHistory = Array.from({ length: 55 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `message ${i}`
        }));
        const { req, res } = makeReqRes({ body: { messages: longHistory }, ip: "10.0.0.5" });
        await handler(req, res);
        assert.equal(res._status, 200);
        assert.equal(capturedBody.messages.length, 40);
        // Should keep the most recent messages, not the oldest.
        assert.equal(capturedBody.messages[capturedBody.messages.length - 1].content, "message 54");
      }
    );
  });
});

test("rate limits a single IP after too many requests in the window", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }),
      async () => {
        const ip = "10.0.0.99"; // unique IP so this test doesn't collide with others
        let lastRes;
        for (let i = 0; i < 13; i++) {
          const { req, res } = makeReqRes({ body: { messages: [{ role: "user", content: "hi" }] }, ip });
          await handler(req, res);
          lastRes = res;
        }
        assert.equal(lastRes._status, 429);
        assert.match(lastRes._json.error, /too many messages/i);
      }
    );
  });
});

test("accepts a well-formed image content block and passes it through to the Anthropic API", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    let capturedBody = null;
    await withMockedFetch(
      async (_url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "looks fine to me" }] }) };
      },
      async () => {
        const imageMessage = {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "ZmFrZWJhc2U2NGRhdGE=" } },
            { type: "text", text: "Can you check my fitment?" }
          ]
        };
        const { req, res } = makeReqRes({ body: { messages: [imageMessage] }, ip: "10.0.0.10" });
        await handler(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.text, "looks fine to me");
        // Confirm the image block actually made it through to the upstream call unmodified.
        const sentContent = capturedBody.messages[0].content;
        assert.equal(sentContent[0].type, "image");
        assert.equal(sentContent[0].source.media_type, "image/jpeg");
      }
    );
  });
});

test("rejects an image block with a malformed source (not base64)", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    const badMessage = {
      role: "user",
      content: [{ type: "image", source: { type: "url", url: "https://example.com/x.jpg" } }]
    };
    const { req, res } = makeReqRes({ body: { messages: [badMessage] }, ip: "10.0.0.11" });
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._json.error, /Malformed image block/);
  });
});

test("rejects an unsupported image media type", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    const badMessage = {
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/tiff", data: "ZmFrZQ==" } }]
    };
    const { req, res } = makeReqRes({ body: { messages: [badMessage] }, ip: "10.0.0.12" });
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.match(res._json.error, /Unsupported image type/);
  });
});

test("rejects an oversized image payload", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    const hugeData = "A".repeat(3_000_001); // one char over the 3,000,000-char ceiling
    const badMessage = {
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: hugeData } }]
    };
    const { req, res } = makeReqRes({ body: { messages: [badMessage] }, ip: "10.0.0.13" });
    await handler(req, res);
    assert.equal(res._status, 413);
    assert.match(res._json.error, /too large/);
  });
});

test("plain string content (no image) still works exactly as before", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "still works" }] }) }),
      async () => {
        const { req, res } = makeReqRes({
          body: { messages: [{ role: "user", content: "plain text question" }] },
          ip: "10.0.0.14"
        });
        await handler(req, res);
        assert.equal(res._status, 200);
        assert.equal(res._json.text, "still works");
      }
    );
  });
});

test("logs a handled call to Supabase when SUPABASE_URL/SUPABASE_SERVICE_KEY are configured", async () => {
  await withEnv(
    { ANTHROPIC_API_KEY: "test-key", SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_KEY: "fake-key" },
    async () => {
      let loggedCall = null;
      const original = global.fetch;
      global.fetch = async (url, opts) => {
        if (String(url).includes("api.anthropic.com")) {
          return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "reply" }] }) };
        }
        if (String(url).includes("rucrak_chief_calls")) {
          loggedCall = JSON.parse(opts.body)[0];
          return { ok: true, status: 201, json: async () => ({}) };
        }
        throw new Error("unexpected fetch to " + url);
      };
      try {
        const { req, res } = makeReqRes({
          body: { messages: [{ role: "user", content: "will this fit my Jeep?" }] },
          ip: "10.0.0.15"
        });
        await handler(req, res);
        assert.equal(res._status, 200);
        // give the fire-and-forget logging call a tick to complete
        await new Promise((r) => setTimeout(r, 10));
        assert.ok(loggedCall, "expected a call to be logged");
        assert.equal(loggedCall.first_message, "will this fit my Jeep?");
        assert.equal(loggedCall.message_count, 1);
        assert.equal(loggedCall.had_image, false);
      } finally {
        global.fetch = original;
      }
    }
  );
});

test("skips logging silently when Supabase env vars are not configured (no crash, no extra fetch)", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key", SUPABASE_URL: undefined, SUPABASE_SERVICE_KEY: undefined }, async () => {
    let fetchCallCount = 0;
    const original = global.fetch;
    global.fetch = async () => {
      fetchCallCount++;
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "reply" }] }) };
    };
    try {
      const { req, res } = makeReqRes({ body: { messages: [{ role: "user", content: "hi" }] }, ip: "10.0.0.16" });
      await handler(req, res);
      assert.equal(res._status, 200);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(fetchCallCount, 1, "only the Anthropic call should have fired, no logging call");
    } finally {
      global.fetch = original;
    }
  });
});
