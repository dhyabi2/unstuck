#!/usr/bin/env node
/**
 * Test GET /v1/verify-payment — the payee and the amount are part of "verified".
 *
 * Laws:
 *   V1 — verified is true only for a confirmed SEND whose destination (link_as_account)
 *        is the account asked about and whose amount is the amount asked about.
 *   V2 — the response keeps its old fields and adds destination, matchesDestination,
 *        matchesAmount.
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
      res.on("end", () => resolve(JSON.parse(data)));
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
    check("V2 matchesDestination true for the payee", right.matchesDestination === true, JSON.stringify(right));

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
    const rcv = await get(`/v1/verify-payment?block=${RECV}`);
    check("V1 a confirmed receive is NOT a payment", rcv.verified === false, JSON.stringify(rcv));

    const bare = await get(q(""));
    check("V1 no account/amount: a confirmed send still verifies", bare.verified === true, JSON.stringify(bare));
    check("V2 old fields kept (hash, account, amount, subtype, height, confirmed, matchesAccount)",
      bare.hash === HASH && bare.account === PAYER && bare.amount === AMOUNT && bare.subtype === "send" &&
      bare.height === "7" && bare.confirmed === true && typeof bare.matchesAccount === "boolean", JSON.stringify(bare));

    const emptyAcct = await get(q("&account="));
    check("V3 an empty account is refused, not ignored", emptyAcct.verified === false && /invalid account/.test(emptyAcct.error || ""), JSON.stringify(emptyAcct));
    const fromPayer = await get(q(`&account=${PAYER}`));
    check("V3 matchesAccount is false when account is only the sender",
      fromPayer.verified === false && fromPayer.matchesAccount === false, JSON.stringify(fromPayer));

    const missing = await get(`/v1/verify-payment?block=${"D".repeat(64)}`);
    check("V1 an unknown block is NOT verified", missing.verified === false, JSON.stringify(missing));
  } finally {
    nw.s.closeDb();
    nw.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { require("fs").unlinkSync(f); } catch (_) {} }
  }
  console.log(failed ? `\n${failed} test(s) failed` : "\nall verify-payment laws pass");
  process.exit(failed ? 1 : 0);
})();
