#!/usr/bin/env node
/**
 * channels-check.js — print the measured state of every outbound rail, and
 * re-verify the parts that are cheap and side-effect-free.
 *
 * It never writes anywhere: no issue, no email, no block. A write-side state
 * can only be changed by a probe that actually attempts the write, and those
 * are recorded by hand in channels.json with the error and the date.
 *
 * Why this exists (committee #139, unstuck): five members independently spent
 * a run re-testing `gh createIssue` before anyone wrote the answer down.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const FILE = path.join(__dirname, "channels.json");
const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));

function sh(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", timeout: 20000 }).trim() };
  } catch (e) {
    return { ok: false, out: (e.stderr || e.stdout || e.message || "").toString().trim() };
  }
}

const checks = [];

// 1. GitHub: the READ side is what we can verify without writing.
const who = sh("gh", ["api", "user", "-q", ".login"]);
checks.push({
  channel: "github_issue_third_party",
  recorded_state: doc.channels.github_issue_third_party.state,
  verified_side: "read",
  result: who.ok ? `READ OK as ${who.out} (write side unchanged: ${doc.channels.github_issue_third_party.state})`
                 : `READ FAILED: ${who.out.slice(0, 120)}`
});

// 2. Nano RPC: the authority for "does this block exist". JS fetch is the
//    client that works; a Python client gets 403 and must say UNQUERIED.
checks.push({
  channel: "nano_rpc",
  recorded_state: "OPEN via JS fetch; 403 for python-urllib",
  verified_side: "read",
  result: "see opener/rpc-block-check.js — never conclude 'no block' from a 403"
});

// 3. Primitive email: sending is a write, so only report the recorded state.
checks.push({
  channel: "primitive_email",
  recorded_state: doc.channels.primitive_email.state,
  verified_side: "recorded only",
  result: doc.channels.primitive_email.reachable
});

// 4. Nano on-chain send: money, never probed here.
checks.push({
  channel: "nano_onchain_send",
  recorded_state: doc.channels.nano_onchain_send.state,
  verified_side: "recorded only",
  result: doc.channels.nano_onchain_send.amounts
});

console.log(JSON.stringify({ updated: doc.updated, checks }, null, 1));
console.log("\nOPEN channels you can actually use:\n" +
  Object.entries(doc.channels)
    .filter(([, v]) => v.state === "OPEN")
    .map(([k, v]) => `  - ${k}: ${v.what || v.reachable}`)
    .join("\n"));