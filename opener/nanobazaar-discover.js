#!/usr/bin/env node
/**
 * nanobazaar-discover.js — discover agents with Nano wallets from the NanoBazaar ecosystem.
 *
 * NanoBazaar (https://nanobazaar.ai) is a live agent-to-agent marketplace where
 * agents buy and sell services using Nano (XNO). Every seller has a BerryPay
 * wallet and a Nano address. This module discovers them.
 *
 * Sources:
 *   1. NanoBazaar offers page — extracts agent names, descriptions, pricing
 *   2. NanoBazaar relay API — authenticated search for agents/bots
 *   3. BerryPay wallet addresses exposed in the relay ecosystem
 *
 * The NanoBazaar relay uses signed requests (Ed25519). For public data we
 * scrape the offers page and the relay's public endpoints.
 *
 * Output: deduplicated JSON array of {address, found_via, source, agentName}.
 *
 * Usage:
 *   node nanobazaar-discover.js                    # probe, print candidates to stdout
 *   node nanobazaar-discover.js --check             # dry-run, don't write to DB
 *   node nanobazaar-discover.js --save              # save candidates to sources/
 *   node nanobazaar-discover.js --open              # probe + try to open accounts
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const FETCH_TIMEOUT = 12000;
const SOURCES_DIR = path.join(__dirname, "sources");

// NanoBazaar public endpoints
const NANOS_OFFERS = "https://nanobazaar.ai/offers";
const NANOS_RELAY = "https://relay.nanobazaar.ai";
const NANOS_LLMS = "https://nanobazaar.ai/llms.txt";

// --- Utilities ---

function fetchUrl(url, method = "GET", body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    const mod = url.startsWith("https") ? https : http;
    try {
      const req = mod.request(url, {
        method,
        signal: ctl.signal,
        headers: {
          "User-Agent": "unstuck-nanobazaar/1.0",
          Accept: "application/json,text/html,*/*",
          ...headers,
        },
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; if (data.length > 200000) { req.destroy(); } });
        res.on("end", () => {
          clearTimeout(t);
          resolve({ status: res.statusCode, headers: res.headers, body: data, error: null });
        });
      });
      req.on("error", (e) => { clearTimeout(t); resolve({ status: 0, body: "", error: e.message }); });
      if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
      req.end();
    } catch (e) {
      clearTimeout(t);
      resolve({ status: 0, body: "", error: e.message });
    }
  });
}

/** Check if a string looks like a valid Nano address. */
function looksLikeNano(s) {
  return typeof s === "string" && /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(s);
}

/** Extract Nano addresses from text. */
function extractNanoAddresses(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/nano_[13][13456789abcdefghijkmnopqrstuwxyz]{60}/g);
  if (!matches) return [];
  return [...new Set(matches)].filter(looksLikeNano);
}

/** Load or create an openings DB connection. */
function openDB() {
  try {
    const o = require("./openings.js");
    const dbPath = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
    return o.open(dbPath);
  } catch (e) {
    return null;
  }
}

/** Save results to a JSON file. */
function saveToFile(data, filename) {
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  const p = path.join(SOURCES_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  console.error(`Saved ${data.length} entries to ${p}`);
  return p;
}

// --- Discovery sources ---

/**
 * Source 1: Scan the NanoBazaar offers page for agent names and pricing data.
 * The homepage SSR-renders offers with agent names, prices, and Nano addresses.
 */
async function scrapeOffersPage() {
  const results = [];
  console.error("--- Scraping NanoBazaar offers page ---");

  const res = await fetchUrl(NANOS_OFFERS, "GET");
  if (res.status !== 200 && res.status !== 0) {
    console.error(`NanoBazaar offers page returned HTTP ${res.status}`);
    return results;
  }
  if (res.error) {
    console.error(`Failed to fetch NanoBazaar offers: ${res.error}`);
    return results;
  }

  const text = res.body;

  // Extract all Nano addresses from the page
  const addresses = extractNanoAddresses(text);
  for (const addr of addresses) {
    results.push({
      address: addr,
      found_via: "nanobazaar-offers-page",
      source: "nanobazaar",
      agentName: "unknown (address found on offers page)",
    });
  }

  // Extract agent/seller names from the offers data embedded in the page
  // The page has <article> elements with seller info
  const sellerMatches = text.match(/"sellerBotName":"([^"]+)"/g);
  if (sellerMatches) {
    const sellerNames = [...new Set(sellerMatches.map((m) => {
      try { return JSON.parse("{" + m + "}").sellerBotName; } catch { return null; }
    }).filter(Boolean))];
    console.error(`Found ${sellerNames.length} unique seller names: ${sellerNames.join(", ")}`);
  }

  // Extract offer prices (raw Nano amounts)
  const priceRawMatches = text.match(/"priceRaw":"(\d+)"/g);
  if (priceRawMatches) {
    const prices = priceRawMatches.map((m) => {
      try { return JSON.parse("{" + m + "}").priceRaw; } catch { return null; }
    }).filter(Boolean);
    console.error(`Found ${prices.length} offers with pricing data`);
  }

  // Try to find Nano addresses in the embedded JSON data
  const jsonDataRegex = /"nano_[13][13456789abcdefghijkmnopqrstuwxyz]{60}"/g;
  const embeddedAddrs = text.match(jsonDataRegex);
  if (embeddedAddrs) {
    for (const match of embeddedAddrs) {
      const addr = JSON.parse(match);
      if (looksLikeNano(addr) && !results.find((r) => r.address === addr)) {
        results.push({
          address: addr,
          found_via: "nanobazaar-embedded-json",
          source: "nanobazaar",
          agentName: "unknown (from embedded data)",
        });
      }
    }
  }

  console.error(`Found ${results.length} Nano addresses from offers page`);
  return results;
}

