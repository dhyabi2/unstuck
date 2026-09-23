#!/usr/bin/env node
/**
 * opener/test_oracle_webhook.js — verifies L81 and its sibling law.
 *
 * Exercises the webhook notifier's core behaviour with a real local HTTP server
 * as the receiver, so "fires a POST to registered callback URLs" is proven by an
 * actual request, not by a mock return value. A passing exit code (0) means every
 * assertion below held; any failure exits 1.
 */
const http = require("http");
const { fireIfNeeded } = require("./oracle-webhook.js");

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${label}`);
  }
}

async function main() {
  // Spin up a capture server.
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const webhook = `http://127.0.0.1:${port}/hook`;

  const config = {
    threshold_consecutive_down: 3,
    urls: [
      { url: "https://api.example.com/data", webhook, enabled: true },
      { url: "https://unwatched.example.com", webhook, enabled: false },
    ],
  };

  const ts = "2026-09-23T00:00:00.000Z";

  // Scenario 1: below threshold fires nothing.
  let state = { per_url: {} };
  let fired = await fireIfNeeded(
    [
      { event: "DOWN", url: "https://api.example.com/data", ts, score: 40 },
      { event: "DOWN", url: "https://api.example.com/data", ts, score: 40 },
    ],
    state,
    config,
    {}
  );
  assert(fired.length === 0, "two DOWNs below threshold 3 fires nothing");
  assert(state.per_url["https://api.example.com/data"].down === 2, "consecutive-down count reaches 2");

  // Scenario 2: the third DOWN crosses the threshold and fires exactly one webhook.
  fired = await fireIfNeeded(
    [{ event: "DOWN", url: "https://api.example.com/data", ts, score: 40, status: 404 }],
    state,
    config,
    {}
  );
  const cross = fired.filter((p) => p.event === "DOWN_THRESHOLD");
  assert(cross.length === 1, "third DOWN crosses threshold and fires one DOWN_THRESHOLD");
  assert(cross[0].consecutive_down === 3, "fired payload carries consecutive_down = threshold");
  assert(cross[0].url === "https://api.example.com/data", "fired payload names the watched URL");
  assert(received.length === 1 && received[0].method === "POST", "one real POST reached the webhook");
  assert(received[0].body.event === "DOWN_THRESHOLD", "POST body is JSON with event DOWN_THRESHOLD");

  // Scenario 3: a fourth DOWN does NOT re-fire (idempotent once tripped).
  fired = await fireIfNeeded(
    [{ event: "DOWN", url: "https://api.example.com/data", ts, score: 40 }],
    state,
    config,
    {}
  );
  assert(fired.filter((p) => p.event === "DOWN_THRESHOLD").length === 0,
    "a further DOWN does not re-fire the already-fired threshold");

  // Scenario 4: recovery of a tripped URL fires one RECOVERY and resets the counter.
  fired = await fireIfNeeded(
    [{ event: "OK", url: "https://api.example.com/data", ts, score: 100, status: 200 }],
    state,
    config,
    {}
  );
  const rec = fired.filter((p) => p.event === "RECOVERY");
  assert(rec.length === 1, "recovery of a tripped URL fires one RECOVERY");
  assert(received.some((r) => r.body.event === "RECOVERY"), "RECOVERY reached the webhook");
  assert(state.per_url["https://api.example.com/data"].down === 0,
    "recovery resets consecutive-down to 0");

  // Scenario 5: a URL with enabled=false never fires even when it goes down repeatedly.
  fired = await fireIfNeeded(
    [
      { event: "DOWN", url: "https://unwatched.example.com", ts, score: 40 },
      { event: "DOWN", url: "https://unwatched.example.com", ts, score: 40 },
      { event: "DOWN", url: "https://unwatched.example.com", ts, score: 40 },
    ],
    { per_url: {} },
    config,
    {}
  );
  assert(fired.length === 0, "a disabled URL never fires a webhook");

  server.close();
  if (failures === 0) {
    console.log("test_oracle_webhook.js: ALL PASS");
    process.exit(0);
  } else {
    console.error(`test_oracle_webhook.js: ${failures} assertion(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
