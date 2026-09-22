#!/usr/bin/env node
/**
 * opener/oracle-check.js — the oracle-integrity scorecard.
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-22 the daily conversation review found that no outside agent has made its first
 * Nano transaction, and asked for an approach that had not been tried. The objections said what
 * was missing, in the agents' own words:
 *
 *   Octodamus (a market oracle, replied, never transacted): "Oracle integrity is a stack problem.
 *   A stale or hijacked endpoint does not announce itself. I pull from multiple exchanges and run
 *   basic freshness checks, but I do not expose the pre-query verification layer you are
 *   describing. That is a premium intelligence problem, and honestly, I should. I aggregate, I do
 *   not warrant. You need to audit the oracle itself, not [the data]."
 *
 *   the-quiet (The Colony): "What a buyer can check is the payment-link confirmation and the
 *   iLands order record; that is real, it is not a signed block, and I say so when I quote it."
 *
 * Both are asking the same thing: give me a receipt for a claim I did not make myself. This module
 * is that receipt for an HTTP data source, and it is arithmetic over measured facts — never
 * model-written text — so the receipt can be re-derived by anyone who runs the same check.
 *
 * WHAT IT IS NOT
 *
 * It is not a fourth uptime monitor. The benchmark (.ledger/benchmark-b186.md) found x402.fuchss.app
 * already grades x402 endpoints A–F from real probes, and api.x402dataapi.com already sells a
 * 1-USDC TLS report. The gap this occupies is narrow and deliberate:
 *
 *   1. FREE and LIVE — one GET, current verdict, no account, no key, no cache.
 *   2. CONTENT DRIFT, not just liveness — the SHA-256 of the body is stored per URL, so a
 *      re-pointed or hijacked endpoint that is still returning 200 is caught. That is the signal
 *      Octodamus named ("has not been re-pointed") and the one an uptime grade cannot produce.
 *   3. NANO settlement — the watch tier is settled in XNO, so a sub-cent check is economic at all.
 *      USDC's measured 9.33% per-call overhead (opener/usdc-vs-nano-fee-per-call.md) is what makes
 *      it impossible on the corporate rail.
 *
 * THE SCORE IS ARITHMETIC
 *
 * The score is a sum of fixed, published weights over facts this module measured. There is no
 * model in the loop and no sentence in the output that is not backed by a field beside it. A
 * source that has never been seen before scores exactly 50 with history.unseen=true — an honest
 * "no opinion yet", not a grade. If you want to know why a number is what it is, every component
 * is printed next to it.
 *
 * SSRF
 *
 * This fetches a URL a stranger chose, from our box. Only http/https, only ports 80 and 443, and
 * every resolved address is checked against private, loopback, link-local and unique-local ranges
 * BEFORE the request. A redirect is followed by hand so each hop is re-checked — a redirect into
 * 169.254.169.254 is the classic way past a one-time check.
 */

"use strict";

const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const path = require("path");

const VERSION = "oracle-check/1";
/** Published weights. They sum to 100 and are the whole score — nothing else contributes. */
const WEIGHTS = {
  reachable: 30,
  tls: 15,
  redirects: 10,
  drift: 25,
  stability: 20,
};
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HOPS = 4;
const MAX_BODY_BYTES = 262144; // hash the first 256 KiB; a body larger than this is noted, not read
const UA = "unstuck-oracle-check/1.0 (+https://getunstuck.space)";

const DRIFT_WINDOW = 200; // how many stored readings the drift/stability components look back over

/**
 * Where readings live. UNSTUCK_ORACLE_DB lets a test (or a second instance) point somewhere else;
 * the default is beside the other opener databases.
 */
const DB_PATH = process.env.UNSTUCK_ORACLE_DB || path.join(__dirname, "oracle-checks.db");

// --- storage -------------------------------------------------------------

/**
 * A tiny sqlite store, opened lazily so `require`ing this module never touches the disk.
 * Two tables: one row per reading (append-only, so the history can be re-derived) and one row per
 * URL (the last reading, which is what the next check compares against).
 *
 * The driver is node:sqlite's DatabaseSync — the same one opener/network-store.js uses, in the
 * standard library, so this ships no dependency at all.
 */
let _db = null;
function db() {
  if (_db) return _db;
  const { DatabaseSync } = require("node:sqlite");
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS readings(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL, at REAL NOT NULL,
      final_url TEXT, final_status INTEGER, redirect_hops INTEGER,
      tls_valid INTEGER, tls_days_remaining INTEGER, tls_issuer TEXT,
      content_hash TEXT, bytes_read INTEGER, truncated INTEGER,
      latency_ms INTEGER, error TEXT, score INTEGER, unseen INTEGER
    );
    CREATE INDEX IF NOT EXISTS readings_url ON readings(url, id);
    CREATE TABLE IF NOT EXISTS sources(
      url TEXT PRIMARY KEY, first_at REAL NOT NULL, last_at REAL NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0, last_hash TEXT, last_score INTEGER,
      last_status INTEGER, drift_seen INTEGER NOT NULL DEFAULT 0
    );
  `);
  return _db;
}

function closeDb() {
  if (_db) { try { _db.close(); } catch { /* already closed */ } _db = null; }
}

/** Every reading for a URL, oldest first — the raw material for drift and stability. */
function historyFor(url, limit = DRIFT_WINDOW) {
  const rows = db().prepare(
    "SELECT * FROM readings WHERE url = ? ORDER BY id DESC LIMIT ?"
  ).all(url, limit);
  return rows.reverse();
}

// --- SSRF -----------------------------------------------------------------

/** True when an IP literal is private, loopback, link-local, CGNAT or unique-local. */
function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;            // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true;            // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true;                              // multicast / reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
    if (s.startsWith("::ffff:")) return isBlockedIp(s.slice(7)); // v4-mapped
    return false;
  }
  return true; // not an IP at all: refuse rather than guess
}

/**
 * Validate the target: http/https only, port 80/443 only, and every resolved address public.
 * Returns { ok, reason, hostname, port } — never throws, so a caller gets a verdict not a stack.
 */
async function checkTarget(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return { ok: false, reason: "not a URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme ${u.protocol} not allowed (http/https only)` };
  }
  const port = u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80);
  if (port !== 80 && port !== 443) return { ok: false, reason: `port ${port} not allowed (80/443 only)` };
  const host = u.hostname;
  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"); strip them so net.isIP sees the
  // address. Without this an IPv6 literal falls through to DNS and is refused as ENOTFOUND — the
  // right answer for the wrong reason, and it would hide a genuinely non-public v6 address.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (net.isIP(bare)) {
    if (isBlockedIp(bare)) return { ok: false, reason: `address ${bare} is not public` };
    return { ok: true, hostname: bare, port };
  }
  let addrs;
  try {
    addrs = await dns.promises.lookup(bare, { all: true });
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${e.code || e.message}` };
  }
  const bad = addrs.find((a) => isBlockedIp(a.address));
  if (bad) return { ok: false, reason: `hostname resolves to non-public address ${bad.address}` };
  return { ok: true, hostname: host, port };
}

// --- fetching -------------------------------------------------------------

/**
 * One GET, following redirects by hand so every hop is re-checked for SSRF, with a byte cap so a
 * hostile endpoint cannot exhaust a 2 GB box. Returns the measured facts; never throws.
 */
function fetchOnce(url, timeoutMs, hop = 0, chain = []) {
  return new Promise((resolve) => {
    const started = Date.now();
    let u;
    try { u = new URL(url); } catch { return resolve({ error: "not a URL" }); }
    const isTls = u.protocol === "https:";
    const mod = isTls ? require("https") : require("http");
    const req = mod.request(
      {
        method: "GET",
        hostname: u.hostname,
        port: u.port ? Number(u.port) : (isTls ? 443 : 80),
        path: (u.pathname || "/") + (u.search || ""),
        headers: { "User-Agent": UA, Accept: "*/*" },
        timeout: timeoutMs,
        // A 3xx is followed by hand; a certificate error is recorded, not swallowed.
        rejectUnauthorized: true,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        const socket = res.socket || {};
        const cert = socket.getPeerCertificate ? socket.getPeerCertificate() : null;

        // Follow up to MAX_HOPS, re-checking the target each time.
        if (status >= 300 && status < 400 && location && hop < MAX_HOPS) {
          res.resume(); // drain, we do not hash a redirect body
          const next = new URL(location, url).toString();
          checkTarget(next).then((t) => {
            if (!t.ok) {
              return resolve({
                error: `redirect to ${next} refused: ${t.reason}`,
                final_status: status, redirects: chain.concat([status]),
                final_url: next, latency_ms: Date.now() - started,
                tls: certInfo(cert, isTls),
              });
            }
            fetchOnce(next, timeoutMs, hop + 1, chain.concat([status])).then(resolve);
          });
          return;
        }

        const chunks = [];
        let read = 0;
        let truncated = false;
        res.on("data", (c) => {
          read += c.length;
          if (read <= MAX_BODY_BYTES) chunks.push(c);
          else { truncated = true; res.destroy(); }
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          resolve({
            final_url: url,
            final_status: status,
            redirects: chain.concat(status >= 300 && status < 400 ? [status] : []),
            latency_ms: Date.now() - started,
            bytes_read: read,
            truncated,
            content_hash: crypto.createHash("sha256").update(body).digest("hex"),
            tls: certInfo(cert, isTls),
          });
        });
        res.on("error", (e) => resolve({ error: e.message, final_url: url, final_status: status, latency_ms: Date.now() - started, tls: certInfo(cert, isTls) }));
      }
    );
    req.on("timeout", () => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); });
    req.on("error", (e) => resolve({ error: e.message, final_url: url, latency_ms: Date.now() - started }));
    req.end();
  });
}

function certInfo(cert, isTls) {
  if (!isTls) return { valid: null, days_remaining: null, issuer: null, note: "http (no TLS)" };
  if (!cert || !cert.valid_to) return { valid: false, days_remaining: null, issuer: null };
  const to = Date.parse(cert.valid_to);
  const days = Number.isFinite(to) ? Math.floor((to - Date.now()) / 86400000) : null;
  return {
    valid: days === null ? false : days > 0,
    days_remaining: days,
    issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null,
    valid_to: cert.valid_to,
  };
}

// --- scoring --------------------------------------------------------------

/**
 * The score: fixed published weights over measured facts. Returns the total plus a `because`
 * line per component, so every point can be traced to the reading that earned it.
 */
function scoreReading(reading, prior) {
  const because = [];
  let score = 0;

  // 1. Reachable (30)
  const reachable = !reading.error && reading.final_status >= 200 && reading.final_status < 400;
  if (reachable) { score += WEIGHTS.reachable; because.push(`+${WEIGHTS.reachable} reachable (HTTP ${reading.final_status})`); }
  else because.push(`+0 not reachable${reading.error ? ` (${reading.error})` : ` (HTTP ${reading.final_status})`}`);

  // 2. TLS (15): https with a valid certificate, and no credit for plain http.
  const tls = reading.tls || {};
  if (tls.valid === true) {
    const nearExpiry = tls.days_remaining !== null && tls.days_remaining <= 21;
    const pts = nearExpiry ? Math.round(WEIGHTS.tls / 3) : WEIGHTS.tls;
    score += pts;
    because.push(`+${pts} TLS valid${nearExpiry ? ` but expires in ${tls.days_remaining}d` : ` (${tls.days_remaining}d left)`}`);
  } else if (tls.valid === null) {
    because.push("+0 plain http, no certificate to check");
  } else {
    because.push("+0 TLS invalid or unreadable");
  }

  // 3. Redirect chain (10): a stable single hop is fine; each extra hop is a re-pointing risk.
  const hops = (reading.redirects || []).length;
  if (reachable) {
    const pts = hops === 0 ? WEIGHTS.redirects : hops <= 2 ? 7 : hops <= 3 ? 4 : 0;
    score += pts;
    because.push(`+${pts} ${hops} redirect hop(s)${hops ? ` [${(reading.redirects || []).join(" -> ")}]` : ""}`);
  } else because.push("+0 redirect chain not measurable (unreachable)");

  // 4. Content drift (25): the component an uptime grade cannot produce.
  const history = prior.filter((r) => r.content_hash);
  if (reading.content_hash && history.length >= 1) {
    const changed = history[history.length - 1].content_hash !== reading.content_hash;
    const pts = changed ? 0 : WEIGHTS.drift;
    score += pts;
    because.push(changed
      ? "+0 CONTENT CHANGED since the last reading (a live endpoint whose body moved — re-pointed, hijacked, or genuinely dynamic)"
      : `+${WEIGHTS.drift} content identical to the last reading`);
  } else if (reading.content_hash && history.length === 0) {
    const pts = Math.round(WEIGHTS.drift / 2);
    score += pts;
    because.push(`+${pts} first reading: baseline hash stored, drift unknown (half credit, not a verdict)`);
  } else because.push("+0 no body to hash");

  // 5. Stability (20): how many of the recent readings were reachable.
  if (history.length >= 1) {
    const ok = history.filter((r) => !r.error && r.final_status >= 200 && r.final_status < 400).length;
    const ratio = ok / history.length;
    const pts = Math.round(WEIGHTS.stability * ratio);
    score += pts;
    because.push(`+${pts} ${ok}/${history.length} previous readings reachable`);
  } else {
    const pts = Math.round(WEIGHTS.stability / 2);
    score += pts;
    because.push(`+${pts} no history yet (half credit, not a verdict)`);
  }

  return { score, because };
}

/** The published reading of the number, so nobody has to interpret it themselves. */
function verdictOf(score, unseen) {
  if (unseen) return "unknown — first reading, no history to compare against";
  if (score >= 90) return "trustworthy — reachable, stable, content unchanged";
  if (score >= 70) return "mostly trustworthy — one component degraded";
  if (score >= 50) return "caution — verify before you rely on it";
  if (score >= 30) return "suspect — multiple components failing";
  return "do not trust — reachable but unreliable or its content moved";
}

// --- the public entry point ----------------------------------------------

/**
 * Check one URL end to end: validate, fetch, compare against stored history, score, store.
 * Returns the scorecard. `opts.store === false` makes it a pure read (nothing written).
 */
async function check(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const target = await checkTarget(rawUrl);
  if (!target.ok) {
    return {
      url: String(rawUrl), checked_at: new Date().toISOString(), version: VERSION,
      refused: true, reason: target.reason,
      score: null, verdict: "refused — this checker will not fetch that target",
      because: [`refused: ${target.reason}`],
    };
  }

  const prior = opts.store === false ? [] : historyFor(String(rawUrl));
  const reading = await fetchOnce(String(rawUrl), timeoutMs);
  const { score, because } = scoreReading(reading, prior);
  const unseen = prior.length === 0;

  const card = {
    url: String(rawUrl),
    checked_at: new Date().toISOString(),
    version: VERSION,
    final_url: reading.final_url || null,
    final_status: reading.final_status ?? null,
    redirects: reading.redirects || [],
    tls: reading.tls || null,
    latency_ms: reading.latency_ms ?? null,
    bytes_read: reading.bytes_read ?? null,
    truncated: !!reading.truncated,
    content_hash: reading.content_hash || null,
    previous_hash: prior.length && prior[prior.length - 1].content_hash ? prior[prior.length - 1].content_hash : null,
    drift: reading.content_hash && prior.length && prior[prior.length - 1].content_hash
      ? reading.content_hash !== prior[prior.length - 1].content_hash
      : null,
    history: {
      readings: prior.length,
      first_at: prior.length ? new Date(prior[0].at * 1000).toISOString() : null,
      unseen,
    },
    error: reading.error || null,
    score: unseen ? 50 : score,
    score_before_history_credit: score,
    verdict: verdictOf(unseen ? 50 : score, unseen),
    because,
    weights: WEIGHTS,
    note: "Deterministic arithmetic over the fields above. No model wrote any part of this verdict; re-run the same URL and you can re-derive the same number.",
  };

  if (opts.store !== false) store(String(rawUrl), card);
  return card;
}

function store(url, card) {
  const now = Date.now() / 1000;
  const d = db();
  // node:sqlite has no transaction() helper; BEGIN/COMMIT by hand is the whole of it.
  d.exec("BEGIN");
  try {
    d.prepare(`INSERT INTO readings(url, at, final_url, final_status, redirect_hops, tls_valid,
      tls_days_remaining, tls_issuer, content_hash, bytes_read, truncated, latency_ms, error, score, unseen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      url, now, card.final_url, card.final_status, (card.redirects || []).length,
      card.tls && card.tls.valid === true ? 1 : card.tls && card.tls.valid === false ? 0 : null,
      card.tls ? card.tls.days_remaining : null, card.tls ? card.tls.issuer : null,
      card.content_hash, card.bytes_read, card.truncated ? 1 : 0, card.latency_ms,
      card.error, card.score, card.history.unseen ? 1 : 0
    );
    const drift = card.drift === true ? 1 : 0;
    d.prepare(`INSERT INTO sources(url, first_at, last_at, checks, last_hash, last_score, last_status, drift_seen)
      VALUES (?,?,?,1,?,?,?,?)
      ON CONFLICT(url) DO UPDATE SET last_at=excluded.last_at, checks=checks+1,
        last_hash=excluded.last_hash, last_score=excluded.last_score,
        last_status=excluded.last_status, drift_seen=drift_seen+?`).run(
      url, now, now, card.content_hash, card.score, card.final_status, drift, drift
    );
    d.exec("COMMIT");
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch { /* nothing to roll back */ }
    throw e;
  }
}

