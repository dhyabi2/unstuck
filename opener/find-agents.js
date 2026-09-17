#!/usr/bin/env node
/**
 * find-agents.js — discover real agent Nano addresses from public sources.
 *
 * This reads from multiple public directories and x402 service indexes to find
 * agents that are demonstrably active in public. It outputs a deduplicated
 * JSON file of addresses that run.js can use.
 *
 * Sources:
 *   1. x402-list.com — all services that accept x402 payments
 *   2. pursekeeper.dev/sellers.json — agents accepting Nano
 *   3. Agent indices (Web3 agent directories)
 *
 * Output: stdout (JSON array of {address, found_via, source} objects)
 * Or to a file: node find-agents.js > sources/agent-addresses.json
 */

const https = require("https");
const http = require("http");

const FETCH_TIMEOUT = 15000;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    mod.get(url, { signal: ctl.signal }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; if (data.length > 200000) { res.destroy(); reject(new Error("response too large")); } });
      res.on("end", () => { clearTimeout(t); resolve(data); });
    }).on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function findNanoAddressesFromX402List() {
  try {
    const raw = await fetch("https://x402-list.com/api/v1/services?limit=1000&status=online");
    const data = JSON.parse(raw);
    const services = data.data || [];
    // x402 services don't typically expose Nano addresses in their listing,
    // but we record the service names as candidates
    return services.map((s) => ({
      name: s.name || s.service_name || s.slug,
      url: s.url,
      category: s.category,
    }));
  } catch (e) {
    console.error("Warning: x402-list fetch failed:", e.message);
    return [];
  }
}

async function findNanoPayAddresses() {
  const addresses = [];
  try {
    // Check feeless402.com faucet/premium for Nano addresses in the x402 ecosystem
    const raw = await fetch("https://feeless402.com/llms.txt");
    const text = raw;
    // Look for nano_ addresses in the text
    const matches = text.match(/nano_[13456789abcdefghijkmnopqrstuwxyz]{60}/g);
    if (matches) {
      for (const addr of matches) {
        addresses.push({
          address: addr,
          found_via: "feeless402.com llms.txt",
          source: "x402-ecosystem",
        });
      }
    }
  } catch (e) {
    console.error("Warning: feeless402.com fetch failed:", e.message);
  }
  return addresses;
}

async function findNanoGPTAddresses() {
  const addresses = [];
  try {
    const raw = await fetch("https://nano-gpt.com/llms.txt");
    const text = raw;
    const matches = text.match(/nano_[13456789abcdefghijkmnopqrstuwxyz]{60}/g);
    if (matches) {
      for (const addr of [...new Set(matches)]) {
        addresses.push({
          address: addr,
          found_via: "nano-gpt.com",
          source: "x402-ecosystem",
        });
      }
    }
  } catch (e) {
    console.error("Warning: nano-gpt.com fetch failed:", e.message);
  }
  return addresses;
}

async function findPursekeeperSellers() {
  const addresses = [];
  try {
    const raw = await fetch("https://pursekeeper.dev/sellers.json");
    const data = JSON.parse(raw);
    const sellers = data.sellers || data || [];
    // Sellers list doesn't contain Nano addresses directly, but we record them
    for (const s of sellers) {
      const name = s.name || s.id || "unknown";
      const endpoint = s.endpoint || "";
      addresses.push({
        address: null, // unknown address; we note the service
        found_via: `pursekeeper:${s.id || name}`,
        endpoint,
        source: "pursekeeper-ecosystem",
      });
    }
  } catch (e) {
    console.error("Warning: pursekeeper.dev fetch failed:", e.message);
  }
  return addresses;
}

async function main() {
  const sources = await Promise.allSettled([
    findNanoAddressesFromX402List(),
    findNanoPayAddresses(),
    findNanoGPTAddresses(),
  ]);

  const x402Services = sources[0].status === "fulfilled" ? sources[0].value : [];
  const nanoPayAddresses = sources[1].status === "fulfilled" ? sources[1].value : [];
  const nanoGPTAddresses = sources[2].status === "fulfilled" ? sources[2].value : [];

  console.error(`Sources: ${x402Services.length} x402 services, ${nanoPayAddresses.length} feeless402 addresses, ${nanoGPTAddresses.length} NanoGPT addresses`);

  // Output deduplicated addresses as JSON to stdout
  const all = [...nanoPayAddresses, ...nanoGPTAddresses];
  // Deduplicate by address
  const seen = new Set();
  const deduped = all.filter((a) => {
    if (!a.address || seen.has(a.address)) return false;
    seen.add(a.address);
    return true;
  });

  console.log(JSON.stringify(deduped, null, 2));

  // Also output a list of agent services we can target for sending starters
  console.error(`\nFound ${deduped.length} unique Nano addresses from public x402 sources.`);
  console.error(`Found ${x402Services.length} x402-enabled services that could be targeted.`);
}

main().catch((e) => { console.error(e); process.exit(1); });