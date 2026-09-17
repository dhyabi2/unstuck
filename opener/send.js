#!/usr/bin/env node
/**
 * Send one starter — the only code in this project that moves money.
 *
 * Usage:
 *   node send.js <nano_address> [--found-via "where I found this agent"]
 *   node send.js --list
 *   node send.js --counts
 *
 * Order of operations, and the reason for it: reserve the address in the ledger, then sign, then broadcast, then
 * confirm. Everything that can refuse — a bad address, our own address, an address already opened, a balance that
 * cannot cover the starter, work that does not validate — refuses BEFORE anything leaves this machine. Once the
 * network has been asked, the outcome is either recorded as a block hash or recorded as unknown; it is never quietly
 * forgotten, because a forgotten send is how an agent gets paid twice.
 *
 * The seed is read from UNSTUCK_WALLET_FILE and never printed, logged or passed as an argument.
 */

const fs = require("fs");
const nano = require("nanocurrency");
const o = require("./opener.js");
const led = require("./openings.js");

const RPC_URL = process.env.NANO_RPC_URL || "https://rpc.nano.to";
const RPC_KEY = process.env.NANO_RPC_KEY || "";
const WALLET = process.env.UNSTUCK_WALLET_FILE || "/root/.unstuck/wallet.json";
const DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
const LOCK = process.env.UNSTUCK_LOCK || "/root/.unstuck/sender.lock";
const STARTER = process.env.UNSTUCK_STARTER_RAW || o.STARTER_RAW;
const SEND_DIFFICULTY = o.SEND_DIFFICULTY;

const norm = (a) => String(a).replace(/^xrb_/, "nano_");

async function rpc(body, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", ...(RPC_KEY ? { Authorization: RPC_KEY } : {}) },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC ${body.action}: ${json.error}`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const db = led.open(DB);

  if (args[0] === "--counts") { console.log(JSON.stringify(led.counts(db))); return 0; }
  // --list is every starter we broadcast (spending). --opened is only what we can prove we opened (adoption).
  if (args[0] === "--list") { console.log(JSON.stringify(led.startersSent(db), null, 2)); return 0; }
  if (args[0] === "--opened") { console.log(JSON.stringify(led.opened(db), null, 2)); return 0; }

  /**
   * Ask the chain what each starter actually did, and write the answer down.
   *
   * A send is not an opening: of the first 11 starters, none opened an account — six went to accounts someone else
   * had already opened, five to accounts still not open, and eight were never received. Nothing may be published as
   * an opening unless our own block is the account's open block, so this is the only thing that may set that flag.
   */
  if (args[0] === "--verify") {
    const rows = led.startersSent(db);
    let opened = 0, already = 0, notOpen = 0, unreceived = 0;
    for (const r of rows) {
      const info = await rpc({ action: "account_info", account: r.account }).catch((e) => ({ error: e.message }));
      const recv = await rpc({ action: "receivable", account: r.account, count: "100", threshold: "1" })
        .catch(() => ({ blocks: {} }));
      const pendingBlocks = recv.blocks && !Array.isArray(recv.blocks) ? Object.keys(recv.blocks) : [];
      const stillPending = pendingBlocks.includes(r.block);
      const exists = !info.error;
      const openedByUs = exists && info.open_block === r.block;
      led.recordChainCheck(db, r.account, { openedByUs, received: !stillPending });
      if (openedByUs) opened++; else if (exists) already++; else notOpen++;
      if (stillPending) unreceived++;
    }
    console.log(JSON.stringify({
      checked: rows.length, opened_by_us: opened, already_open_before_us: already,
      still_not_open: notOpen, our_send_unreceived: unreceived,
    }, null, 2));
    return 0;
  }

  const to = args[0];
  // --dry-run exercises everything except the broadcast: the live balance, the work, the signature and the guards.
  // It is how this path is proven without spending and without writing a fake opening into a public ledger.
  const dryRun = args.includes("--dry-run");
  const foundVia = args.includes("--found-via") ? args[args.indexOf("--found-via") + 1] : "unspecified";
  if (!to) { console.error("usage: send.js <nano_address> [--found-via \"...\"] | --list | --counts"); return 2; }

  const wallet = JSON.parse(fs.readFileSync(WALLET, "utf8"));

  // Everything knowable offline is decided before we touch the network or the ledger.
  const refusal = o.refusal(nano, to, { opened: [] }, wallet.address);
  if (refusal) { console.error(`refused: ${refusal}`); return 1; }

  const l = led.lock(LOCK);
  if (!l.ok) { console.error(`another sender holds the lock (pid ${l.heldBy ?? "unknown"})`); return 1; }

  let reserved = false;
  try {
    const r = led.reserve(db, to, { foundVia, amountRaw: STARTER });
    if (!r.ok) { console.error(`refused: ${r.reason}${r.block ? ` (block ${r.block})` : ""}`); return 1; }
    reserved = true;

    // Our own account state. A starter can only be sent from an account someone else has already opened.
    const info = await rpc({ action: "account_info", account: wallet.address, representative: "true" });
    const balanceAfter = o.nextBalance(info.balance, STARTER); // throws rather than overspending

    const work = await rpc({ action: "work_generate", hash: info.frontier, difficulty: SEND_DIFFICULTY }, 120000);
    // rpc.nano.to has historically served invalid nonces; a block with bad work is rejected after we have already
    // decided to send, so it is checked here, locally, while refusing is still free.
    if (!nano.validateWork({ blockHash: info.frontier, work: work.work, threshold: SEND_DIFFICULTY })) {
      led.release(db, to, "proof of work failed local validation; nothing was broadcast");
      reserved = false;
      console.error("refused: work did not validate locally");
      return 1;
    }

    const { hash, block } = nano.createBlock(wallet.secretKey, {
      work: work.work,
      previous: info.frontier,
      representative: info.representative,
      balance: balanceAfter,
      link: to,
    });
    // createBlock returns the legacy xrb_ prefix; normalise or a correct block looks like someone else's.
    if (norm(block.account) !== wallet.address) throw new Error("signed for the wrong account");
    block.account = norm(block.account);
    if (block.link_as_account) block.link_as_account = norm(block.link_as_account);

    if (dryRun) {
      led.release(db, to, "dry run: nothing was broadcast");
      reserved = false;
      console.log(JSON.stringify({
        dry_run: true, would_open: to, from: wallet.address, amount_raw: STARTER,
        balance_after: balanceAfter, block_hash_if_sent: hash, work_validated: true,
      }));
      return 0;
    }

    let processed;
    try {
      processed = await rpc({ action: "process", json_block: "true", subtype: "send", block });
    } catch (e) {
      // The network was asked and we did not learn the answer. This address is never a candidate again until a human
      // or a chain check resolves it: the alternative is paying the same agent twice.
      led.markUnknown(db, to, `process call failed: ${e.message}`);
      reserved = false;
      console.error(`UNKNOWN outcome for ${to}: ${e.message} — recorded, will not retry`);
      return 1;
    }

    led.confirm(db, to, processed.hash || hash);
    reserved = false;
    console.log(JSON.stringify({ opened: to, block: processed.hash || hash, amount_raw: STARTER, found_via: foundVia }));
    return 0;
  } catch (e) {
    if (reserved) led.release(db, to, `failed before broadcast: ${e.message}`);
    console.error(`failed: ${e.message}`);
    return 1;
  } finally {
    l.release && l.release();
  }
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