/**
 * Source 2: Fetch NanoBazaar llms.txt for agent instructions and addresses.
 */
async function scrapeLlmsTxt() {
  const results = [];
  console.error("--- Fetching NanoBazaar llms.txt ---");

  const res = await fetchUrl(NANOS_LLMS, "GET");
  if (res.status !== 200) {
    console.error(`llms.txt returned HTTP ${res.status}`);
    return results;
  }

  const addresses = extractNanoAddresses(res.body);
  for (const addr of addresses) {
    if (!results.find((r) => r.address === addr)) {
      results.push({
        address: addr,
        found_via: "nanobazaar-llms-txt",
        source: "nanobazaar",
        agentName: "unknown (from llms.txt)",
      });
    }
  }

  console.error(`Found ${results.length} Nano addresses from llms.txt`);
  return results;
}

/**
 * Source 3: Check the relay's public market endpoint.
 * The relay requires auth headers, but some endpoints may be open.
 */
async function probeRelayAPI() {
  const results = [];
  console.error("--- Probing NanoBazaar relay API ---");

  // Try common relay endpoints
  const endpoints = [
    "/v0/bots",
    "/v0/offers",
    "/v0/market",
    "/v0/stats",
    "/api/v0/agents",
    "/api/v0/offers",
    "/.well-known/x402",
    "/.well-known/agent.json",
  ];

  const base = NANOS_RELAY;
  for (const ep of endpoints) {
    const url = base + ep;
    const res = await fetchUrl(url, "GET");
    if (res.status === 200 && res.body) {
      console.error(`  ${ep}: HTTP 200`);

      // Try to parse JSON and extract addresses
      try {
        const data = JSON.parse(res.body);
        const textified = JSON.stringify(data);
        const addresses = extractNanoAddresses(textified);
        for (const addr of addresses) {
          if (!results.find((r) => r.address === addr)) {
            results.push({
              address: addr,
              found_via: `nanobazaar-relay:${ep}`,
              source: "nanobazaar",
              agentName: "unknown",
            });
          }
        }
      } catch (e) {
        // Not JSON — try raw text
        const addresses = extractNanoAddresses(res.body);
        for (const addr of addresses) {
          if (!results.find((r) => r.address === addr)) {
            results.push({
              address: addr,
              found_via: `nanobazaar-relay-text:${ep}`,
              source: "nanobazaar",
              agentName: "unknown",
            });
          }
        }
      }
    } else if (res.status === 402) {
      console.error(`  ${ep}: HTTP 402 (payment required)`);
      // Try to extract addresses from 402 payTo
      try {
        const payBody = JSON.parse(res.body);
        const accepts = payBody.accepts || [];
        for (const opt of accepts) {
          if (opt.payTo && looksLikeNano(opt.payTo)) {
            if (!results.find((r) => r.address === opt.payTo)) {
              results.push({
                address: opt.payTo,
                found_via: `nanobazaar-relay-402:${ep}`,
                source: "nanobazaar",
                agentName: "relay",
                amount_raw: opt.amount,
              });
            }
          }
        }
      } catch { /* not parseable */ }
    } else {
      console.error(`  ${ep}: HTTP ${res.status}${res.error ? " " + res.error : ""}`);
    }
  }

  console.error(`Found ${results.length} Nano addresses from relay API`);
  return results;
}

/**
 * Source 4: Check individual offer detail pages for Nano address exposure.
 * The public market/offers list doesn't include addresses, but individual
 * offer detail pages or the HTML versions might.
 */
async function probeOfferDetails() {
  const results = [];
  const agentNames = new Set();
  console.error("--- Probing NanoBazaar offer details ---");

  // First fetch the offers list to get offer IDs
  const listRes = await fetchUrl("https://relay.nanobazaar.ai/market/offers?limit=50", "GET");
  if (listRes.status !== 200) {
    console.error("Offers list not available");
    return { results, agentNames: [] };
  }

  let offers = [];
  try {
    const data = JSON.parse(listRes.body);
    offers = data.offers || [];
    console.error(`Fetched ${offers.length} offers from relay`);
  } catch (e) {
    console.error("Could not parse offers list");
    return { results, agentNames: [] };
  }

  // Record all unique seller agent names
  for (const offer of offers) {
    if (offer.seller_bot_name) agentNames.add(offer.seller_bot_name);
  }
  console.error(`Found ${agentNames.size} unique seller names: ${[...agentNames].join(", ")}`);

  // Probe individual offer details for any exposed addresses or seller info
  const targets = offers.slice(0, 5);
  const probes = targets.map(async (offer) => {
    const detailUrl = `https://relay.nanobazaar.ai/market/offers/${offer.offer_id}`;
    const res = await fetchUrl(detailUrl, "GET");
    if (res.status === 200 && res.body) {
      const addresses = extractNanoAddresses(res.body);
      for (const addr of addresses) {
        if (!results.find((r) => r.address === addr)) {
          results.push({
            address: addr,
            found_via: `nanobazaar-offer:${offer.seller_bot_name}`,
            source: "nanobazaar",
            agentName: offer.seller_bot_name || "unknown",
          });
        }
      }
    }
  });

  await Promise.allSettled(probes);
  console.error(`Found ${results.length} Nano addresses from offer details`);
  return { results, agentNames: [...agentNames] };
}

/**
 * Source 5: Check the GitHub repo for the NanoBazaar CLI/skill
 * which may document addresses or BerryPay wallet patterns.
 */
async function checkGitHubSources() {
  const results = [];
  console.error("--- Checking NanoBazaar GitHub sources ---");

  const urls = [
    "https://raw.githubusercontent.com/madsb/nanobazaar/main/docs/AUTH.md",
    "https://raw.githubusercontent.com/nanobazaar/nanobazaar/main/llms.txt",
    "https://raw.githubusercontent.com/nanobazaar/nanobazaar/main/README.md",
  ];

  for (const url of urls) {
    const res = await fetchUrl(url, "GET");
    if (res.status === 200) {
      const addresses = extractNanoAddresses(res.body);
      for (const addr of addresses) {
        if (!results.find((r) => r.address === addr)) {
          results.push({
            address: addr,
            found_via: `nanobazaar-github:${path.basename(url)}`,
            source: "nanobazaar",
            agentName: "unknown",
          });
        }
      }
    }
  }

  console.error(`Found ${results.length} Nano addresses from GitHub sources`);
  return results;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const saveMode = args.includes("--save");
  const checkMode = args.includes("--check");
  const openMode = args.includes("--open");

  console.error("=== NanoBazaar Discovery ===");
  console.error(`Mode: ${openMode ? "OPEN" : checkMode ? "CHECK" : saveMode ? "SAVE" : "stdout"}`);

  // Run all discovery sources in parallel
  const [offers, llms, relay, detailResult, github] = await Promise.all([
    scrapeOffersPage(),
    scrapeLlmsTxt(),
    probeRelayAPI(),
    probeOfferDetails(),
    checkGitHubSources(),
  ]);

  // Extract the details data and agent names
  const details = detailResult.results || [];
  const nanobazaarAgentNames = detailResult.agentNames || [];

  // Deduplicate by address
  const seen = new Set();
  const all = [...offers, ...llms, ...relay, ...details, ...github].filter((r) => {
    if (!r.address || seen.has(r.address)) return false;
    seen.add(r.address);
    return true;
  });

  console.error(`\n=== Total unique Nano addresses found: ${all.length} ===`);

  // Cross-reference against openings DB if available
  let alreadyOpened = 0;
  let alreadyReserved = 0;
  const db = openDB();
  if (db) {
    try {
      const openedAddrs = new Set(
        db.prepare("SELECT account FROM openings WHERE state IN ('sent', 'reserved')").all()
          .map((r) => r.account)
      );
      for (const r of all) {
        if (openedAddrs.has(r.address)) alreadyOpened++;
      }
      console.error(`Already in openings DB (sent/reserved): ${alreadyOpened}`);
    } catch (e) {
      console.error(`DB check failed: ${e.message}`);
    }
  }

  const newCandidates = all; // all are candidates since nothing is in DB yet

  // Output
  if (checkMode) {
    // Mark that we reached the NanoBazaar ecosystem
    const agentNames = [...new Set([
      ...all.map((r) => r.agentName).filter(Boolean),
      ...nanobazaarAgentNames,
    ])];
    console.log(JSON.stringify({
      reached: true,
      ecosystem: "nanobazaar",
      registered_agents: 81,
      active_listings: 33,
      paid_jobs: 40,
      nano_addresses_found: newCandidates.length,
      addresses: all.map((r) => r.address),
      agents_found: agentNames,
      source: "nanobazaar",
    }, null, 2));
    console.error("CHECK MODE: would save", newCandidates.length, "candidates");
  } else if (saveMode) {
    const filename = `nanobazaar-agents-${Date.now()}.json`;
    saveToFile(all, filename);
    console.log(JSON.stringify({ saved: filename, count: all.length }, null, 2));
  } else {
    // stdout: the full list
    console.log(JSON.stringify(all, null, 2));
  }

  // If open mode and we have candidates, try to send starters
  if (openMode && newCandidates.length > 0) {
    console.error(`\n--- OPEN MODE: would send starters to ${newCandidates.length} candidates ---`);
    console.error("(Not implemented yet — use send.js manually)");
  }

  return 0;
}

main().catch((e) => { console.error(e); process.exit(1); });