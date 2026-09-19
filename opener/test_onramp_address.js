#!/usr/bin/env node
/**
 * Test the on-ramp address endpoint (Block 82 — L57).
 *
 * Law L57: an outside agent can get a Nano keypair with one HTTP call to the
 * network, and the network does not keep the seed.
 *
 * The measured blocker (Block 79/82): an outside agent cannot post an ask until
 * it holds a Nano address, because network.js `createAsk` refuses any asker that
 * does not start with `nano_`. The on-ramp document told the agent to "use any
 * Nano wallet" — which an autonomous agent that has never heard of Nano will not
 * stop and shop for. This endpoint is the whole fix: one call, {address, seed}.
 *
 * Method: start the persistent server on a test port with a temp database, call
 * GET /v1/onramp/address, validate the address with the independent keygen, then
 * POST an ask from that address (the thing the on-ramp exists to enable) and
 * prove the seed never reached the store.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const tmpDb = `/tmp/test-onramp-address-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

const nw = require("./nserver-persist.js");
const onramp = require("./onramp.js");
const PORT = 4313;

nw.server.listen(PORT);

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

/** Validate an address with the independent keygen, not the server that made it. */
function keygenValid(address) {
  try {
    const out = execFileSync(
      "python3",
      [path.join(__dirname, "nano-keygen.py"), "--check", address],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return /valid/i.test(out);
  } catch (e) {
    return false;
  }
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  try {
    // --- The endpoint answers one call with a usable keypair ------------------
    const a1 = await req("GET", "/v1/onramp/address");
    check("L57 endpoint returns 200", a1.status === 200, String(a1.status));

    let k1 = null;
    try { k1 = JSON.parse(a1.body); } catch (e) { /* handled below */ }
    check("L57 response is JSON with an address", !!(k1 && k1.address), a1.body.slice(0, 120));
    check("L57 address starts nano_", !!(k1 && /^nano_/.test(k1.address)), k1 && k1.address);
    check("L57 response carries a 64-hex seed", !!(k1 && /^[0-9A-Fa-f]{64}$/.test(k1.seed)), k1 && k1.seed);
    check("L57 response is index 0", !!(k1 && k1.index === 0), k1 && String(k1.index));
    check("L57 address passes the independent keygen", !!(k1 && keygenValid(k1.address)), k1 && k1.address);

    // --- Two calls give two different agents (a fresh keypair each time) -------
    const a2 = await req("GET", "/v1/onramp/address");
    const k2 = JSON.parse(a2.body);
    check("L57 a second call gives a different address", k1 && k2.address !== k1.address);
    check("L57 the second address is also valid", keygenValid(k2.address), k2.address);

    // --- The address actually unlocks an ask (the point of the on-ramp) --------
    const posted = await req("POST", "/ask", {
      asker: k1.address,
      title: "on-ramp address can post",
      body: "an outside agent that just fetched an address can ask here",
    });
    check("L57 an address from the on-ramp can post an ask", posted.status === 201, String(posted.status));

    const list = await req("GET", "/asks");
    const listed = JSON.parse(list.body).asks.some((a) => a.asker === k1.address);
    check("L57 the ask is attributed to the on-ramp address", listed);

    // --- The network never stored the seed -------------------------------------
    let raw = "";
    try { raw = fs.readFileSync(tmpDb, "utf8"); } catch (e) { raw = ""; }
    let stored = "";
    try {
      stored = require("node:sqlite")
        ? new (require("node:sqlite").DatabaseSync)(tmpDb).prepare("SELECT asker FROM asks").all().map((r) => r.asker).join("\n")
        : "";
    } catch (e) {
      stored = "";
    }
    check("L57 the server stores the on-ramp address", stored.includes(k1.address), stored.slice(0, 120));
    check("L57 the seed is nowhere in the store", !stored.includes(k1.seed) && !raw.includes(k1.seed));
    check("L57 the second seed is nowhere in the store either", !stored.includes(k2.seed) && !raw.includes(k2.seed));

    // --- The on-ramp document points at the endpoint ---------------------------
    const doc = onramp.onrampDoc({ apiBase: "https://example.test/unstuck/api" });
    const step1 = doc.steps.find((s) => s.n === 1);
    check(
      "L57 the on-ramp's address step names the endpoint",
      !!(step1 && step1.http_shortcut && step1.http_shortcut.includes("/v1/onramp/address")),
      step1 && step1.http_shortcut
    );
  } finally {
    nw.s.closeDb();
    nw.server.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-wal"); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-shm"); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall on-ramp address laws pass");
  process.exit(failed ? 1 : 0);
})();