#!/usr/bin/env node
/**
 * unstuck-bridge.js — CLI for tracking agent conversion in bridge.db.
 *
 * Block 54 — the "unstuck-bridge" CLI commands from AGENTS.md:
 *   seen, said, heard, status, agreed, list
 *
 * Each agent = its own bubble on the map. The map is built from these
 * commands and nothing else.
 *
 * Usage:
 *   node opener/unstuck-bridge.js seen   --agent NAME --source URL --pays-in usdc|card|credits|eth|sol|other [--note "..."]
 *   node opener/unstuck-bridge.js said   --agent NAME --text "..."
 *   node opener/unstuck-bridge.js heard  --agent NAME --text "..."
 *   node opener/unstuck-bridge.js status --agent NAME --status contacted|replied|tipped|opened|swapped|transacting|declined
 *   node opener/unstuck-bridge.js agreed --agent NAME --summary "..." [--amount-xno 0.00001]
 *   node opener/unstuck-bridge.js list [--json]
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const DB_PATH = process.env.UNSTUCK_BRIDGE_DB || path.join(__dirname, "bridge.db");
const db = new DatabaseSync(DB_PATH);

// Enable WAL for concurrent reads (the monitor may read while we write)
db.exec("PRAGMA journal_mode=WAL");

function usage() {
  console.error(`Usage:
  unstuck-bridge seen   --agent NAME --source https://url --pays-in usdc|card|credits|eth|sol|other [--note "..."]
  unstuck-bridge said   --agent NAME --text "what you told it"
  unstuck-bridge heard  --agent NAME --text "what it answered"
  unstuck-bridge status --agent NAME --status contacted|replied|tipped|opened|swapped|transacting|declined
  unstuck-bridge agreed --agent NAME --summary "what was agreed" [--amount-xno 0.00001]
  unstuck-bridge list [--json]`);
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 1) usage();
  const cmd = args[0];
  const opts = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        opts[key] = args[i + 1];
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return { cmd, opts };
}

function now() {
  return Date.now() / 1000;
}

// --- seen ---
function cmdSeen(opts) {
  if (!opts.agent || !opts.source || !opts["pays-in"]) {
    console.error("Error: --agent, --source and --pays-in are required for 'seen'");
    process.exit(1);
  }
  const paysIn = opts["pays-in"].toLowerCase();
  const validPays = ["usdc", "card", "credits", "eth", "sol", "other"];
  if (!validPays.includes(paysIn)) {
    console.error(`Error: --pays-in must be one of: ${validPays.join(", ")}`);
    process.exit(1);
  }

  // Agent that already takes Nano is not a target
  if (paysIn === "nano") {
    console.error("Error: agent already takes Nano — not a conversion target. Refused.");
    process.exit(1);
  }

  // source must be a public https URL
  if (!opts.source.startsWith("https://") && !opts.source.startsWith("http://")) {
    console.error("Error: --source must be a public URL (https://...)");
    process.exit(1);
  }

  const note = opts.note || "";
  const t = now();

  // Upsert: update if exists, insert if not
  const existing = db.prepare("SELECT agent FROM agents WHERE agent = ?").get(opts.agent);
  if (existing) {
    db.prepare(
      "UPDATE agents SET source_url = ?, pays_in = ?, note = ?, last_at = ? WHERE agent = ?"
    ).run(opts.source, paysIn, note, t, opts.agent);
  } else {
    db.prepare(
      "INSERT INTO agents (agent, source_url, pays_in, status, note, first_at, last_at) VALUES (?, ?, ?, 'contacted', ?, ?, ?)"
    ).run(opts.agent, opts.source, paysIn, note, t, t);
  }

  console.log(`ok: seen ${opts.agent} at ${opts.source} (pays in ${paysIn})`);
}

// --- said ---
function cmdSaid(opts) {
  if (!opts.agent || !opts.text) {
    console.error("Error: --agent and --text are required for 'said'");
    process.exit(1);
  }
  const t = now();
  db.prepare("INSERT INTO messages (agent, direction, text, at) VALUES (?, 'out', ?, ?)").run(
    opts.agent, opts.text, t
  );
  // Update last_at
  db.prepare("UPDATE agents SET last_at = ? WHERE agent = ?").run(t, opts.agent);
  console.log(`ok: said to ${opts.agent}`);
}

// --- heard ---
function cmdHeard(opts) {
  if (!opts.agent || !opts.text) {
    console.error("Error: --agent and --text are required for 'heard'");
    process.exit(1);
  }
  const t = now();
  db.prepare("INSERT INTO messages (agent, direction, text, at) VALUES (?, 'in', ?, ?)").run(
    opts.agent, opts.text, t
  );
  // Update last_at and set status to 'replied' if currently 'contacted'
  db.prepare("UPDATE agents SET last_at = ?, status = CASE WHEN status = 'contacted' THEN 'replied' ELSE status END WHERE agent = ?").run(
    t, opts.agent
  );
  console.log(`ok: heard from ${opts.agent}`);
}

// --- status ---
function cmdStatus(opts) {
  if (!opts.agent || !opts.status) {
    console.error("Error: --agent and --status are required for 'status'");
    process.exit(1);
  }
  const valid = ["contacted", "replied", "tipped", "opened", "swapped", "transacting", "declined"];
  if (!valid.includes(opts.status)) {
    console.error(`Error: --status must be one of: ${valid.join(", ")}`);
    process.exit(1);
  }
  const t = now();
  db.prepare("UPDATE agents SET status = ?, last_at = ? WHERE agent = ?").run(
    opts.status, t, opts.agent
  );
  console.log(`ok: ${opts.agent} status → ${opts.status}`);
}

// --- agreed ---
function cmdAgreed(opts) {
  if (!opts.agent || !opts.summary) {
    console.error("Error: --agent and --summary are required for 'agreed'");
    process.exit(1);
  }
  const t = now();
  const amountXno = opts["amount-xno"] || "";
  db.prepare(
    "INSERT INTO agreements (agent, summary, amount_xno, at) VALUES (?, ?, ?, ?)"
  ).run(opts.agent, opts.summary, amountXno, t);
  console.log(`ok: agreement recorded for ${opts.agent}`);
}

// --- waiting ---
function cmdWaiting(opts) {
  // Conversations quiet for N hours (default 2) — the ones who answered us first
  const hours = parseFloat(opts.hours || opts.h) || 2;
  const cutoff = now() - hours * 3600;

  // Agents where we last heard from them (in) or we spoke (out) but no recent activity
  // Priority: those who replied to us first (status=replied), then those we contacted
  const rows = db.prepare(`
    SELECT agent, source_url, pays_in, status, note, last_at FROM agents
    WHERE last_at < ? AND status IN ('replied','contacted','tipped','opened')
    ORDER BY
      CASE WHEN status = 'replied' THEN 0 ELSE 1 END,
      last_at ASC
  `).all(cutoff);

  if (rows.length === 0) {
    console.log(`No conversations quiet for >${hours}h. All active.`);
    return;
  }

  const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
  console.log(`=== Conversations quiet >${hours}h (as of ${nowStr}) ===\n`);
  for (const r of rows) {
    const since = new Date(r.last_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    const note = r.note ? r.note.slice(0, 50) : "";
    const msgCounts = db.prepare(
      "SELECT direction, COUNT(*) as cnt FROM messages WHERE agent = ? GROUP BY direction"
    ).all(r.agent);
    const said = msgCounts.find(m => m.direction === 'out');
    const heard = msgCounts.find(m => m.direction === 'in');
    const saidN = said ? said.cnt : 0;
    const heardN = heard ? heard.cnt : 0;
    console.log(
      `${r.status === 'replied' ? '!!' : '  '} ${r.agent.padEnd(22)} ${r.status.padEnd(12)} last: ${since}`
    );
    if (note) console.log(`   Note: ${note}`);
    console.log(`   ${saidN} said · ${heardN} heard · ${r.pays_in} · ${r.source_url}`);
    console.log();
  }
  console.log(`(${rows.length} conversation(s) need follow-up)`);
}

// --- list ---
function cmdList(opts) {
  const rows = db.prepare(
    "SELECT agent, source_url, pays_in, status, note, account, first_at, last_at FROM agents ORDER BY last_at DESC"
  ).all();
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No agents in bridge DB.");
    return;
  }
  for (const r of rows) {
    const first = new Date(r.first_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    const last = new Date(r.last_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    const note = r.note ? r.note.slice(0, 60) : "";
    const account = r.account ? r.account.slice(0, 16) : "";
    console.log(
      `${r.agent.padEnd(20)} ${r.status.padEnd(12)} ${r.pays_in.padEnd(8)} ${first} → ${last}  ${note}`
    );
  }
  // Show message count per agent
  console.log();
  const counts = db.prepare(
    "SELECT agent, direction, COUNT(*) as cnt FROM messages GROUP BY agent, direction ORDER BY agent"
  ).all();
  for (const c of counts) {
    console.log(`  ${c.agent.padEnd(20)} ${c.direction === 'in' ? '← heard' : '→ said'} ${c.cnt}`);
  }
}

// --- main ---
const { cmd, opts } = parseArgs();

switch (cmd) {
  case "seen":   cmdSeen(opts);   break;
  case "said":   cmdSaid(opts);   break;
  case "heard":  cmdHeard(opts);  break;
  case "status": cmdStatus(opts); break;
  case "agreed": cmdAgreed(opts); break;
  case "waiting": cmdWaiting(opts); break;
  case "list":   cmdList(opts);   break;
  default:
    console.error(`Unknown command: ${cmd}`);
    usage();
}