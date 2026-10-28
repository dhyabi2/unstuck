#!/usr/bin/env node
/**
 * Test the keyless x402 facilitator for nano:mainnet (/v1/facilitator/*).
 *
 * Laws:
 *   F1 — supported advertises x402Version 2, scheme exact, network nano:mainnet.
 *   F2 — verify is valid only when BOTH public nodes read a confirmed send to payTo
 *        for exactly amount raw; any node error fails closed.
 *   F3 — settle re-verifies and binds a block hash exactly once.
 *
 * Method: https.request is stubbed per node host, so no live network is used.
 */

const http = require("http");
const https = require("https");
const { EventEmitter } = require("events");
const fs = require("fs");

const tmpDb = `/tmp/test-facilitator-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

const PAYER = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const PAYEE = "nano_1yo6c1t64ahfjdw1dxizmbbnpdmbrckwhw9phbg5pdkeubrizga4qhnjmnx7";
const OTHER = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";
const AMOUNT = "500000000000000000000000000";

const BLOCKS = {};
const NOW = () => String(Math.floor(Date.now() / 1000));
function sendBlock(hash, { confirmed = "true", subtype = "send", to = PAYEE, amount = AMOUNT, ts = NOW() } = {}) {
  BLOCKS[hash] = {
    block_account: PAYER, amount, balance: "1", height: "7", confirmed, subtype, local_timestamp: ts,
    contents: { type: "state", account: PAYER, link: "00".repeat(32), link_as_account: to },
  };
}
const DOWN = new Set(); // hosts that refuse the connection
const SEEN = new Set(); // hosts that were asked

https.request = function stubRequest(url, opts, cb) {
  const host = new URL(url).host;
  SEEN.add(host);
  const r = new EventEmitter();
  let body = "";
  r.write = (c) => { body += c; };
  r.destroy = () => {};
  r.end = () => setImmediate(() => {
    if (DOWN.has(host)) return r.emit("error", new Error("ECONNREFUSED"));
    const { hash } = JSON.parse(body);
    const res = new EventEmitter();
    cb(res);
    res.emit("data", JSON.stringify(BLOCKS[hash] || { error: "Block not found" }));
    res.emit("end");
  });
  return r;
};

const nw = require("./nserver-persist.js");
const PORT = 4315;
nw.server.listen(PORT);

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

function pay(blockHash, { payTo = PAYEE, amount = AMOUNT } = {}) {
  return {
    paymentPayload: { x402Version: 2, scheme: "exact", network: "nano:mainnet", payload: { blockHash } },
    paymentRequirements: { scheme: "exact", network: "nano:mainnet", payTo, amount, asset: "XNO" },
  };
}

(async () => {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const sup = await req("GET", "/v1/facilitator/supported");
    const k = sup.body.kinds && sup.body.kinds[0];
    check("F1 supported lists nano:mainnet exact v2",
      sup.status === 200 && k && k.x402Version === 2 && k.scheme === "exact" && k.network === "nano:mainnet",
      JSON.stringify(sup.body));

    const GOOD = "1".repeat(64);
    sendBlock(GOOD);
    const v = await req("POST", "/v1/facilitator/verify", pay(GOOD));
    check("F2 a confirmed send to payTo for amount is valid",
      v.body.isValid === true && v.body.payer === PAYER && !v.body.invalidReason, JSON.stringify(v.body));
    check("F2 both public nodes were read", SEEN.has("rpc.nano.to") && SEEN.has("rainstorm.city"), [...SEEN].join(","));

    const wp = await req("POST", "/v1/facilitator/verify", pay(GOOD, { payTo: OTHER }));
    check("F2 wrong payee is invalid", wp.body.isValid === false && wp.body.invalidReason === "destination_mismatch", JSON.stringify(wp.body));

    const wa = await req("POST", "/v1/facilitator/verify", pay(GOOD, { amount: "500000000000000000000000001" }));
    check("F2 wrong amount is invalid", wa.body.isValid === false && wa.body.invalidReason === "amount_mismatch", JSON.stringify(wa.body));

    const UNC = "2".repeat(64);
    sendBlock(UNC, { confirmed: "false" });
    const u = await req("POST", "/v1/facilitator/verify", pay(UNC));
    check("F2 unconfirmed is invalid", u.body.isValid === false && u.body.invalidReason === "block_unconfirmed", JSON.stringify(u.body));

    const RCV = "3".repeat(64);
    sendBlock(RCV, { subtype: "receive" });
    const rc = await req("POST", "/v1/facilitator/verify", pay(RCV));
    check("F2 a receive is invalid", rc.body.isValid === false && rc.body.invalidReason === "not_a_send", JSON.stringify(rc.body));

    DOWN.add("rainstorm.city");
    const d = await req("POST", "/v1/facilitator/verify", pay(GOOD));
    check("F2 one node down fails closed", d.body.isValid === false && d.body.invalidReason === "node_error", JSON.stringify(d.body));
    const ds = await req("POST", "/v1/facilitator/settle", pay(GOOD));
    check("F3 settle with one node down is refused", ds.body.success === false && ds.body.errorReason === "node_error", JSON.stringify(ds.body));
    DOWN.delete("rainstorm.city");

    const s1 = await req("POST", "/v1/facilitator/settle", pay(GOOD));
    check("F3 first settle succeeds",
      s1.body.success === true && s1.body.transaction === GOOD && s1.body.network === "nano:mainnet" && s1.body.payer === PAYER,
      JSON.stringify(s1.body));
    const s2 = await req("POST", "/v1/facilitator/settle", pay(GOOD.toLowerCase()));
    check("F3 second settle of the same block is refused",
      s2.body.success === false && s2.body.errorReason === "already_settled", JSON.stringify(s2.body));
    const v2 = await req("POST", "/v1/facilitator/verify", pay(GOOD));
    check("F3 a settled block no longer verifies", v2.body.isValid === false && v2.body.invalidReason === "already_settled", JSON.stringify(v2.body));

    const ws = await req("POST", "/v1/facilitator/settle", pay(UNC));
    check("F3 settle of an invalid block is refused", ws.body.success === false && ws.body.errorReason === "block_unconfirmed", JSON.stringify(ws.body));

    const OLD = "4".repeat(64);
    sendBlock(OLD, { ts: String(Math.floor(Date.now() / 1000) - 3600) });
    const o = await req("POST", "/v1/facilitator/settle", pay(OLD));
    check("F4 a send older than the window is refused", o.body.success === false && o.body.errorReason === "payment_expired", JSON.stringify(o.body));
    const NOTS = "5".repeat(64);
    sendBlock(NOTS, { ts: "0" });
    const nt = await req("POST", "/v1/facilitator/verify", pay(NOTS));
    check("F4 a send with no node timestamp is refused", nt.body.isValid === false && nt.body.invalidReason === "payment_expired", JSON.stringify(nt.body));
    const MID = "6".repeat(64);
    sendBlock(MID, { ts: String(Math.floor(Date.now() / 1000) - 120) });
    const mOk = await req("POST", "/v1/facilitator/verify", pay(MID));
    const narrow = pay(MID); narrow.paymentRequirements.maxTimeoutSeconds = 60;
    const mNo = await req("POST", "/v1/facilitator/verify", narrow);
    const wide = pay(OLD); wide.paymentRequirements.maxTimeoutSeconds = 86400;
    const oWide = await req("POST", "/v1/facilitator/verify", wide);
    check("F4 maxTimeoutSeconds narrows the window and never widens it",
      mOk.body.isValid === true && mNo.body.invalidReason === "payment_expired" && oWide.body.invalidReason === "payment_expired",
      JSON.stringify([mOk.body, mNo.body, oWide.body]));
    const numAmt = pay(MID); numAmt.paymentRequirements.amount = 1;
    const na = await req("POST", "/v1/facilitator/verify", numAmt);
    check("F4 a JSON-number amount is refused", na.body.isValid === false && na.body.invalidReason === "invalid_payment_requirements", JSON.stringify(na.body));

    const bad = await req("POST", "/v1/facilitator/verify", pay("zz"));
    check("F2 malformed blockHash is invalid", bad.body.isValid === false && bad.body.invalidReason === "invalid_payload", JSON.stringify(bad.body));
    const net = await req("POST", "/v1/facilitator/verify",
      { ...pay(GOOD), paymentRequirements: { ...pay(GOOD).paymentRequirements, network: "eip155:8453" } });
    check("F2 another network is invalid", net.body.isValid === false && net.body.invalidReason === "unsupported_network", JSON.stringify(net.body));
  } finally {
    nw.s.closeDb();
    nw.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
  console.log(failed ? `\n${failed} test(s) failed` : "\nall facilitator laws pass");
  process.exit(failed ? 1 : 0);
})();
