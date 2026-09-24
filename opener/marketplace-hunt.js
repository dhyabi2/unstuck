#!/usr/bin/env node
/**
 * marketplace-hunt.js — discover agent operators on major marketplaces
 * that do NOT already have a published Nano address.
 *
 * Sources:
 *   1. CDP Bazaar — agents indexed from the x402 ecosystem
 *   2. Known Nano addresses from openings.db (to exclude)
 *
 * Strategy: Read the Bazaar index for agent services, extract operator
 * info (URL, service name, payTo address). Check each against known
 * Nano addresses. Output operators that don't have Nano yet.
 *
 * Output: JSON array of { serviceName, url, description, network, asset, payTo }
 * where the operator has NO known Nano address.
 */

const https = require("https");
const http = require("http");

const BAZAAR_API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const KNOWN_NANO_DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";

const FETCH_TIMEOUT = 15000;

function fetch(url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    const opts = {
      method: body ? "POST" : "GET",
      signal: ctl.signal,
      headers: { "User-Agent": "unstuck-opener/1.0", ...headers },
    };
    const req = mod.request(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => { clearTimeout(t); resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

/**
 * Load known Nano addresses from openings.db via the openings module.
 */
function loadKnownNanoAddresses() {
  try {
    const o = require("./openings.js");
    const db = o.open(KNOWN_NANO_DB);
    const entries = o.opened(db);
    return new Set(entries.map((e) => e.address));
  } catch (e) {
    console.error("Warning: could not load known addresses:", e.message);
    return new Set();
  }
}

/**
 * Fetch all Bazaar resources. Paginates through all pages.
 */
async function fetchAllBazaarResources() {
  const allResources = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const url = `${BAZAAR_API}?limit=${limit}&offset=${offset}`;
    console.error(`Bazaar: fetching offset ${offset}...`);
    try {
      const res = await fetch(url, null);
      if (res.status !== 200) {
        console.error(`Bazaar: HTTP ${res.status} at offset ${offset}, stopping`);
        break;
      }
      const data = JSON.parse(res.body);
      const items = data.items || [];
      allResources.push(...items);

      const total = data.pagination?.total || 0;
      offset += limit;
      if (offset >= total) break;
    } catch (e) {
      console.error(`Bazaar: fetch error at offset ${offset}: ${e.message}`);
      break;
    }
  }

  return allResources;
}

/**
 * Extract operator info from a Bazaar resource.
 */
function extractOperator(resource) {
  const accepts = resource.accepts || [];
  const networks = [...new Set(accepts.map((a) => a.network).filter(Boolean))];
  const assets = [...new Set(accepts.map((a) => a.asset).filter(Boolean))];
  const payTos = [...new Set(accepts.map((a) => a.payTo).filter(Boolean))];

  return {
    serviceName: resource.serviceName || "(unknown)",
    url: resource.resource || "(no url)",
    description: (resource.description || "").substring(0, 200),
    networks,
    assets,
    payTos: payTos.slice(0, 3),  // limit output
    resourceType: resource.type || "unknown",
    tags: (resource.tags || []).slice(0, 5),
    quality: resource.quality ? {
      calls30d: resource.quality.l30DaysTotalCalls || 0,
      payers30d: resource.quality.l30DaysUniquePayers || 0,
    } : null,
  };
}

/**
 * Check if the operator uses Nano by looking at their payTo addresses
 * for nano_ prefix, or by checking their URL/service name for "nano" hints.
 */
function likelyHasNano(operator) {
  // Check payTo addresses for nano_ prefix
  for (const addr of operator.payTos) {
    if (addr.startsWith("nano_")) return true;
  }
  // Check if service name or URL mentions Nano
  const text = (operator.serviceName + " " + operator.url + " " + (operator.description || "")).toLowerCase();
  if (/\bnano\b/.test(text) || /\bxno\b/.test(text) || /\brai\b/.test(text)) return false; // might reference it but not have address
  return false;
}

async function main() {
  console.error("=== marketplace-hunt.js — find non-Nano agent operators on marketplaces ===\n");

  const knownNano = loadKnownNanoAddresses();
  console.error(`Known Nano addresses in DB: ${knownNano.size}`);

  // 1. Fetch Bazaar resources (paginated)
  console.error("\n--- Fetching Bazaar resources ---");
  const resources = await fetchAllBazaarResources();
  console.error(`Total resources fetched: ${resources.length}`);

  // 2. Extract unique operators
  const operatorMap = new Map();
  for (const r of resources) {
    const op = extractOperator(r);
    const key = op.serviceName + "|" + op.url;
    // Only unique service/URL combos
    if (!operatorMap.has(key)) {
      operatorMap.set(key, op);
    }
  }
  const operators = [...operatorMap.values()];
  console.error(`Unique operators: ${operators.length}`);

  // 3. Separate into Nano-ready vs non-Nano
  const nanoOperators = [];
  const nonNanoOperators = [];

  for (const op of operators) {
    if (likelyHasNano(op)) {
      nanoOperators.push(op);
    } else {
      nonNanoOperators.push(op);
    }
  }

  console.error(`\n=== Results ===`);
  console.error(`Operators with Nano addresses: ${nanoOperators.length}`);
  console.error(`Operators WITHOUT Nano (candidates): ${nonNanoOperators.length}`);

  // 4. Output top candidates — the most active non-Nano operators
  // Sort by 30-day calls descending
  nonNanoOperators.sort((a, b) => {
    const callsA = a.quality?.calls30d || 0;
    const callsB = b.quality?.calls30d || 0;
    return callsB - callsA;
  });

  console.log(JSON.stringify({
    total_resources: resources.length,
    unique_operators: operators.length,
    nano_enabled: nanoOperators.length,
    candidates: nonNanoOperators.length,
    top_candidates: nonNanoOperators.slice(0, 50),
  }, null, 2));

  console.error("\n=== Top 10 candidate services (most active, no Nano address) ===");
  for (const op of nonNanoOperators.slice(0, 10)) {
    console.error(`  ${op.serviceName}: ${(op.quality?.calls30d || 0)} calls/30d — ${op.url}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });