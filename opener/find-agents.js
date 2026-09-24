#!/usr/bin/env node
/**
 * find-agents.js — discover real agent Nano addresses from public x402 sources.
 *
 * This reads from multiple public directories and x402 service indexes to find
 * Nano addresses of agents that are demonstrably active in public. It outputs a
 * deduplicated JSON array of {address, found_via, source} objects.
 *
 * Sources:
 *   1. x402-list.com API — probes every listed service for a Nano x402 payTo
 *   2. feeless402.com — known Nano-accepting endpoint
 *   3. pursekeeper sellers — known Nano-accepting agents
 *   4. Subnano — Nano x402 content platform
 *   5. nano-gpt.com — Nano x402 inference endpoint
 *
 * Strategy: Rather than scraping text for addresses (which misses the fact that
 * most x402 services use dynamic per-quote addresses), we probe the actual HTTP
 * 402 responses of known Nano-accepting services to extract their payTo addresses.
 *
 * Output: stdout (JSON array) or to a file.
 */

const nano = require("nanocurrency");

const FETCH_TIMEOUT = 10000;

function fetch(url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? require("https") : require("http");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    const opts = {
      method: body ? "POST" : "GET",
      signal: ctl.signal,
      headers: { "User-Agent": "unstuck-opener/1.0", ...headers },
    };
    const req = mod.request(url, opts, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; if (data.length > 100000) { req.destroy(); reject(new Error("response too large")); } });
      res.on("end", () => { clearTimeout(t); resolve({ status: res.statusCode, headers: res.headers, body: data }); });
    });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

/**
 * Probe a generic x402 endpoint for Nano payment options.
 * Sends a minimal probe request, expects 402, parses the accepts array for Nano.
 */
