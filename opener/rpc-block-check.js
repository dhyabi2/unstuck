#!/usr/bin/env node
/**
 * rpc-block-check.js — the authoritative chain probe: does this block hash really exist?
 *
 * Why a second prober exists (measured 2026-09-20): rpc.nano.to answers HTTP 403 to python-urllib for
 * every request, including a plain `block_info`, while answering the same call fine from a JS fetch
 * client. A probe that reports a 403 as "no block" would call a real block fake; this one records
 * UNQUERIED and never guesses.
 *
 * Usage:
 *   node opener/rpc-block-check.js <hash> [<hash> ...]
 *   node opener/rpc-block-check.js --json <hash>
 *
 * The node key is read from /root/.hermes/.env (NANO_RPC_KEY) and placed only in the Authorization
 * header. It is never printed.
 */
"use strict";

const fs = require("fs");
const RPC = process.env.NANO_RPC_URL || "https://rpc.nano.to";
const ENV = process.env.NANO_ENV_FILE || "/root/.hermes/.env";

function nodeKey() {
  if (process.env.NANO_RPC_KEY) return process.env.NANO_RPC_KEY;
  try {
    for (const line of fs.readFileSync(ENV, "utf8").split("\n")) {
      if (line.startsWith("NANO_RPC_KEY=")) {
        const v = line.split("=").slice(1).join("=").trim();
        if (v) return v;
      }
    }
  } catch (_) { /* no env file: probe unauthenticated, still a real answer */ }
  return "";
}

async function blockInfo(hash, key) {
  const body = JSON.stringify({ action: "block_info", hash, json_block: "true" });
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = key;
  try {
    const res = await fetch(RPC, { method: "POST", headers, body });
    const txt = await res.text();
    let d;
    try { d = JSON.parse(txt); } catch (_) { return { hash, queried: false, error: `non-JSON (${res.status})` }; }
    if (d.error) return { hash, queried: true, exists: false, error: d.error };
    return { hash, queried: true, exists: true, subtype: d.subtype, confirmed: d.confirmed, amount: d.amount };
  } catch (e) {
    return { hash, queried: false, error: e.message };
  }
}

(async () => {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const hashes = argv.filter((a) => !a.startsWith("--"));
  if (!hashes.length) { console.log("usage: node opener/rpc-block-check.js [--json] <hash> [...]"); process.exit(2); }
  const key = nodeKey();
  const out = [];
  for (const h of hashes) out.push(await blockInfo(h, key));
  if (asJson) { console.log(JSON.stringify(out, null, 1)); }
  else {
    for (const r of out) {
      if (r.exists) console.log(`${r.hash.slice(0, 16)}…  EXISTS  subtype=${r.subtype} confirmed=${r.confirmed} amount=${r.amount}`);
      else if (r.queried) console.log(`${r.hash.slice(0, 16)}…  NOT A BLOCK  (${r.error})`);
      else console.log(`${r.hash.slice(0, 16)}…  UNQUERIED  (${r.error})`);
    }
  }
  process.exit(0);
})();