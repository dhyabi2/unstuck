#!/usr/bin/env node
/**
 * Test the RETIRED on-ramp address endpoint (Block 191; supersedes Block 82 L57).
 *
 * Law L191: no endpoint of the network generates or returns a Nano seed. GET
 * /v1/onramp/address used to return {address, seed, index}; whoever generates a key
 * holds it, so that was server custody however briefly. It now answers 410 with no
 * key material and points at POST /v1/onramp/self {address}, and the on-ramp
 * document (GET /try-nano) no longer offers a server-generated seed.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

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


(async () => {
  await new Promise((r) => setTimeout(r, 300));

  try {
    const a1 = await req("GET", "/v1/onramp/address");
    let k1 = null;
    try { k1 = JSON.parse(a1.body); } catch (_) {}
    check("L191 retired endpoint answers 410", a1.status === 410, String(a1.status));
    check("L191 response carries no seed field", !!k1 && !("seed" in k1), a1.body.slice(0, 120));
    check("L191 response contains no 64-hex value", !/[0-9A-Fa-f]{64}/.test(a1.body));
    check("L191 response names POST /v1/onramp/self", a1.body.includes("/v1/onramp/self"));

    const doc = onramp.onrampDoc({ apiBase: "https://example.test/unstuck/api" });
    const text = JSON.stringify(doc);
    const step1 = doc.steps.find((s) => s.n === 1);
    check(
      "L191 the on-ramp's address step points at the self-custody endpoint",
      !!(step1 && step1.http_shortcut && step1.http_shortcut.includes("/v1/onramp/self")),
      step1 && step1.http_shortcut
    );
    check(
      "L191 the on-ramp document no longer offers a server-generated seed",
      !/GET [^ ]*\/v1\/onramp\/address returns/.test(text) && !/seed from GET \/v1\/onramp\/address/.test(text) && !/the on-ramp gave you/.test(text)
    );
  } finally {
    nw.s.closeDb();
    nw.server.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-wal"); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-shm"); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall on-ramp retirement laws pass");
  process.exit(failed ? 1 : 0);
})();
