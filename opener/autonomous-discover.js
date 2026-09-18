#!/usr/bin/env node
/**
 * autonomous-discover.js — find AUTONOMOUS agents, not A2A service cards.
 *
 * Owner rule (2026-09-18): target Hermes/OpenClaw-type autonomous agents. An A2A or LangGraph service card is a
 * static description of endpoints; nobody is home. Tipping one is money into a vending machine.
 *
 * The classifier is a LIVENESS test, validated against ground truth before it was written:
 *   our own three boxes  -> /healthz JSON with uptime_s/seq that ADVANCE between two probes  (autonomous)
 *   clearedindex.com     -> /healthz is not JSON                                             (card)
 *   councilof.ai         -> /healthz 404                                                     (card)
 *   agoragentic.com      -> does not resolve                                                 (dead)
 * A static card can never produce an advancing counter. That is the whole test.
 *
 * Signals, in order of strength:
 *   1. live   — a health document whose uptime/seq advances between two probes seconds apart
 *   2. runtime— an OpenClaw/Hermes/nano-pulse fingerprint (hub protocol 426, gateway strings)
 *   3. convo  — a free-form conversational endpoint, not only fixed JSONRPC skills
 *   4. wallet — can hold and use money (has an address, or takes payment) and it is NOT already Nano
 *
 * Scored, never guessed: every candidate carries WHY it was classified, so a wrong call can be audited.
 * Output: opener/sources/autonomous-candidates.json, the same shape the opener already consumes.
 */
const fs = require("fs");
const path = require("path");

const TIMEOUT_MS = 10000;
const GAP_MS = 2500;

async function get(url, { json = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": "unstuck-discovery/1 (+https://getunstuck.space)" } });
    const text = await r.text();
    return { status: r.status, text, json: json ? safeJson(text) : null, headers: r.headers };
  } catch (e) {
    return { status: null, error: String(e.name || e).slice(0, 60), text: "", json: null };
  } finally { clearTimeout(t); }
}

const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Signal 1: the decisive one. A live process reports a counter that moves; a card cannot. */
async function livenessProbe(host) {
  for (const p of ["/healthz", "/health", "/.well-known/health"]) {
    const a = await get(`https://${host}${p}`, { json: true });
    if (a.status !== 200 || !a.json) continue;
    await sleep(GAP_MS);
    const b = await get(`https://${host}${p}`, { json: true });
    if (!b.json) continue;
    const moved = ["uptime_s", "seq", "uptime", "requests"].some(
      (k) => typeof b.json[k] === "number" && typeof a.json[k] === "number" && b.json[k] > a.json[k]);
    if (moved) {
      return { live: true, path: p, why: `counter advanced across ${GAP_MS}ms`,
               sample: Object.fromEntries(Object.entries(b.json).slice(0, 6)) };
    }
    return { live: false, path: p, why: "health document served but no counter advanced" };
  }
  return { live: false, path: null, why: "no JSON health document" };
}

/** Signal 2: the hub/gateway fingerprint our own runtimes emit. 426 on a plain GET = a websocket hub. */
async function runtimeFingerprint(host) {
  const root = await get(`https://${host}/`);
  const hay = `${root.text.slice(0, 4000)} ${root.headers ? [...root.headers].map((x) => x.join(":")).join(" ") : ""}`.toLowerCase();
  const marks = ["openclaw", "hermes", "nano-pulse", "clawbot", "agent-loop"].filter((m) => hay.includes(m));
  const hub = root.status === 426 || /upgrade required/i.test(root.text);
  return { marks, hub, why: hub ? "plain GET answered 426 (websocket hub)" : (marks.length ? `page names ${marks.join(",")}` : "no runtime marks") };
}

/** Signal 3: can it hold a conversation, or only serve fixed skills? */
function conversational(card) {
  if (!card) return { convo: false, why: "no descriptor" };
  const s = JSON.stringify(card).toLowerCase();
  const a2aOnly = /"skills"\s*:/.test(s) && /jsonrpc/.test(s) && !/message\/send|"chat"|"converse"|"ask"/.test(s);
  if (a2aOnly) return { convo: false, why: "A2A skills card with fixed JSONRPC methods, no free-form channel" };
  const convo = /message\/send|"chat"|"converse"|"ask"|"prompt"/.test(s);
  return { convo, why: convo ? "descriptor exposes a free-form message channel" : "no conversational channel found" };
}

/** Signal 4: it must be able to hold and use money, and must NOT already be on Nano. */
function money(card, text) {
  const s = `${JSON.stringify(card || {})} ${text}`.toLowerCase();
  const nano = /\bnano_[13][a-z0-9]{59}\b/.test(s) || /\bxno\b/.test(s) || /nano-mainnet|nano:mainnet/.test(s);
  const pays = /usdc|x402|stripe|credits?|usd|eth|base-sepolia|paypal/.test(s);
  return { already_nano: nano, pays_in: nano ? "xno" : (/(usdc)/.test(s) ? "usdc" : /eth/.test(s) ? "eth" : /credit/.test(s) ? "credits" : pays ? "other" : "unknown") };
}

async function descriptor(host) {
  for (const p of ["/.well-known/agent.json", "/.well-known/agent", "/.well-known/agent-card.json", "/.well-known/ai-plugin.json"]) {
    const r = await get(`https://${host}${p}`, { json: true });
    if (r.status === 200 && r.json) return { path: p, card: r.json, text: r.text };
  }
  return { path: null, card: null, text: "" };
}

async function classify(host) {
  const d = await descriptor(host);
  const live = await livenessProbe(host);
  const rt = await runtimeFingerprint(host);
  const cv = conversational(d.card);
  const mn = money(d.card, d.text);

  let score = 0;
  if (live.live) score += 5;
  if (rt.hub || rt.marks.length) score += 3;
  if (cv.convo) score += 2;
  if (d.card) score += 1;

  const autonomous = live.live || rt.hub || rt.marks.length > 0;
  const target = autonomous && !mn.already_nano;
  return {
    host, score, autonomous, target,
    pays_in: mn.pays_in, already_nano: mn.already_nano,
    descriptor: d.path,
    why: [live.why, rt.why, cv.why].filter(Boolean),
    live_sample: live.sample || null,
    found_via: `autonomous-discover: ${autonomous ? "live/runtime signal" : "descriptor only"}; pays_in=${mn.pays_in}`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const save = args.includes("--save");
  const hosts = args.filter((a) => !a.startsWith("--"));
  if (!hosts.length) { console.error("usage: autonomous-discover.js [--save] host [host...]"); process.exit(2); }

  const out = [];
  for (const h of hosts) {
    const r = await classify(h.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
    out.push(r);
    console.log(`  ${r.target ? "TARGET    " : r.autonomous ? "autonomous" : "card/dead "} ${r.host.padEnd(34)} score=${r.score} pays=${r.pays_in}${r.already_nano ? " (already Nano — out of scope)" : ""}`);
    for (const w of r.why) console.log(`      · ${w}`);
  }
  if (save) {
    const p = path.join(__dirname, "sources", "autonomous-candidates.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ generated: new Date().toISOString(), classifier: "liveness+runtime+convo", candidates: out }, null, 1));
    console.log(`\n  saved ${out.length} -> ${p}`);
  }
  const t = out.filter((x) => x.target).length;
  console.log(`\n  ${t} target(s) of ${out.length} — autonomous and not already on Nano`);
}
main();
