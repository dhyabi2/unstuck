#!/usr/bin/env node
/**
 * probe-for-nano.js — probe non-Nano x402 operators for any Nano presence.
 *
 * For each operator domain from the Bazaar, check:
 *   1. /.well-known/x402 (does it have a Nano accept?)
 *   2. /llms.txt (does it mention Nano?)
 *   3. Does the operator have a known Nano address in our DB?
 *
 * Output: operators that DON'T have Nano — these are candidates to open accounts for.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");

const FETCH_TIMEOUT = 8000;
const knownNanoAddrs = new Set();

// Known Nano addresses from our DB
const DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
try {
  const o = require("./openings.js");
  const db = o.open(DB);
  const entries = o.opened(db);
  for (const e of entries) {
    knownNanoAddrs.add(e.address);
  }
} catch (e) {
  console.error("Warning: could not load known addresses:", e.message);
}

// Also add the known Nano addresses from the x402 ecosystem that we've already probed
const KNOWN_NANO_SERVICES = new Set([
  "feeless402.com", "nano-gpt.com", "subnano.me", "pursekeeper.dev",
  "api.shehriyar.ink", "nano-courier-x402.vercel.app",
  "feed-weight-check.jackharney1360.chatgpt.site",
  "contract-lens-nano.dev-romanv.chatgpt.site",
]);

function fetchUrl(url, timeoutMs = FETCH_TIMEOUT) {
  return new Promise((resolve) => {
    const ctl = new AbortController();
    const t = setTimeout(() => { ctl.abort(); resolve({ status: 0, body: "", error: "timeout" }); }, timeoutMs);
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(url, { signal: ctl.signal, method: "GET",
      headers: { "User-Agent": "unstook/1.0", Accept: "application/json,text/plain" },
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; if (data.length > 50000) { req.destroy(); } });
      res.on("end", () => { clearTimeout(t); resolve({ status: res.statusCode, body: data, error: null }); });
    });
    req.on("error", (e) => { clearTimeout(t); resolve({ status: 0, body: "", error: e.message }); });
    req.end();
  });
}

/**
 * Check a domain for Nano presence.
 * Returns: { domain, hasNanoWellKnown, hasNanoLlmsTxt, hasNanoInDb, notes }
 */
async function checkDomain(domain, operatorName) {
  const result = { domain, operator: operatorName, hasNanoAnywhere: false, sources: [] };

  // Check 1: /.well-known/x402 — the x402 machine-readable payment manifest
  const wkRes = await fetchUrl(`https://${domain}/.well-known/x402`);
  if (wkRes.status === 200) {
    try {
      const body = JSON.parse(wkRes.body);
      const accepts = body.accepts || [];
      for (const a of accepts) {
        if (a.scheme === "nano" || a.network === "nano:mainnet" || (a.payTo || "").startsWith("nano_")) {
          result.hasNanoAnywhere = true;
          result.sources.push({ type: "well-known-x402-accept", data: a });
        }
      }
      // Also check deep in payment structures
      const payment = body.payment;
      if (payment && payment.accepted) {
        for (const a of payment.accepted) {
          if ((a.scheme || "").startsWith("nano") || (a.payTo || "").startsWith("nano_")) {
            result.hasNanoAnywhere = true;
            result.sources.push({ type: "well-known-x402-payment", data: a });
          }
        }
      }
    } catch (e) {
      // Non-JSON response or no body
    }
  } else if (wkRes.status === 402) {
    // 402 response might contain a Nano accept even without /.well-known
    try {
      const body = JSON.parse(wkRes.body);
      const accepts = body.accepts || [];
      for (const a of accepts) {
        if (a.network === "nano:mainnet" || (a.payTo || "").startsWith("nano_")) {
          result.hasNanoAnywhere = true;
          result.sources.push({ type: "402-response-accept", data: a });
        }
      }
    } catch (e) {}
  }

  // Check 2: /llms.txt
  const llmsRes = await fetchUrl(`https://${domain}/llms.txt`);
  if (llmsRes.status === 200) {
    const body = llmsRes.body.toLowerCase();
    if (/\bnano\b/.test(body) || /\bxno\b/.test(body) || /\brai\b/.test(body) || /nano_/.test(body)) {
      // Extract the exact nano addresses
      const matches = llmsRes.body.match(/nano_[13456789abcdefghijkmnopqrstuwxyz]{60}/g);
      if (matches) {
        result.hasNanoAnywhere = true;
        result.sources.push({ type: "llms-txt-address", addresses: matches });
      } else if (/\bnano\b/.test(body) || /\bxno\b/.test(body)) {
        // Mentions Nano but no addresses
        result.sources.push({ type: "llms-txt-mention" });
      }
    }
  }

  return result;
}

/**
 * Extract domain from a URL.
 */
