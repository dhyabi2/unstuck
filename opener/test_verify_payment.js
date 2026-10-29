#!/usr/bin/env node
/**
 * Test GET /v1/verify-payment — the payee and the amount are part of "verified".
 *
 * Laws:
 *   V1 — verified is true only for a confirmed SEND whose destination (link_as_account)
 *        is the account asked about and whose amount is the amount asked about.
 *   V2 — the response keeps its old fields (matchesAccount with its OLD meaning: account is
 *        the block's own account) and adds destination, matchesPayee (alias
 *        matchesDestination), matchesAmount, confirmedSend.
 *   V3 — an empty/malformed account or a non-integer amount is a 400.
 *   V4 — without account, verified is false (confirmedSend still reports the block).
 *   V5 — a node answering null or a non-JSON body fails closed; the server stays up.
 *
 * Method: the node RPC is stubbed (https.request is replaced), so no live network is used.
 * The canned block mirrors a real confirmed 0.0005 XNO send to the treasury.
 */

const http = require("http");
const https = require("https");
const { EventEmitter } = require("events");

const tmpDb = `/tmp/test-verify-payment-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

const HASH = "B749B757EE750FC9AEA72F33CB429EACCD2ABEC9F2CCF59BF17AFAC304C9A58F";
const PAYER = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const PAYEE = "nano_1yo6c1t64ahfjdw1dxizmbbnpdmbrckwhw9phbg5pdkeubrizga4qhnjmnx7";
const OTHER = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";
const AMOUNT = "500000000000000000000000000"; // 0.0005 XNO in raw

// The stubbed node answers: hash -> block_info body (or an Error to simulate a dead node).
const BLOCKS = {};
const RAW = {}; // hash -> a verbatim body the node answers instead of block_info
function sendBlock(hash, { confirmed = "true", subtype = "send", to = PAYEE, amount = AMOUNT } = {}) {
  BLOCKS[hash] = {
    block_account: PAYER, amount, balance: "1", height: "7", local_timestamp: "0",
    confirmed, subtype,
    contents: {
      type: "state", account: PAYER, previous: "0".repeat(64), representative: PAYER, balance: "1",
      link: "7AA4502C41226FC6B9C07F5B8BF1A49A61BB4DE37C39B8F3B8F86A4B26E3DFC5",
      link_as_account: to, signature: "0".repeat(128), work: "0".repeat(16),
    },
  };
}
sendBlock(HASH);

https.request = function stubRequest(url, opts, cb) {
  const r = new EventEmitter();
  let body = "";
  r.write = (c) => { body += c; };
  r.end = () => setImmediate(() => {
    const { hash } = JSON.parse(body);
    const res = new EventEmitter();
    cb(res);
    if (RAW[hash] !== undefined) { res.emit("data", RAW[hash]); return res.emit("end"); }
    const out = BLOCKS[hash] || { error: "Block not found" };
    res.emit("data", JSON.stringify(out));
    res.emit("end");
  });
  return r;
};

const nw = require("./nserver-persist.js");
const PORT = 4314;
nw.server.listen(PORT);

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "localhost", port: PORT, path }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { const j = JSON.parse(data); Object.defineProperty(j, "status", { value: res.statusCode }); resolve(j); });
    }).on("error", reject);
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const q = (extra) => `/v1/verify-payment?block=${HASH}${extra}`;

    const wrong = await get(q(`&account=${OTHER}`));
    check("V1 a send to someone else is NOT verified for that account", wrong.verified === false, JSON.stringify(wrong));
    check("V2 matchesDestination false for the wrong account", wrong.matchesDestination === false, JSON.stringify(wrong));

    const right = await get(q(`&account=${PAYEE}`));
    check("V1 a confirmed send to the payee is verified", right.verified === true, JSON.stringify(right));
    check("V2 destination is link_as_account", right.destination === PAYEE, JSON.stringify(right));
    check("V2 matchesPayee (and its alias matchesDestination) true for the payee",
      right.matchesPayee === true && right.matchesDestination === true, JSON.stringify(right));
    check("V2 matchesAccount keeps its old meaning: false when account is only the payee",
      right.matchesAccount === false, JSON.stringify(right));

    const okAmt = await get(q(`&account=${PAYEE}&amount=${AMOUNT}`));
    check("V1 exact amount verifies", okAmt.verified === true && okAmt.matchesAmount === true, JSON.stringify(okAmt));

    const badAmt = await get(q(`&account=${PAYEE}&amount=1000000000000000000000000000`));
    check("V1 a different amount is NOT verified", badAmt.verified === false && badAmt.matchesAmount === false, JSON.stringify(badAmt));

    const UNCONF = "A".repeat(64);
    sendBlock(UNCONF, { confirmed: "false" });
    const unc = await get(`/v1/verify-payment?block=${UNCONF}&account=${PAYEE}`);
    check("V1 an unconfirmed send is NOT verified", unc.verified === false, JSON.stringify(unc));

    const RECV = "C".repeat(64);
    sendBlock(RECV, { subtype: "receive" });
    const rcv = await get(`/v1/verify-payment?block=${RECV}&account=${PAYEE}`);
    check("V1 a confirmed receive is NOT a payment", rcv.verified === false, JSON.stringify(rcv));

    const bare = await get(q(""));
    check("V4 no account: verified is false, confirmedSend still true",
      bare.verified === false && bare.confirmedSend === true && bare.matchesPayee === false && /account/.test(bare.note || ""),
      JSON.stringify(bare));
    const amtOnly = await get(q(`&amount=${AMOUNT}`));
    check("V4 amount without account is not verified", amtOnly.verified === false && amtOnly.matchesAmount === true, JSON.stringify(amtOnly));
    check("V2 old fields kept (hash, account, amount, subtype, height, confirmed, matchesAccount)",
      bare.hash === HASH && bare.account === PAYER && bare.amount === AMOUNT && bare.subtype === "send" &&
      bare.height === "7" && bare.confirmed === true && typeof bare.matchesAccount === "boolean", JSON.stringify(bare));

    const emptyAcct = await get(q("&account="));
    check("V3 an empty account is refused, not ignored", emptyAcct.verified === false && /invalid account/.test(emptyAcct.error || ""), JSON.stringify(emptyAcct));
    const fromPayer = await get(q(`&account=${PAYER}`));
    check("V3 account = the sender: not verified, matchesPayee false, matchesAccount true (old meaning)",
      fromPayer.verified === false && fromPayer.matchesPayee === false && fromPayer.matchesAccount === true,
      JSON.stringify(fromPayer));
    const bad400 = [];
    for (const extra of ["&account=nano_123", `&account=${PAYEE}x`, `&account=${PAYEE}&amount=`,
      `&account=${PAYEE}&amount=1.5`, `&account=${PAYEE}&amount=-1`, `&account=${PAYEE}&amount=1e27`]) {
      const r = await get(q(extra));
      bad400.push([r.status, r.verified]);
    }
    check("V3 a malformed account or a non-integer amount is a 400",
      bad400.every(([st, v]) => st === 400 && v === false), JSON.stringify(bad400));
    check("V3 an empty account is a 400", emptyAcct.status === 400, String(emptyAcct.status));

    const v5 = [];
    for (const [i, body] of ["null", "not json at all", "7", "[]"].entries()) {
      const h = String(i).repeat(64);
      RAW[h] = body;
      v5.push(await get(`/v1/verify-payment?block=${h}&account=${PAYEE}`));
    }
    const stillUp = await get(q(`&account=${PAYEE}`));
    check("V5 a null/non-JSON/non-object node reply fails closed and the server stays up",
      v5.every((r) => r.verified === false && typeof r.error === "string") && stillUp.verified === true,
      JSON.stringify(v5));

    const missing = await get(`/v1/verify-payment?block=${"D".repeat(64)}&account=${PAYEE}`);
    check("V1 an unknown block is NOT verified", missing.verified === false, JSON.stringify(missing));
  } finally {
    nw.s.closeDb();
    nw.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { require("fs").unlinkSync(f); } catch (_) {} }
  }
  console.log(failed ? `\n${failed} test(s) failed` : "\nall verify-payment laws pass");
  process.exit(failed ? 1 : 0);
})();