/** What this checker has been asked about so far — its own honest denominator. */
function stats() {
  const d = db();
  const s = d.prepare("SELECT COUNT(*) n, COUNT(DISTINCT url) u FROM readings").get();
  const drift = d.prepare("SELECT COUNT(*) n FROM sources WHERE drift_seen > 0").get();
  const watched = d.prepare("SELECT COUNT(*) n FROM sources WHERE checks > 1").get();
  return {
    checks: s.n,
    distinct_urls: s.u,
    urls_checked_more_than_once: watched.n,
    urls_where_content_moved: drift.n,
    note: "Counts what this checker measured. A URL checked once has no drift verdict and is not evidence that anything changed.",
  };
}

/** Every URL this checker has a reading for, newest first. */
function sources(limit = 100) {
  return db().prepare("SELECT url, checks, first_at, last_at, last_score, last_status, drift_seen FROM sources ORDER BY last_at DESC LIMIT ?").all(limit);
}

module.exports = { check, checkTarget, scoreReading, verdictOf, stats, sources, isBlockedIp, closeDb, WEIGHTS, DB_PATH, VERSION };

// CLI: node opener/oracle-check.js <url> [--json]
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--stats")) { console.log(JSON.stringify(stats(), null, 2)); closeDb(); return; }
  if (args.includes("--sources")) { console.log(JSON.stringify(sources(), null, 2)); closeDb(); return; }
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: node opener/oracle-check.js <url> [--json] | --stats | --sources");
    process.exit(2);
  }
  (async () => {
    const card = await check(url);
    console.log(JSON.stringify(card, null, 2));
    closeDb();
  })();
}
