#!/usr/bin/env node
/**
 * An ask whose asker can never sign is refused at creation, not stranded later.
 *
 *   A1 in "either" (default) and "signature" mode, createAsk refuses an asker address whose
 *      checksum is broken (a typo) and the burn address (all-zero, small-order key).
 *   A2 in "token" (legacy) mode the token is the authority, so such an asker is still taken.
 *   A3 POST /ask on nserver-persist.js and on nserver.js answers 400 with the reason; a valid
 *      address is still 201.
 *   A4 POST /v1/onramp/self refuses a typo'd checksum and the burn address with 400; a valid
 *      address is still 201.
 *
 * Run: node opener/test_signed_asker.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tmpDb = path.join(os.tmpdir(), `test-signed-asker-${process.pid}-${Date.now()}.db`);
process.env.NW_DB_PATH = tmpDb;
process.env.NETWORK_DB = tmpDb;
delete process.env.NETWORK_ACCEPT_MODE;

const sig = require("./nano-sig.js");
const n = require("./network.js");
const persist = require("./nserver-persist.js");
const mem = require("./nserver.js");

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ": " + detail : ""}`); }
};

const GOOD = sig.pubToAddress(sig.publicKey(crypto.randomBytes(32)));
// Same address, last checksum character changed: shape is fine, checksum is not.
const TYPO = GOOD.slice(0, -1) + (GOOD.slice(-1) === "1" ? "3" : "1");
const BURN = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";

const ask = (asker) => ({ asker, title: "stuck on RPC", body: "block_info hangs", bountyRaw: "1000" });
const refused = (asker) => { try { n.createAsk(ask(asker)); return null; } catch (e) { return e.message; } };

function withMode(mode, fn) {
  const prev = process.env.NETWORK_ACCEPT_MODE;
  if (mode === undefined) delete process.env.NETWORK_ACCEPT_MODE; else process.env.NETWORK_ACCEPT_MODE = mode;
  try { fn(); } finally { if (prev === undefined) delete process.env.NETWORK_ACCEPT_MODE; else process.env.NETWORK_ACCEPT_MODE = prev; }
}

function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: "127.0.0.1", port, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (_) {} resolve({ status: res.statusCode, body: j }); });
    });
    r.on("error", reject); r.write(data); r.end();
  });
}
const listen = (server) => new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server.address().port)));

(async () => {
  try {
    check("fixture: GOOD is a valid address, TYPO only differs in its checksum",
      sig.checkAddress(GOOD).ok && !sig.checkAddress(TYPO).ok && sig.checkAddress(BURN).ok);

    for (const mode of [undefined, "either", "signature"]) {
      withMode(mode, () => {
        const label = mode || "default";
        check(`A1 [${label}] a valid asker still creates an ask`, refused(GOOD) === null, refused(GOOD));
        const t = refused(TYPO);
        check(`A1 [${label}] a typo'd checksum asker is refused`, t && /checksum/.test(t), String(t));
        const b = refused(BURN);
        check(`A1 [${label}] the burn (small-order key) asker is refused`, b && /signing key|small-order/.test(b), String(b));
      });
    }
    withMode("token", () => {
      check("A2 [token] legacy mode still takes a typo'd checksum asker", refused(TYPO) === null, refused(TYPO));
      check("A2 [token] legacy mode still takes the burn asker", refused(BURN) === null, refused(BURN));
    });

    const pp = await listen(persist.server);
    const mp = await listen(mem.server);
    for (const [label, port] of [["nserver-persist", pp], ["nserver", mp]]) {
      const g = await post(port, "/ask", ask(GOOD));
      check(`A3 [${label}] POST /ask with a valid asker is 201`, g.status === 201, JSON.stringify(g));
      const t = await post(port, "/ask", ask(TYPO));
      check(`A3 [${label}] POST /ask with a typo'd checksum asker is 400 naming the checksum`,
        t.status === 400 && /checksum/.test(t.body && t.body.error), JSON.stringify(t));
      const b = await post(port, "/ask", ask(BURN));
      check(`A3 [${label}] POST /ask with the burn asker is 400`, b.status === 400, JSON.stringify(b));
    }

    const sg = await post(pp, "/v1/onramp/self", { address: sig.pubToAddress(sig.publicKey(crypto.randomBytes(32))) });
    check("A4 POST /v1/onramp/self with a valid address is 201", sg.status === 201, JSON.stringify(sg));
    const st = await post(pp, "/v1/onramp/self", { address: TYPO });
    check("A4 POST /v1/onramp/self with a typo'd checksum is 400 naming the checksum",
      st.status === 400 && /checksum/.test(st.body && st.body.error), JSON.stringify(st));
    const sb = await post(pp, "/v1/onramp/self", { address: BURN });
    check("A4 POST /v1/onramp/self with the burn address is 400", sb.status === 400, JSON.stringify(sb));
  } catch (e) {
    failed++; console.log(`FAIL unexpected: ${e.stack}`);
  } finally {
    persist.server.close(); mem.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
  if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
  console.log("all signed-asker laws hold");
  process.exit(0);
})();