function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * The operators we want to probe, extracted from the Bazaar data.
 * These are actual service operators (not auto-indexed ones like "unnamed").
 */
const OPERATORS = [
  // High-activity operators from the Bazaar
  { name: "StableEnrich", domain: "stableenrich.dev" },
  { name: "StableUpload", domain: "stableupload.dev" },
  { name: "StableStudio", domain: "stablestudio.dev" },
  { name: "StableTravel", domain: "stabletravel.dev" },
  { name: "Exa", domain: "api.exa.ai" },
  { name: "Kronos Crypto", domain: "kronossignals.com" },
  { name: "Otto AI", domain: "x402.ottoai.services" },
  { name: "Apify", domain: "agi.apify.com" },
  { name: "Laso Finance", domain: "laso.finance" },
  { name: "CheapTokens AI", domain: "cheaptokens.ai" },
  { name: "ApiToll", domain: "crypto.apitoll.cloud" },
  { name: "Bitrefill", domain: "api.bitrefill.com" },
  { name: "Vibe Springs", domain: "vibesprings.net" },
  { name: "Rubric Protocol", domain: "rubric-protocol.com" },
  { name: "Agentic Reservations", domain: "agentres.dev" },
  { name: "SatsSignal", domain: "srv1334799.hstgr.cloud" },
  { name: "BlockRun.AI", domain: "blockrun.ai" },
  { name: "Bazaar MCP (402.com.tr)", domain: "402.com.tr" },
  { name: "Nansen", domain: "api.nansen.ai" },
  { name: "Vaaya", domain: "vaaya.ai" },
  { name: "Arkham", domain: "api.arkm.com" },
  { name: "ReadX", domain: "readx.sh" },
  { name: "AgentOracle", domain: "aiagentoracle.ai" },
  { name: "AgentWire", domain: "cdp-agent-0-01.onrender.com" },
  { name: "AiSpace", domain: "x402.aispace.bot" },
  { name: "3Route", domain: "3route.agents.bakingbad.dev" },
  { name: "x402atlas", domain: "use.x402atlas.com" }, // the atlas gateway
  { name: "NodeFlare", domain: "rpc.nodeflare.app" },
  { name: "Browser Use", domain: "api.browser-use.com" },
  { name: "glim.sh", domain: "glim.sh" },
  { name: "Satellite & GeoRisk", domain: "sat.ipintel.ai" },
  { name: "Mercer x402", domain: "x402.lucidcove.org" },
  { name: "TWZRD", domain: "intel.twzrd.xyz" },
  { name: "IXS", domain: "api-dev-v2.ixs.finance" },
  { name: "BAGS Agent", domain: "www.getbags.app" },
  { name: "LION Verified", domain: "lionx402.com" },
  { name: "Ozmium", domain: "ozmium.org" },
  { name: "RobinX", domain: "api.robinx.io" },
  // New: Nano-adjacent projects found in research
  { name: "Nano Empire", domain: "nano-empire-mcp-1064490927432.us-central1.run.app" },
  { name: "Nano Empire AI site", domain: "nanoempireai.com" },
  // Onesource — the largest operator by volume
  { name: "OneSource", domain: "api.onesource.io" },
];

async function main() {
  console.error("=== probe-for-nano.js — probe non-Nano x402 operators for Nano presence ===\n");

  const results = [];

  for (const op of OPERATORS) {
    process.stderr.write(`Checking ${op.domain} (${op.name})... `);
    try {
      const r = await checkDomain(op.domain, op.name);
      results.push(r);
      process.stderr.write(r.hasNanoAnywhere ? "HAS NANO\n" : "no Nano\n");
    } catch (e) {
      process.stderr.write(`error: ${e.message}\n`);
    }
  }

  // Separate
  const withNano = results.filter(r => r.hasNanoAnywhere);
  const withoutNano = results.filter(r => !r.hasNanoAnywhere);

  console.error(`\n=== Results ===`);
  console.error(`Probed: ${results.length} operators`);
  console.error(`Has Nano somewhere: ${withNano.length}`);
  console.error(`NO Nano (candidates): ${withoutNano.length}`);

  if (withNano.length > 0) {
    console.error(`\n--- Operators with Nano presence ---`);
    for (const r of withNano) {
      console.error(`  ${r.operator} (${r.domain}): ${JSON.stringify(r.sources)}`);
    }
  }

  console.error(`\n--- Operators without Nano (candidates) ---`);
  for (const r of withoutNano) {
    console.error(`  ${r.operator} (${r.domain})`);
  }

  // Output full results as JSON
  console.log(JSON.stringify({
    total_probed: results.length,
    with_nano: withNano.length,
    without_nano: withoutNano.length,
    nano_operators: withNano.map(r => ({ operator: r.operator, domain: r.domain, sources: r.sources })),
    candidate_operators: withoutNano.map(r => ({ operator: r.operator, domain: r.domain })),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });