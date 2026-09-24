#!/usr/bin/env node
/**
 * Test the persistent bridge: loads the module, starts the server on a
 * test port, and verifies key endpoints.
 */
const http = require("http");
const path = require("path");
const fs = require("fs");

// Use a test DB in /tmp so it doesn't pollute the real one
const TEST_DB = `/tmp/bridge-test-${Date.now()}.db`;
process.env.BRIDGE_DB_PATH = TEST_DB;
process.env.BRIDGE_PORT = "3403";
process.env.BRIDGE_NANO_ADDRESS = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
process.env.BRIDGE_USD_PER_XNO = "0.7";

const bridge = require("./nano-bridge-persist.js");
const PORT = parseInt(process.env.BRIDGE_PORT, 10);

let failed = 0;
function ok(name) { console.log(`ok   ${name}`); }
function fail(name, detail) { failed++; console.log(`FAIL ${name} ${detail}`); }

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    r.on("error", reject);
    if (body) r.write(typeof body === "string" ? body : JSON.stringify(body));
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Start the bridge server
  const { server } = bridge;
  server.listen(PORT);
  await sleep(500);

  try {
    // B5 basic: /health returns ok
    const h = await req("GET", "/health");
    ok("/health status 200") || h.status === 200 ? ok("/health 200") : fail("/health", `got ${h.status}`);
    const hb = JSON.parse(h.body);
    ok("health has nano_address") || (hb.nano_address ? ok("/health has address") : fail("/health", "no address"));

    // /status returns payment count
    const s = await req("GET", "/status");
    ok("/status 200") || s.status === 200 ? ok("/status 200") : fail("/status", `got ${s.status}`);
    const sb = JSON.parse(s.body);
    ok("payments_received is 0 initially") || sb.payments_received === 0 ? ok("zero payments initially") : fail("payments", sb.payments_received);

    // /proxy with non-x402 target passes through
    const p = await req("GET", "/proxy?target=http%3A%2F%2Flocalhost%3A3403%2Fhealth");
    ok("/proxy pass-through 200") || p.status === 200 ? ok("/proxy pass-through ok") : fail("/proxy", `got ${p.status}`);

    // /payments returns empty array
    const pm = await req("GET", "/payments");
    const pmb = JSON.parse(pm.body);
    ok("payments array") || Array.isArray(pmb) ? ok("/payments is array") : fail("/payments", typeof pmb);

    // /try-nano returns HTML
    const tn = await req("GET", "/try-nano");
    ok("/try-nano HTML") || (tn.status === 200 && tn.headers["content-type"] && tn.headers["content-type"].includes("html"))
      ? ok("/try-nano serves HTML") : fail("/try-nano", `got ${tn.status} ${tn.headers["content-type"]}`);

    // B5: SQLite DB was created
    ok("B5: SQLite DB exists") || fs.existsSync(TEST_DB) ? ok("B5: DB file created") : fail("B5: no DB");
    const db = bridge.getDb();
    const row = db.prepare("SELECT COUNT(*) as cnt FROM payments").get();
    ok("B5: payments table exists") || (row && row.cnt === 0) ? ok("B5: empty payments table") : fail("B5: table", JSON.stringify(row));

    // Bad /proxy (no target)
    const noTarget = await req("GET", "/proxy");
    ok("no-target 400") || noTarget.status === 400 ? ok("/proxy no target returns 400") : fail("/proxy no target", noTarget.status);

    // Bad /verify-payment (no body)
    const noBody = await req("POST", "/verify-payment", "{}");
    ok("verify no hash 400") || noBody.status === 400 ? ok("/verify no hash 400") : fail("/verify no hash", noBody.status);

    // 404 on unknown path
    const nf = await req("GET", "/does-not-exist");
    ok("404 on unknown") || nf.status === 404 ? ok("/does-not-exist 404") : fail("unknown path", nf.status);

  } finally {
    server.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  }

  console.log(failed ? `\n${failed} bridge-persist test(s) failed` : "\nall bridge-persist tests pass");
  process.exit(failed ? 1 : 0);
})();