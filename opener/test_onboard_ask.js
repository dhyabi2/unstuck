#!/usr/bin/env node
/**
 * test_onboard_ask.js — Block 108, grounds law L63.
 *
 * Law: An agent with no Nano address can post an ask: it generates its own address,
 * the network records it with an onboard id, and stores that nano_ address as the asker.
 *
 * The fix this proves: POST /ask used to require an asker that already started with
 * "nano_", so an outside agent on USDC/card/credits — the whole target of the
 * conversion plan — could not post the first ask that would bring it in. Now the
 * agent registers its own address (POST /v1/onramp/self) for an onboard_id, and
 * POST /ask accepts the onboard_id. The server makes no keys.
 *
 * Runs a real server on a scratch port and a scratch DB, and makes real HTTP calls.
 * Exit 0 = pass, non-zero = number of failures.
 */
"use strict";

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 4397;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unstuck-onboard-"));
const DB = path.join(TMP, "network.db");

let failures = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ok  ${msg}`); }
  else { console.log(`FAIL  ${msg}`); failures++; }
}

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request(BASE + urlPath, {
      method,
      headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {},
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function waitHealth(tries = 50) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http.get(BASE + "/health", (res) => {
        res.resume();
        resolve();
      }).on("error", () => (n <= 0 ? reject(new Error("server never came up")) : setTimeout(() => tick(n - 1), 100)));
    };
    tick(tries);
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, "nserver-persist.js")], {
    env: { ...process.env, NW_PORT: String(PORT), NW_DB_PATH: DB },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));

  try {
    await waitHealth();

    // 1. An agent that already holds a Nano address still posts directly.
    const direct = await req("POST", "/ask", {
      asker: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
      title: "direct asker still works",
      body: "this address already holds Nano",
    });
    ok(direct.status === 201, `direct nano_ asker posts an ask (got ${direct.status})`);

    // 2. An agent with NO Nano address generates its own (the server makes no keys:
    //    GET /v1/onramp/address is retired and answers 410), then registers only
    //    the address with POST /v1/onramp/self.
    const gone = await req("GET", "/v1/onramp/address");
    ok(gone.status === 410, `the retired server keygen answers 410 (got ${gone.status})`);
    const own = JSON.parse(require("child_process").execFileSync("python3", [path.join(__dirname, "nano-keygen.py")], { encoding: "utf8" }));
    const onramp = await req("POST", "/v1/onramp/self", { address: own.address });
    ok(onramp.status === 201, `on-ramp registers the agent's own address (got ${onramp.status})`);
    ok(onramp.body.address === own.address, "on-ramp echoes the agent's own nano_ address");
    ok(!("seed" in onramp.body), "on-ramp returns no seed");
    ok(Number.isInteger(onramp.body.onboard_id), `on-ramp returns an onboard_id (got ${onramp.body.onboard_id})`);

    const address = own.address;
    const onboardId = onramp.body.onboard_id;

    // 3. That agent posts its first ask using only the onboard_id.
    const viaOnboard = await req("POST", "/ask", {
      onboard_id: onboardId,
      title: "first ask from an agent with no wallet",
      body: "I have never held Nano. I generated my own address and posted this with the onboard_id the on-ramp gave me.",
    });
    ok(viaOnboard.status === 201, `ask with onboard_id is accepted (got ${viaOnboard.status})`);

    // 4. The stored asker is the agent's own nano_ address.
    if (viaOnboard.status === 201 && viaOnboard.body.id) {
      const got = await req("GET", `/ask/${viaOnboard.body.id}`);
      ok(got.status === 200 && got.body.ask && got.body.ask.asker === address,
        `stored asker is the on-ramp address (want ${address.slice(0, 12)}…, got ${got.body && got.body.ask && got.body.ask.asker && got.body.ask.asker.slice(0, 12)}…)`);
    } else {
      ok(false, "could not read back the onboard ask");
    }

    // 5. An asker that is not a Nano address is still refused.
    const bogus = await req("POST", "/ask", {
      asker: "csv-helper-research",
      title: "no wallet, no address, no onboard",
      body: "this should be refused",
    });
    ok(bogus.status === 400, `an ask with no Nano asker is refused (got ${bogus.status})`);

    // 6. An onboard_id that does not exist is refused, not silently accepted.
    const badId = await req("POST", "/ask", {
      onboard_id: 999999,
      title: "made up onboard id",
      body: "this should be refused",
    });
    ok(badId.status === 400, `an unknown onboard_id is refused (got ${badId.status})`);
  } finally {
    server.kill("SIGKILL");
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nPASS test_onboard_ask.js" : `\n${failures} FAILURE(S) in test_onboard_ask.js`);
  process.exit(failures);
}

main().catch((e) => { console.error(e); process.exit(99); });
