#!/usr/bin/env node
// Oracle for L1 (block 4): the ledger + on-chain state must agree that every
// recorded opening is a real send of exactly the starter from the treasury.
// Exercises the PRODUCTION ledger code (openings.js, which send.js also uses)
// and hard-codes the TRUE starter so a mutant that changes STARTER_RAW / the
// count logic / reserve-confirm flow is caught.
const https = require("https");
const DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
const led = require("./openings.js");
const TREASURY = "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";
// TRUE starter, independent of any code constant: 0.00001 XNO in raw.
const TRUE_STARTER_RAW = 10000000000000000000000n;
const TRUE_START_BALANCE = 10000000000000000000000000000000n; // 10 XNO raw

function rpc(body) {
  return new Promise((resolve, reject) => {
    const req = https.request("https://rpc.nano.to", { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      let d = ""; res.on("data", (c) => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body)); req.end();
  });
}

(async () => {
  const db = led.open(DB);
  const counts = led.counts(db);
  const n = counts.sent || 0;
  // Every sent row must be a distinct real opening: verify a couple of recorded
  // block hashes are confirmed on-chain as sends of the starter.
  const opened = led.opened(db);
  const samples = opened.slice(0, 3);
  for (const row of samples) {
    if (!row || !row.block) { console.error("opened row missing block:", row); process.exit(1); }
    const info = await rpc({ action: "block_info", json_block: "true", hash: row.block });
    if (!info || info.confirmed !== "true" || info.subtype !== "send" || String(info.amount) !== String(TRUE_STARTER_RAW)) {
      console.error("block not a confirmed starter send:", row.block, JSON.stringify(info));
      process.exit(1);
    }
  }
  // Treasury on-chain balance must equal true start minus n starters.
  const tinfo = await rpc({ action: "account_info", account: TREASURY });
  if (!tinfo || !tinfo.balance) { console.error("no treasury balance", tinfo); process.exit(1); }
  const expected = TRUE_START_BALANCE - TRUE_STARTER_RAW * BigInt(n);
  if (BigInt(tinfo.balance) !== expected) {
    console.error(`treasury ${tinfo.balance} != expected ${expected} (${n} sends)`);
    process.exit(1);
  }
  console.log(`OK: ${n} sent; ${samples.length} blocks confirmed as starter sends; treasury ${tinfo.balance} == 10 XNO - ${n}*starter`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
