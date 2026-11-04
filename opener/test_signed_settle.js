#!/usr/bin/env node
/**
 * Signed accept, end to end over HTTP against the real nserver-persist.js (temp DB).
 *
 *   T1 in NETWORK_ACCEPT_MODE=signature, POST /ask mints no accept_token: none is returned and
 *      none is stored, so there is no bearer secret to leak from a log.
 *   T2 in "either" (the transition mode) a token is still minted for clients that do not sign yet.
 *   T3 signature settle is usable: GET /ask/:id/settle-message serves the exact bytes, the asker
 *      signs them, POST /ask/:id/settle with {signature} records the (verified) block.
 *   T4 a signature by another key over the same settle message is refused 403; nothing recorded.
 *   T5 a malformed paymentBlock sent with a signature is a 400 (bad request), not a 403.
 *   T6 the published endpoint listing no longer says accept_token is required to settle.
 *
 * The node is stubbed (network-settle.verifyBlockPayment); this file tests authority, not RPC.
 * Run: node opener/test_signed_settle.js
 */
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const tmpDb = path.join(os.tmpdir(), `test-signed-settle-${process.pid}-${Date.now()}.db`);
process.env.NW_DB_PATH = tmpDb;
process.env.NETWORK_ACCEPT_MODE = "signature";

const settle = require("./network-settle.js");
settle.verifyBlockPayment = async (hash) => ({ valid: true, evidence: { block: String(hash).toUpperCase() } });
const sig = require("./nano-sig.js");
const nw = require("./nserver-persist.js");

let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ": " + detail : ""}`); }
};
const keypair = () => { const secret = crypto.randomBytes(32); return { secret, address: sig.pubToAddress(sig.publicKey(secret)) }; };
const signHex = (key, msg) => sig.sign(Buffer.from(msg, "utf8"), key.secret).toString("hex");
const asker = keypair(), answerer = keypair(), other = keypair();

let port;
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: "/unstuck/api" + p, method, headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(data); } catch (_) {} resolve({ status: res.statusCode, json: j, text: data }); });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function paidAsk() {
  const c = await req("POST", "/ask", { asker: asker.address, title: "signed settle check", body: "how do I sign a settle", bounty_raw: "1000000000000000000000000" });
  const id = c.json && c.json.id;
  const a = await req("POST", `/ask/${id}/answers`, { answerer: answerer.address, body: "sign the served message" });
  const answerId = a.json && a.json.answerId;
  const m = await req("GET", `/ask/${id}/accept-message?answerId=${answerId}`);
  const acc = await req("POST", `/ask/${id}/accept`, { acceptedBy: asker.address, answerId, signature: signHex(asker, m.json.message) });
  return { create: c, id, answerId, accept: acc };
}

(async () => {
  await new Promise((r) => nw.server.listen(0, "127.0.0.1", r));
  port = nw.server.address().port;
  try {
    const one = await paidAsk();
    check("T1 POST /ask in signature mode answers 201", one.create.status === 201, one.create.text);
    check("T1 no accept_token is returned in signature mode", one.create.json && !("accept_token" in one.create.json), one.create.text);
    const stored = nw.s.getAsk(one.id);
    check("T1 no accept_token is stored in signature mode", stored && stored.acceptToken === null, String(stored && stored.acceptToken));
    check("T3 accept by the asker's signature answers 200", one.accept.status === 200, one.accept.text);

    const H = crypto.randomBytes(32).toString("hex").toUpperCase();
    const sm = await req("GET", `/ask/${one.id}/settle-message?paymentBlock=${H}`);
    check("T3 GET /ask/:id/settle-message serves the message to sign", sm.status === 200 && sm.json && typeof sm.json.message === "string", `${sm.status} ${sm.text}`);
    const msg = (sm.json && sm.json.message) || "";
    check("T3 the settle message labels the answer id as answer:", msg.includes(`\nanswer:${one.answerId}\n`) && !msg.includes("answerer:"), JSON.stringify(msg));

    const bad = await req("POST", `/ask/${one.id}/settle`, { paymentBlock: H, acceptedBy: asker.address, signature: signHex(other, msg) });
    check("T4 a settle signed by another key is refused 403", bad.status === 403, `${bad.status} ${bad.text}`);
    check("T4 nothing was recorded", nw.s.getAsk(one.id).settlementBlock === null);

    const malformed = await req("POST", `/ask/${one.id}/settle`, { paymentBlock: "not-a-hash", acceptedBy: asker.address, signature: signHex(asker, msg) });
    check("T5 a malformed paymentBlock with a signature is 400, not 403", malformed.status === 400, `${malformed.status} ${malformed.text}`);

    const ok = await req("POST", `/ask/${one.id}/settle`, { paymentBlock: H, acceptedBy: asker.address, signature: signHex(asker, msg) });
    check("T3 POST /ask/:id/settle with the asker's signature records the block", ok.status === 200 && ok.json && ok.json.settlementBlock === H, `${ok.status} ${ok.text}`);

    process.env.NETWORK_ACCEPT_MODE = "either";
    const c2 = await req("POST", "/ask", { asker: asker.address, title: "transition mode", body: "still minted", bounty_raw: "1" });
    check("T2 in either mode a token is still minted (transition)", c2.status === 201 && typeof (c2.json && c2.json.accept_token) === "string", c2.text);
    process.env.NETWORK_ACCEPT_MODE = "signature";

    const card = await req("GET", "/.well-known/agent.json");
    const eps = (card.json && card.json.endpoints) || [];
    const settleEp = eps.find((e) => e.path === "/ask/:id/settle");
    check("T6 the listing names settle-message", eps.some((e) => e.path === "/ask/:id/settle-message"), card.text.slice(0, 200));
    check("T6 the settle listing no longer says accept_token is required", settleEp && !/accept_token is required/.test(settleEp.description), settleEp && settleEp.description);
  } catch (e) {
    failed++;
    console.log(`FAIL threw: ${e.stack}`);
  } finally {
    try { nw.s.closeDb && nw.s.closeDb(); } catch (_) {}
    nw.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
  if (failed) { console.log(`${failed} failed`); process.exit(1); }
  console.log("all signed-settle laws hold");
})();
