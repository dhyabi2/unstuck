#!/usr/bin/env node
/**
 * Receive what has been sent to us. The other half of the money path, missing since the account was opened.
 *
 * Why it had to exist (owner, 2026-09-26, authorising it explicitly): the owner funded the treasury with 20 XNO and
 * the balance did not move, because a Nano send only creates a RECEIVABLE block — the recipient must sign a receive
 * to turn it into a balance. Thirteen blocks totalling 10.0016 XNO had been sitting that way, including the first
 * 0.0005 XNO an outside agent ever paid us. We publish "settlement is the receipt", and a receipt that never becomes
 * a balance is a fair thing to hold against us.
 *
 * Why this is the SAFEST money file in the project, and the reason it may exist at all beside `send.js`'s locked-down
 * amounts: a receive block has no recipient. Its only degrees of freedom are which source hash to claim and the new
 * balance, and both are checked by every node on the network. It cannot pay anybody. The worst a bug here can do is
 * build a block the network rejects — which costs nothing but the work. So unlike a send, there is no amount to
 * freeze and no floor to guard; there is only the invariant asserted below.
 *
 *   INVARIANT: the new balance is strictly GREATER than the old one, by exactly the amount of the claimed block.
 *              Anything else is refused before signing.
 *
 * It takes the sender's own lock, so it can never race a starter or a grant mid-frontier. The seed is read from the
 * wallet file and never printed, logged or passed as an argument — the same rule send.js follows.
 *
 * Usage:
 *   node receive.js --list              what is receivable, nothing signed
 *   node receive.js --dry-run --all     build and validate the first block, broadcast nothing
 *   node receive.js --all               receive everything receivable
 *   node receive.js --hash <BLOCK>      receive exactly one
 */

const fs = require("fs");
const nano = require("nanocurrency");
const led = require("./openings.js");

const RPC_URL = process.env.NANO_RPC_URL || "https://rpc.nano.to";
const RPC_KEY = process.env.NANO_RPC_KEY || "";
const WALLET = process.env.UNSTUCK_WALLET_FILE || "/root/.unstuck/wallet.json";
const LOCK = process.env.UNSTUCK_LOCK || "/root/.unstuck/sender.lock";

// A receive is cheaper to prove than a send: the network asks less work of it. Using the SEND threshold here would
// still be accepted, but would cost several times the CPU for nothing.
const RECEIVE_DIFFICULTY = "fffffe0000000000";
const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

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

/**
 * The one rule. Kept as a pure function so it can be tested without a chain, a key or a network — and so that the
 * thing being asserted is readable on its own, rather than buried in the middle of a signing routine.
 */
function nextBalance(balanceRaw, amountRaw) {
  const before = BigInt(balanceRaw);
  const amount = BigInt(amountRaw);
  if (amount <= 0n) throw new Error(`refused: a receive must claim a positive amount, got ${amountRaw}`);
  const after = before + amount;
  if (after <= before) throw new Error("refused: a receive must increase the balance");
  return after.toString();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const one = args.includes("--hash") ? args[args.indexOf("--hash") + 1] : null;
  if (!args.includes("--list") && !all && !one) {
    console.error("usage: receive.js --list | [--dry-run] --all | [--dry-run] --hash <BLOCK>");
    return 2;
  }

  const wallet = JSON.parse(fs.readFileSync(WALLET, "utf8"));
  const account = norm(wallet.address);

  const recv = await rpc({ action: "receivable", account, count: "500", threshold: "1", source: "true" });
  const blocks = recv.blocks && !Array.isArray(recv.blocks) ? recv.blocks : {};
  let items = Object.entries(blocks).map(([hash, v]) => ({
    hash, amount: typeof v === "string" ? v : v.amount, from: typeof v === "string" ? null : norm(v.source),
  }));
  // Smallest first. If anything goes wrong it goes wrong on the cheapest block, and the real money is claimed by a
  // path that has already succeeded — the same reason a deploy is smoke-tested before it is promoted.
  items.sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1));
  if (one) items = items.filter((i) => i.hash === one);

  const total = items.reduce((s, i) => s + BigInt(i.amount), 0n);
  if (args.includes("--list")) {
    console.log(JSON.stringify({
      account, receivable_blocks: items.length,
      receivable_raw: total.toString(), receivable_nano: Number(total) / 1e30,
      blocks: items.map((i) => ({ ...i, nano: Number(BigInt(i.amount)) / 1e30 })),
    }, null, 2));
    return 0;
  }
  if (!items.length) { console.log(JSON.stringify({ account, received: 0, note: "nothing receivable" })); return 0; }

  // The sender's own lock: a receive rewrites the frontier, so it must never run beside a starter or a grant.
  const l = led.lock(LOCK);
  if (!l.ok) { console.error(`another sender holds the lock (pid ${l.heldBy ?? "unknown"})`); return 1; }

  const done = [];
  try {
    for (const item of items) {
      // Re-read our state before EVERY block: each receive moves the frontier, and a stale frontier is the one way
      // this can fail repeatedly rather than once.
      const info = await rpc({ action: "account_info", account, representative: "true" })
        .catch((e) => (String(e.message).includes("Account not found") ? null : Promise.reject(e)));
      const previous = info ? info.frontier : ZERO;
      const balance = info ? info.balance : "0";
      const representative = info ? info.representative : account;
      const balanceAfter = nextBalance(balance, item.amount);

      // An unopened account's first block is hashed against its own public key, not against a frontier.
      const workHash = info ? previous : nano.derivePublicKey(account);
      const work = await rpc({ action: "work_generate", hash: workHash, difficulty: RECEIVE_DIFFICULTY }, 120000);
      if (!nano.validateWork({ blockHash: workHash, work: work.work, threshold: RECEIVE_DIFFICULTY })) {
        throw new Error("refused: work did not validate locally");
      }

      const { hash, block } = nano.createBlock(wallet.secretKey, {
        work: work.work, previous, representative, balance: balanceAfter, link: item.hash,
      });
      if (norm(block.account) !== account) throw new Error("signed for the wrong account");
      block.account = norm(block.account);
      if (block.link_as_account) block.link_as_account = norm(block.link_as_account);

      if (dryRun) {
        done.push({ dry_run: true, claimed: item.hash, nano: Number(BigInt(item.amount)) / 1e30,
                    balance_after: balanceAfter, block_hash_if_broadcast: hash, work_validated: true });
        // Only the first can be built honestly without broadcasting: every later block needs the frontier this one
        // would have created. Saying so beats printing a column of blocks built on a frontier that does not exist.
        if (items.length > 1) {
          done.push({ note: `${items.length - 1} more receivable; each needs the previous receive's frontier, ` +
            "so only the first can be built without broadcasting" });
        }
        break;
      }

      const processed = await rpc({ action: "process", json_block: "true", subtype: "receive", block });
      done.push({ received: processed.hash || hash, claimed: item.hash, from: item.from,
                  nano: Number(BigInt(item.amount)) / 1e30, balance_after_raw: balanceAfter });
    }
  } catch (e) {
    console.error(`failed after ${done.length} receive(s): ${e.message}`);
    console.log(JSON.stringify(done, null, 2));
    return 1;
  } finally {
    l.release && l.release();
  }

  const after = await rpc({ action: "account_info", account }).catch(() => null);
  console.log(JSON.stringify({
    account, receives: done.length, balance_nano: after ? Number(BigInt(after.balance)) / 1e30 : null, done,
  }, null, 2));
  return 0;
}

if (require.main === module) main().then((c) => process.exit(c)).catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { nextBalance, RECEIVE_DIFFICULTY };
