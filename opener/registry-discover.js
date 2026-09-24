#!/usr/bin/env node
/**
 * registry-discover.js — discover agents from public registries and probe for Nano.
 *
 * Sources:
 *   1. Agents.NET API (free, no auth) — 82 agents with apiEndpoint URLs
 *   2. AgentRolodex (A2A directory) — 35 A2A agent listings
 *   3. Additional registries as discovered
 *
 * For each agent, probes for Nano presence:
 *   - /.well-known/x402 (standard x402 manifest)
 *   - /.well-known/agent.json (A2A agent card — may list payment options)
 *   - Checks against our openings DB for known addresses
 *
 * Output: JSON with agents that DON'T have Nano — candidates to open accounts for.
 *
 * Usage:
 *   node registry-discover.js                         # full run, print to stdout
 *   node registry-discover.js --save                  # save to opener/sources/
 *   node registry-discover.js --source agents-net      # only Agents.NET
 *   node registry-discover.js --source agents-net --json-compact
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const FETCH_TIMEOUT = 10000;
const PROBE_TIMEOUT = 8000;

// Known Nano addresses from our DB — to cross-reference
let knownNanoAddrs = new Set();
try {
  const o = require("./openings.js");
  const dbPath = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
  const db = o.open(dbPath);
  const entries = o.opened(db);
  for (const e of entries) {
    knownNanoAddrs.add(e.address);
  }
} catch (e) {
  // no DB available; proceed without cross-ref
}

// Known Nano-accepting services — skip probing these
const KNOWN_NANO_SERVICES = new Set([
  "feeless402.com", "nano-gpt.com", "subnano.me", "pursekeeper.dev",
  "api.shehriyar.ink", "nano-courier-x402.vercel.app",
  "feed-weight-check.jackharney1360.chatgpt.site",
  "contract-lens-nano.dev-romanv.chatgpt.site",
  "nanogpt.com",
]);

function fetchUrl(url, timeoutMs = FETCH_TIMEOUT) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const t = setTimeout(() => { ctl.abort(); resolve({ status: 0, body: "", error: "timeout" }); }, timeoutMs);
    const mod = url.startsWith("https") ? https : http;
    try {
      const req = mod.request(url, {
        signal: ctl.signal,
        method: "GET",
        headers: { "User-Agent": "unstuck-discover/1.0", Accept: "application/json,text/plain,*/*" },
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; if (data.length > 50000) { req.destroy(); } });
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
 * Extract the origin from a URL for probing well-known paths.
 */
function extractOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
  } catch { return null; }
}

/**
 * Probe a single domain for Nano payment support.
 */
async function probeDomain(domain, origin) {
  const result = {
    domain,
    hasNanoWellKnown: false,
    hasNanoAgentJson: false,
    hasKnownNanoAddr: false,
    knownNanoAddr: null,
    reachable: false,
    wellKnownBody: null,
    agentJsonBody: null,
    notes: [],
  };

  // Check if domain is a known Nano service
  const domainLower = domain.toLowerCase();
  for (const known of KNOWN_NANO_SERVICES) {
    if (domainLower.includes(known) || known.includes(domainLower)) {
      result.hasKnownNanoAddr = true;
      result.knownNanoAddr = `known-service:${known}`;
      result.notes.push(`Known Nano service: ${known}`);
      return result;
    }
  }

  // Probe /.well-known/x402
  const wkUrl = `${origin}/.well-known/x402`;
  const wkResp = await fetchUrl(wkUrl, PROBE_TIMEOUT);
  result.reachable = wkResp.status > 0;

  if (wkResp.status === 200 || wkResp.status === 402) {
    result.wellKnownBody = wkResp.body.substring(0, 2000);
    // Check for Nano in the response
    const bodyLower = wkResp.body.toLowerCase();
    if (bodyLower.includes("nano") || bodyLower.includes("xno")) {
      result.hasNanoWellKnown = true;
      result.notes.push("Nano found in /.well-known/x402");
    } else if (bodyLower.includes("usdc")) {
      result.notes.push("USDC (not Nano) in /.well-known/x402");
    }
  } else if (wkResp.status !== 0) {
    result.notes.push(`/.well-known/x402 responded ${wkResp.status}`);
  }

  // Probe /.well-known/agent.json (A2A agent card)
  const ajUrl = `${origin}/.well-known/agent.json`;
  const ajResp = await fetchUrl(ajUrl, PROBE_TIMEOUT);

  if (ajResp.status === 200) {
    result.agentJsonBody = ajResp.body.substring(0, 2000);
    const bodyLower = ajResp.body.toLowerCase();
    if (bodyLower.includes("nano") || bodyLower.includes("xno")) {
      result.hasNanoAgentJson = true;
      result.notes.push("Nano found in /.well-known/agent.json");
    } else if (bodyLower.includes("x402") || bodyLower.includes("usdc")) {
      result.notes.push("x402/USDC (not Nano) in /.well-known/agent.json");
    }
  }

  return result;
}

/**
 * Fetch all agents from Agents.NET.
 */
async function fetchAgentsNet() {
  const url = "https://agents.net/api/agents?limit=100";
  const resp = await fetchUrl(url);

  if (resp.status !== 200) {
    console.error(`Agents.NET API returned ${resp.status}: ${resp.error}`);
    return [];
  }

  try {
    const data = JSON.parse(resp.body);
    return data.agents || [];
  } catch (e) {
    console.error("Failed to parse Agents.NET response:", e.message);
    return [];
  }
}

/**
 * Main discovery pipeline.
 */
async function main() {
  const args = process.argv.slice(2);
  const doSave = args.includes("--save");
  const sourceFilter = args.includes("--source") ? args[args.indexOf("--source") + 1] : null;
  const compact = args.includes("--json-compact");

  const outputDir = path.join(__dirname, "sources");
  if (doSave && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = {};

  // --- Source 1: Agents.NET ---
  if (!sourceFilter || sourceFilter === "agents-net") {
    console.error("Fetching Agents.NET...");
    const agents = await fetchAgentsNet();
    console.error(`  Found ${agents.length} agents`);

    // For each agent, extract domain and probe for Nano
    const probeResults = [];
    for (const agent of agents) {
      const ep = agent.apiEndpoint;
      if (!ep) continue;

      const origin = extractOrigin(ep);
      if (!origin) continue;

      const domain = new URL(ep).hostname;

      console.error(`  Probing [${agent.id}] ${agent.name} (${domain})...`);
      const probeResult = await probeDomain(domain, origin);

      probeResult.agentId = agent.id;
      probeResult.agentName = agent.name;
      probeResult.category = agent.category;
      probeResult.platform = agent.platform;
      probeResult.apiEndpoint = ep;
      probeResult.submittedAt = agent.submittedAt;

      probeResults.push(probeResult);
    }

    results["agents-net"] = {
      total: agents.length,
      probed: probeResults.length,
      agents: probeResults,
    };

    // Save raw agents data
    if (doSave) {
      fs.writeFileSync(path.join(outputDir, "agents-net-raw.json"), JSON.stringify(agents, null, 2));
      console.error(`  Saved raw data to sources/agents-net-raw.json`);
    }
  }

  // --- Source 2: AgentRolodex (direct fetch of the page) ---
  if (!sourceFilter || sourceFilter === "agentrolodex") {
    console.error("Fetching AgentRolodex...");
    // AgentRolodex doesn't have a public API yet — would need web scraping
    // For now, record as a future source
    results["agentrolodex"] = {
      status: "web-scrape-required",
      url: "https://agentrolodex.com/",
      note: "No public API. 35 total listings (26 agents, 9 services). Requires web scraping.",
    };
  }

  // --- Summary ---
  const allProbed = [];
  for (const [source, data] of Object.entries(results)) {
    if (data.agents) {
      allProbed.push(...data.agents.map(a => ({ source, ...a })));
    }
  }

  console.error("\n=== Results ===");
  console.error(`Total probed: ${allProbed.length}`);

  // Agents that DO have Nano
  const haveNano = allProbed.filter(a => a.hasNanoWellKnown || a.hasNanoAgentJson || a.hasKnownNanoAddr);
  console.error(`Have Nano: ${haveNano.length}`);
  for (const a of haveNano) {
    console.error(`  [${a.agentId}] ${a.agentName} — ${a.domain}`);
  }

  // Agents that DON'T have Nano (but are reachable) — these are opening candidates
  const noNano = allProbed.filter(a => !a.hasNanoWellKnown && !a.hasNanoAgentJson && !a.hasKnownNanoAddr && a.reachable);
  console.error(`\nNo Nano (reachable): ${noNano.length}`);
  for (const a of noNano) {
    console.error(`  [${a.agentId}] ${a.agentName} — ${a.domain} (${a.category})`);
  }

  // Unreachable
  const unreachable = allProbed.filter(a => !a.reachable);
  console.error(`\nUnreachable: ${unreachable.length}`);

  // Save opening candidates
  const candidates = noNano.map(a => ({
    source: a.source,
    agentId: a.agentId,
    agentName: a.agentName,
    category: a.category,
    platform: a.platform,
    apiEndpoint: a.apiEndpoint,
    domain: a.domain,
    notes: a.notes,
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalProbed: allProbed.length,
      hasNano: haveNano.length,
      noNano: noNano.length,
      unreachable: unreachable.length,
    },
    haveNano: haveNano.map(a => ({
      agentId: a.agentId,
      agentName: a.agentName,
      domain: a.domain,
      how: a.notes,
    })),
    candidates,
    sources: results,
  };

  if (doSave) {
    const outPath = path.join(outputDir, "registry-candidates.json");
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.error(`\nSaved full results to sources/registry-candidates.json`);
  }

  if (compact) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

main().catch(e => {
  console.error("Fatal:", e.message);
  process.exit(1);
});