async function probeForNanoAddress(url, probeBody = null, probeHeaders = {}, probeMethod = "GET") {
  try {
    const res = await fetch(url, probeBody, probeHeaders);
    if (res.status !== 402) return null;

    let body;
    try { body = JSON.parse(res.body); } catch { return null; }

    // Check standard x402 v2 accepts array
    const accepts = body.accepts || [];
    for (const opt of accepts) {
      if (opt.scheme === "exact" && opt.network === "nano:mainnet" && opt.payTo) {
        return {
          address: opt.payTo,
          amount_raw: opt.amount,
          scheme: "x402-exact-nano",
          url,
        };
      }
      if (opt.scheme === "nano" && opt.payTo) {
        return {
          address: opt.payTo,
          amount_raw: opt.amount || opt.maxAmountRequired,
          scheme: "nano",
          url,
        };
      }
    }

    // Check NanoGPT-style payment.accepted array
    const payment = body.payment;
    if (payment && payment.accepted) {
      for (const opt of payment.accepted) {
        if ((opt.scheme === "nano" || opt.scheme === "nano-exact") && opt.payTo) {
          return {
            address: opt.payTo,
            amount_raw: opt.amount || opt.maxAmountRequired,
            scheme: opt.scheme,
            url,
          };
        }
      }
    }

    // Check for simple nano_ in raw 402 body (some services embed it in error)
    const text = res.body;
    const match = text.match(/nano_[13456789abcdefghijkmnopqrstuwxyz]{60}/);
    if (match) {
      return {
        address: match[0],
        amount_raw: null,
        scheme: "raw-match",
        url,
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch known Nano-accepting endpoints from x402-list.com and probe each.
 * The x402-list API returns services; we probe any that might use Nano.
 */
async function probeX402ListServices() {
  const results = [];
  try {
    const res = await fetch("https://x402-list.com/api/v1/services?limit=200", null);
    if (res.status !== 200) return results;
    const data = JSON.parse(res.body);
    const services = data.data || [];
    console.error(`x402-list: ${services.length} services found`);
    return services;
  } catch (e) {
    console.error("Warning: x402-list fetch failed:", e.message);
    return [];
  }
}

/**
 * Known Nano-accepting endpoints we can probe for their deposit addresses.
 * These are services that advertise Nano in their x402 accept list.
 */
const KNOWN_NANO_ENDPOINTS = [
  {
    url: "https://feeless402.com/premium",
    name: "feeless402 premium",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://nano-gpt.com/api/v1/chat/completions",
    name: "NanoGPT chat",
    method: "POST",
    body: JSON.stringify({
      model: "gpt-4.1-nano",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    }),
    headers: { "Content-Type": "application/json", "x-x402": "true" },
  },
  {
    url: "https://nano-gpt.com/api/v1/data/web/search",
    name: "NanoGPT web search",
    method: "POST",
    body: JSON.stringify({ query: "test", max_results: 1 }),
    headers: { "Content-Type": "application/json", "x-x402": "true" },
  },
  {
    url: "https://api.shehriyar.ink/v1/attest/response",
    name: "Goonbot attest",
    method: "POST",
    body: JSON.stringify({ payload: { hello: "world" } }),
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "https://nano-courier-x402.vercel.app/api/courier",
    name: "Wallenhof courier",
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "https://subnano.me/api/posts/d4d6aaaa-11a4-4735-b388-7dd7961228dc/access",
    name: "Subnano post",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://pursekeeper.dev/v1/x402",
    name: "pursekeeper x402",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://pursekeeper.dev/v1/price",
    name: "pursekeeper price",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://feed-weight-check.jackharney1360.chatgpt.site/api/quote",
    name: "Feed Weight Check",
    method: "POST",
    body: JSON.stringify({ records: [{ id: "probe", item_weight: { value: 1, unit: "kg" } }] }),
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "https://contract-lens-nano.dev-romanv.chatgpt.site/v1/audit",
    name: "Contract Lens",
    method: "POST",
    body: JSON.stringify({ before: {}, after: {} }),
    headers: { "Content-Type": "application/json" },
  },
  // New endpoints from Pursekeeper sellers.json — additional Nano-accepting agent operators
  {
    url: "https://llmrt-companion.manhliemcn4euwlu.workers.dev/pro/402",
    name: "llmrt pro package",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://pyfile-agent.taile3ff35.ts.net/v1/chat/completions",
    name: "pyfile-llm chat",
    method: "POST",
    body: JSON.stringify({ model: "gpt-4.1-nano", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "https://anonymous-trigger-southwest-respective.trycloudflare.com/api/x402/v1/audit",
    name: "StringSafeQA audit",
    method: "POST",
    body: JSON.stringify({ strings: ["test"] }),
    headers: { "Content-Type": "application/json" },
  },
  {
    url: "https://xow1hv-ip-47-239-116-165.tunnelmole.net/api/x402/v1/clean",
    name: "ClearTable CSV clean",
    method: "POST",
    body: JSON.stringify({}),
    headers: { "Content-Type": "application/json" },
  },
  // Nano Hub AI directory services
  {
    url: "https://longstories.ai/.well-known/x402",
    name: "LongStories.ai x402",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://ainanomusic.com/.well-known/x402",
    name: "Al Nano Music x402",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://openwallet.sh/.well-known/x402",
    name: "OpenWallet Standard",
    method: "GET",
    body: null,
    headers: {},
  },
  {
    url: "https://xnoapp.onrender.com/api/account",
    name: "Nano AI deposit",
    method: "GET",
    body: null,
    headers: {},
  },
];

/**
 * Probe known Nano-accepting endpoints. These are agents that serve x402
 * responses with Nano as a payment option. Their payTo addresses change
 * per-quote (ephemeral), but we record the service as a Nano-adopting agent.
 */
async function probeKnownEndpoints() {
  const results = [];
  const probes = KNOWN_NANO_ENDPOINTS.map(async (ep) => {
    try {
      const nanoInfo = await probeForNanoAddress(ep.url, ep.body, ep.headers, ep.method);
      if (nanoInfo && nano.checkAddress(nanoInfo.address)) {
        results.push({
          address: nanoInfo.address,
          found_via: ep.name,
          source: "x402-ecosystem",
          url: ep.url,
          scheme: nanoInfo.scheme,
        });
        console.error(`Found Nano address at ${ep.name}: ${nanoInfo.address} (${nanoInfo.scheme})`);
      } else if (nanoInfo) {
        console.error(`${ep.name}: returned non-address "${nanoInfo.address}"`);
      } else {
        console.error(`${ep.name}: no Nano option in 402 response`);
      }
    } catch (e) {
      console.error(`${ep.name}: error — ${e.message}`);
    }
  });
  await Promise.allSettled(probes);
  return results;
}

/**
 * Fetch llms.txt files from known Nano-accepting services to find
 * published addresses.
 */
async function probeLlmsTxt() {
  const results = [];
  const urls = [
    "https://feeless402.com/llms.txt",
    "https://nano-gpt.com/llms.txt",
    "https://subnano.me/llms.txt",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, null);
      if (res.status === 200) {
        const matches = res.body.match(/nano_[13456789abcdefghijkmnopqrstuwxyz]{60}/g);
        if (matches) {
          for (const addr of [...new Set(matches)]) {
            if (nano.checkAddress(addr)) {
              results.push({ address: addr, found_via: url.replace("https://", ""), source: "llms.txt" });
            }
          }
        }
      }
    } catch (e) {
      console.error(`Warning: ${url} fetch failed: ${e.message}`);
    }
  }
  return results;
}

/**
 * Parse pursekeeper's sellers.json for known Nano endpoints.
 */
async function probePursekeeperSellers() {
  const results = [];
  try {
    const res = await fetch("https://pursekeeper.dev/sellers.json", null);
    if (res.status !== 200) return results;
    const data = JSON.parse(res.body);
    const sellers = data.sellers || [];
    for (const seller of sellers) {
      if (seller.endpoint && (seller.pay || "").includes("nano")) {
        results.push({
          found_via: `pursekeeper:${seller.id}`,
          endpoint: seller.endpoint,
          source: "pursekeeper-ecosystem",
        });
      }
    }
    console.error(`pursekeeper: ${results.length} Nano-accepting sellers found`);
  } catch (e) {
    console.error("Warning: pursekeeper.dev fetch failed:", e.message);
  }
  return results;
}

async function main() {
  console.error("=== find-agents.js — discovering Nano addresses from x402 ecosystem ===");

  // 1. Probe known Nano-accepting endpoints
  console.error("\n--- Probing known Nano endpoints ---");
  const endpointResults = await probeKnownEndpoints();

  // 2. Scan llms.txt files
  console.error("\n--- Probing llms.txt files ---");
  const llmsResults = await probeLlmsTxt();

  // 3. Get sellers info
  console.error("\n--- Probing pursekeeper sellers ---");
  const sellers = await probePursekeeperSellers();

  // 4. Get x402-list services (for metadata only — most are USDC-only)
  console.error("\n--- Checking x402-list ---");
  await probeX402ListServices();

  // Deduplicate by address
  const seen = new Set();
  const allAddresses = [...endpointResults, ...llmsResults].filter((a) => {
    if (!a.address || seen.has(a.address)) return false;
    seen.add(a.address);
    return true;
  });

  // Output as JSON
  console.log(JSON.stringify(allAddresses, null, 2));
  console.error(`\n=== Found ${allAddresses.length} unique Nano addresses ===`);
  if (sellers.length > 0) {
    console.error(`=== ${sellers.length} Nano-accepting sellers (endpoints may be probed in future runs) ===`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });