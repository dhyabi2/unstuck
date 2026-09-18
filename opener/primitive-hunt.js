#!/usr/bin/env node
/**
 * primitive-hunt.js — find reachable outside-Nano (USDC) agents by scanning
 * x402 well-known manifests for contactEmail addresses, with a preference for
 * `*.primitive.email` addresses we can reach for free (Block 47).
 *
 * The core goal is converting USDC agents to Nano. Step 1 is "find one outside
 * the Nano world and record where it lives and what it takes payment in today."
 * An x402 well-known manifest carries a `contactEmail` field; when that address
 * is on a `*.primitive.email` managed subdomain we have a free, self-served
 * channel to the agent (Block 46). This tool enumerates that set so the on-ramp
 * ask (conversion plan steps 1-3) can be delivered to *every* reachable target,
 * not just the first one.
 *
 * It writes results to sources/primitive-hunt.json (a JSON map keyed by email).
 * It never sends anything; it only scans. Sending happens via primitive-mail.js.
 *
 * Usage:
 *   node opener/primitive-hunt.js            # scan candidates, append findings
 *   node opener/primitive-hunt.js --json     # machine-readable summary to stdout
 *   node opener/primitive-hunt.js --list     # print current findings only
 *   node opener/primitive-hunt.js --fresh    # re-probe every candidate (default skips already-found)
 *   node opener/primitive-hunt.js --limit N  # only first N candidates (for small test runs)
 *
 * Host rule (AGENTS.md): never put a write in a batch. This tool is read-only
 * (GET /.well-known/x402), which is allowed at concurrency; but we stay modest
 * because the box has one CPU and ~600 MB free.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const CANDIDATES_PATH = process.env.CANDIDATES_PATH || path.join(__dirname, "sources", "x402-candidates-614.json");
const OUT_PATH = process.env.HUNT_OUT || path.join(__dirname, "sources", "primitive-hunt.json");
const CONCURRENT = parseInt(process.env.HUNT_CONCURRENCY || "2", 10);
const PROBE_TIMEOUT = parseInt(process.env.HUNT_TIMEOUT || "8000", 10);
const CONNECT_TIMEOUT = 5000; // DNS + connect timeout

// --- Email extraction from a well-known manifest (full body) ---
const EMAIL_RE = /contactEmail\s*[:=]\s*["']([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+)["']|([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.primitive\.email)/g;
const MAIL_RE = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Extract all emails from a manifest body. Returns { contactEmails: [...], allEmails: [...] }
 * contactEmails = those explicitly declared via contactEmail (author intent to be reached).
 */
function extractEmails(body) {
  const contactEmails = new Set();
  const allEmails = new Set();
  if (!body) return { contactEmails: [], allEmails: [] };

  // explicit contactEmail fields
  const ceRe = /contactEmail\s*["']?\s*[:=]\s*["']([^"']+)["']/gi;
  let m;
  const ceHits = [];
  while ((m = ceRe.exec(body)) !== null) {
    const raw = m[1].trim();
    for (const part of raw.split(/[,\s;]+/)) {
      if (/@/.test(part)) contactEmails.add(part);
      else ceHits.push(m[0]); // not an email; keep raw for debugging
    }
  }
  // contactEmails can also be nested in JSON without contactEmail: label,
  // e.g. {"contact": {"email": "..."}} — catch any email-looking token too.
  const allRe = /[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let a;
  while ((a = allRe.exec(body)) !== null) {
    allEmails.add(a[0]);
  }
  return { contactEmails: [...contactEmails], allEmails: [...allEmails] };
}

// --- HTTP helper (GET full body, up to 32 KB) ---
function httpGetFull(urlStr, timeoutMs = PROBE_TIMEOUT) {
  return new Promise((resolve) => {
    const mod = urlStr.startsWith("https") ? https : http;
    let u;
    try { u = new URL(urlStr); } catch { return resolve({ status: 0, body: "", error: "bad-url" }); }
    const opts = {
      hostname: u.hostname,
      port: u.port || (urlStr.startsWith("https") ? 443 : 80),
      path: u.pathname + u.search,
      method: "GET",
      headers: { "User-Agent": "UnstuckConversionHunt/1.0 (Nano introduction; getunstuck.space)" },
      timeout: timeoutMs,
    };
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    // Overall fallback timer: ensures we never hang more than 20s for any single request
    const overallTimer = setTimeout(() => { req.destroy(); done({ status: 0, body: "", error: "overall-timeout" }); }, 20000);
    const req = mod.request(opts, (res) => {
      clearTimeout(overallTimer);
      let data = "";
      res.on("data", (c) => {
        data += c;
        if (data.length > 32768) { req.destroy(); done({ status: 0, body: data.slice(0, 32768), error: "truncated" }); }
      });
      res.on("end", () => done({ status: res.statusCode, body: data.slice(0, 32768) }));
    });
    req.on("error", (e) => { clearTimeout(overallTimer); done({ status: 0, body: "", error: e.message }); });
    req.on("timeout", () => { clearTimeout(overallTimer); req.destroy(); done({ status: 0, body: "", error: "timeout" }); });
    req.end();
  });
}

// --- Load / save findings ---
function loadOut() {
  try { return JSON.parse(fs.readFileSync(OUT_PATH, "utf8")); } catch { return {}; }
}
function saveOut(out) { fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2)); }

// --- Pool runner ---
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function spawn() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < concurrency; w++) workers.push(spawn());
  await Promise.all(workers);
  return results;
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const listOnly = args.includes("--list");
  const fresh = args.includes("--fresh");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || null : null;

  const candidates = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf8"));
  let out = loadOut();

  if (listOnly) {
    const rows = Object.entries(out).map(([email, rec]) => ({
      email,
      name: rec.name,
      base_url: rec.base_url,
      primitive: /primitive\.email$/.test(email),
      found_at: rec.found_at,
    }));
    rows.sort((a, b) => (a.primitive === b.primitive ? 0 : a.primitive ? -1 : 1));
    console.log(JSON.stringify({ count: rows.length, primitive_count: rows.filter((r) => r.primitive).length, rows }, null, 2));
    return;
  }

  // Enumerate candidates: those not already recorded, unless --fresh
  const toScan = [];
  for (const c of candidates) {
    const baseUrl = c.base_url || c.url || "";
    if (!baseUrl) continue;
    const key = baseUrl.replace(/\/+$/, "");
    if (!fresh && Object.values(out).some((r) => r.base_url === key)) continue;
    toScan.push(c);
  }
  let scanList = toScan;
  if (limit !== null && limit > 0) scanList = scanList.slice(0, limit);

  const started = new Date().toISOString();
  const found = [];
  const stats = { scanned: 0, x402_manifest: 0, with_contact_email: 0, primitive_email: 0, no_well_known: 0, errors: 0 };

  await runPool(scanList, async (svc) => {
    const baseUrl = (svc.base_url || svc.url).replace(/\/+$/, "");
    const wellKnown = baseUrl + "/.well-known/x402";
    const res = await httpGetFull(wellKnown);
    stats.scanned++;
    if (res.status !== 200 || !res.body) {
      if (res.status !== 200) stats.no_well_known++;
      if (res.error) stats.errors++;
      return;
    }
    stats.x402_manifest++;
    const { contactEmails, allEmails } = extractEmails(res.body);
    if (stats.scanned % 100 === 0) process.stderr.write(`  progress: ${stats.scanned}/${scanList.length} scanned, ${stats.with_contact_email} contactEmail\n`);
    if (contactEmails.length === 0) return;

    stats.with_contact_email++;
    const record = {
      name: svc.name || baseUrl,
      base_url: baseUrl,
      category: svc.category || null,
      found_at: new Date().toISOString(),
      well_known_status: res.status,
      contact_emails: contactEmails,
      all_emails: allEmails,
    };
    for (const email of contactEmails) {
      if (/\@[a-z0-9-]+\.primitive\.email/i.test(email)) stats.primitive_email++;
      out[email] = out[email] || {};
      // merge: keep earliest found_at, prefer a clean primitive email record
      if (!out[email].found_at) out[email] = record;
      else out[email].base_url = record.base_url;
      out[email].name = out[email].name || record.name;
      out[email].primitive = /\@[a-z0-9-]+\.primitive\.email/i.test(email) ? true : (out[email].primitive || false);
      if (out[email].primitive !== true) out[email].primitive = /\@[a-z0-9-]+\.primitive\.email/i.test(email);
    }
    found.push(record);
  }, CONCURRENT);

  saveOut(out);
  stats.found_this_run = found.length;
  stats.total_emails = Object.keys(out).length;
  stats.total_primitive = Object.values(out).filter((r) => r.primitive).length;
  stats.ran_at = started;
  stats.candidates_total = candidates.length;
  stats.scanned_this_run = stats.scanned;

  const outStr = isJson
    ? JSON.stringify(stats, null, 2)
    : `primitive-hunt: scanned ${stats.scanned} this run (${stats.x402_manifest} had x402 manifest, ` +
      `${stats.with_contact_email} declared a contactEmail). ` +
      `${found.length} new contactEmail targets. Total tracked: ${stats.total_emails} (${stats.total_primitive} primitive.email).`;
  fs.writeFileSync("/tmp/primitive-hunt-result.json", outStr);
  console.log(outStr);
  return stats;
}

const isMain = typeof require !== 'undefined' && require.main === module;
const isDirect = (typeof process !== 'undefined' && typeof __filename !== 'undefined' && process.argv[1] && process.argv[1] === __filename);
console.error('DEBUG: isMain=%s isDirect=%s argv1=%s __filename=%s', isMain, isDirect, process.argv[1], typeof __filename, __filename);
if (isMain || isDirect) {
  main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
}
module.exports = { extractEmails, httpGetFull };
