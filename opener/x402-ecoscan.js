#!/usr/bin/env node
/**
 * x402-ecoscan.js — comprehensive x402 ecosystem Nano survey.
 *
 * Sources:
 *   1. x402-list.com API — 735+ services, each with base_url and metadata
 *   2. Cross-references against our openings.db for known Nano addresses
 *   3. Probes /.well-known/x402 on each candidate domain for Nano support
 *   4. Checks base_url + "/.well-known/agent.json" for A2A agent cards
 *
 * Goal: Find every x402 ecosystem service/agent that does NOT have Nano,
 * and output a prioritized list for account opening.
 *
 * Usage:
 *   node x402-ecoscan.js                           # full scan, print report
 *   node x402-ecoscan.js --save                    # save report to sources/
 *   node x402-ecoscan.js --top 10                  # only top N by buyers
 *   node x402-ecoscan.js --json                    # machine-readable JSON
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const FETCH_TIMEOUT = 10000;
const PROBE_TIMEOUT = 8000;
const RATE_LIMIT_MS = 500;     // polite delay between probes
const CONCURRENT = 5;           // how many probes at once

// Our known Nano services — these already have opened accounts
const KNOWN_NANO_SERVICES = new Set([
  // From our openings DB + known x402 Nano services
  nanoHostname("feeless402.com"),
  nanoHostname("nano-gpt.com"),
  nanoHostname("subnano.me"),
  nanoHostname("pursekeeper.dev"),
  nanoHostname("api.shehriyar.ink"),
]);

function nanoHostname(urlStr) {
  try { return new URL(urlStr.startsWith("http") ? urlStr : "https://" + urlStr).hostname; } 
  catch { return urlStr; }
}

function fetchUrl(url, timeoutMs = FETCH_TIMEOUT) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const t = setTimeout(() => { ctl.abort(); resolve({ status: 0, body: "", error: "timeout" }); }, timeoutMs);
    const mod = url.startsWith("https") ? https : http;
    try {
      const req = mod.request(url, {
        signal: ctl.signal,
        method: "GET",
        headers: { "User-Agent": "unstuck-x402-ecoscan/1.0", Accept: "application/json,text/plain,*/*" },
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; if (data.length > 20000) req.destroy(); });
        res.on("end", () => { clearTimeout(t); resolve({ status: res.statusCode, headers: res.headers, body: data, error: null }); });
      });
      req.on("error", (e) => { clearTimeout(t); resolve({ status: 0, body: "", error: e.message }); });
      req.end();
    } catch (e) {
      clearTimeout(t);
      resolve({ status: 0, body: "", error: e.message });
    }
  });
}

/**
 * Probe a service's base URL for Nano presence.
 */
async function probeService(item) {
  const baseUrl = item.base_url || item.baseUrl || item.url || "";
  const slug = item.slug || "";
  const name = item.name || slug;
  
  let domain = "";
  let origin = "";
  try {
    const u = new URL(baseUrl.startsWith("http") ? baseUrl : "https://" + baseUrl);
    domain = u.hostname;
    origin = u.origin;
  } catch {
    return { ...item, domain: "?", reachable: false, hasNano: false, error: "invalid-url" };
  }

  // Skip known Nano services
  if (KNOWN_NANO_SERVICES.has(domain)) {
    return { ...item, domain, reachable: true, hasNano: true, knownNano: true, notes: ["Known Nano service - already opened"] };
  }

  const result = { ...item, domain, reachable: false, hasNano: false, hasWellKnownX402: false, hasAgentJson: false, notes: [] };

  // Try the base URL first to see if it's reachable
  const baseResp = await fetchUrl(origin, PROBE_TIMEOUT);
  result.reachable = baseResp.status > 0;

  if (!result.reachable) {
    result.notes.push(`Unreachable (${baseResp.error || "no response"})`);
    return result;
  }

  // Probe /.well-known/x402
  const wkUrl = `${origin}/.well-known/x402`;
  const wkResp = await fetchUrl(wkUrl, PROBE_TIMEOUT);
  if (wkResp.status === 200 || wkResp.status === 402) {
    result.hasWellKnownX402 = true;
    const bodyLower = wkResp.body.toLowerCase();
    if (bodyLower.includes("nano") || bodyLower.includes("xno") || bodyLower.includes("nano:")) {
      result.hasNano = true;
      result.nanoSource = ".well-known/x402";
      result.notes.push("Nano found in /.well-known/x402");
    } else if (bodyLower.includes("usdc")) {
      result.nanoSource = "usdc";
      result.notes.push("USDC (not Nano) in /.well-known/x402");
    } else {
      result.notes.push("x402 endpoint found but no Nano/USDC advertised");
    }
  } else if (wkResp.status !== 0) {
    result.notes.push(`/.well-known/x402: HTTP ${wkResp.status}`);
  }

  // Probe /.well-known/agent.json (A2A)
  const ajUrl = `${origin}/.well-known/agent.json`;
  const ajResp = await fetchUrl(ajUrl, PROBE_TIMEOUT);
  if (ajResp.status === 200) {
    result.hasAgentJson = true;
    const bodyLower = ajResp.body.toLowerCase();
    if (bodyLower.includes("nano") || bodyLower.includes("xno")) {
      result.hasNano = true;
      result.nanoSource = "agent.json";
      result.notes.push("Nano found in agent.json");
    } else if (bodyLower.includes("x402") || bodyLower.includes("payment")) {
      result.notes.push("agent.json mentions payments (x402/USDC likely)");
    }
  }

  return result;
}

/**
 * Process candidates with concurrency control.
 */
async function probeBatch(candidates, concurrency = CONCURRENT) {
  const results = [];
  const queue = [...candidates];
  
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        const r = await probeService(item);
        results.push(r);
      } catch (e) {
        results.push({ ...item, domain: item.base_url || "?", reachable: false, hasNano: false, error: e.message });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const doSave = args.includes("--save");
  const jsonMode = args.includes("--json");
  const topN = args.includes("--top") ? parseInt(args[args.indexOf("--top") + 1], 10) : null;

  const outputDir = path.join(__dirname, "sources");
  if (doSave && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Load the x402 candidate list
  const candidatesPath = path.join(outputDir, "x402-candidates-614.json");
  let allCandidates = [];
  try {
    allCandidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
  } catch (e) {
    // Try fallback
    try {
      allCandidates = JSON.parse(fs.readFileSync("/tmp/x402-candidates.json", "utf8"));
    } catch (e2) {
      console.error(`Cannot load candidates: ${e.message}`);
      process.exit(1);
    }
  }

  console.error(`Loaded ${allCandidates.length} candidates`);

  // Apply top-N filter
  let toProbe = allCandidates;
  if (topN) {
    toProbe = allCandidates.slice(0, topN);
  }

  console.error(`Probing ${toProbe.length} services for Nano presence...`);

  const probed = await probeBatch(toProbe);

  // Categorize results
  const haveNano = probed.filter(r => r.hasNano);
  const usdcOnly = probed.filter(r => r.reachable && !r.hasNano);
  const unreachable = probed.filter(r => !r.reachable);

  console.error(`\n=== ECOSYSTEM NANO SURVEY RESULTS ===`);
  console.error(`Total probed: ${probed.length}`);
  console.error(`Have Nano: ${haveNano.length}`);
  for (const r of haveNano) {
    console.error(`  [NANO] ${r.name} (${r.domain}) — ${r.notes.join("; ")}`);
  }
  console.error(`\nUSDC-only (reachable, no Nano): ${usdcOnly.length}`);
  console.error(`Unreachable: ${unreachable.length}`);

  // Build the output report
  const report = {
    generatedAt: new Date().toISOString(),
    source: "x402-list.com API",
    totalServices: allCandidates.length,
    probed: probed.length,
    summary: {
      haveNano: haveNano.length,
      usdcOnly: usdcOnly.length,
      unreachable: unreachable.length,
    },
    nanoServices: haveNano.map(r => ({
      name: r.name,
      domain: r.domain,
      base_url: r.base_url || r.baseUrl,
      source: r.nanoSource,
      notes: r.notes,
    })),
    usdcServices: usdcOnly.map(r => ({
      name: r.name,
      slug: r.slug,
      domain: r.domain,
      base_url: r.base_url || r.baseUrl,
      category: r.category,
      buyers_30d: r.buyers_30d || 0,
      volume_30d: r.volume_30d || 0,
      hasAgentJson: r.hasAgentJson,
      hasWellKnownX402: r.hasWellKnownX402,
      notes: r.notes,
    })),
    unreachableServices: unreachable.map(r => ({
      name: r.name,
      slug: r.slug,
      domain: r.domain,
      base_url: r.base_url || r.baseUrl,
      error: r.error,
    })),
  };

  if (doSave || jsonMode) {
    const outPath = path.join(outputDir, "ecoscan-report.json");
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.error(`\nSaved full report to sources/ecoscan-report.json`);
  }

  if (jsonMode) {
    // Compact JSON for machine consumption
    const compact = {
      totalProbed: probed.length,
      haveNano: haveNano.length,
      usdcOnly: usdcOnly.length,
      topCandidates: usdcOnly.slice(0, 50).map(r => ({
        name: r.name,
        domain: r.domain,
        url: r.base_url || r.baseUrl,
        buyers: r.buyers_30d || 0,
        volume: r.volume_30d || 0,
        category: r.category || "",
      })),
    };
    console.log(JSON.stringify(compact));
  }

  return report;
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});