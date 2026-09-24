#!/usr/bin/env node
/**
 * bridge.js — Nano-to-USDC x402 bridge proxy.
 *
 * Sits between an AI agent and any USDC x402 service. The agent pays with Nano;
 * the bridge proxies the payment through to the USDC-x402 service on behalf of
 * the agent, converting currency via a live price feed.
 *
 * Block 11 — Nano on-ramp adapter for the x402 USDC ecosystem.
 *
 * Flow:
 *   1. Agent sends request to bridge:   GET /proxy?target=<encoded-url>
 *   2. Bridge forwards to the target service.
 *   3. If target returns 402 with a USDC price, bridge converts to Nano
 *      and returns a modified 402 with the Nano price.
 *   4. Agent pays Nano to bridge's designated address.
 *   5. Bridge monitors Nano ledger for the payment (via RPC).
 *   6. Bridge completes the USDC payment to the target (or stores it for manual settlement).
 *   7. Bridge returns the target's response to the agent.
 *
 * Laws:
 *   B1 — The bridge accepts any x402 service URL and forwards GET/POST requests.
 *   B2 — A 402 response with a USDC amount is converted to a Nano 402 with live price.
 *   B3 — The bridge verifies Nano payments on-chain before forwarding them.
 *   B4 — A payment is only counted once per block hash (idempotent).
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

// --- Configuration ---
const PORT = parseInt(process.env.BRIDGE_PORT || "3402", 10);
const NANO_ADDRESS = process.env.BRIDGE_NANO_ADDRESS || "";
const NANO_RPC_URL = process.env.NANO_RPC_URL || "https://rpc.nano.to";
const PRICE_API = "https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd";
const USD_PER_XNO = parseFloat(process.env.BRIDGE_USD_PER_XNO || "0");
// Minimum Nano payment in raw (0.000001 XNO = 10^24 raw)
const FLOOR_RAW = "1000000000000000000000000";

// --- In-memory payment tracking ---
// Map of block_hash -> { account, amount_raw, target_url, method, headers, body, settled }
const paidRequests = new Map();

// --- Utilities ---

/** Fetch a URL and return { status, headers, body }. Handles 402 gracefully. */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: options.method || "GET",
        headers: {
          ...options.headers,
          "User-Agent": "NanoBridge/0.1 (x402 proxy)",
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
          });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Call Nano RPC. */
async function nanoRpc(action, params = {}) {
  const res = await fetch(`${NANO_RPC_URL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Nano RPC ${action}: ${json.error}`);
  return json;
}

/**
 * Get the latest Nano-to-USD price from CoinGecko.
 * Falls back to BRIDGE_USD_PER_XNO env var if the API is unreachable.
 */
async function getNanoUsdPrice() {
  try {
    const res = await fetchUrl(PRICE_API);
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return data.nano.usd;
    }
  } catch { /* fall through */ }
  if (USD_PER_XNO > 0) return USD_PER_XNO;
  throw new Error("No price source available");
}

/** Convert a USDC amount (as "$0.001" or number) to the equivalent Nano raw amount. */
async function usdToNanoRaw(usdAmount) {
  const price = await getNanoUsdPrice();
  const usdNum = typeof usdAmount === "string"
    ? parseFloat(usdAmount.replace(/^\$/, ""))
    : usdAmount;
  const nanoAmount = usdNum / price;
  // Nano raw: 1 XNO = 10^30 raw
  const raw = BigInt(Math.floor(nanoAmount * 1e30));
  return raw < BigInt(FLOOR_RAW) ? FLOOR_RAW : raw.toString();
}

/** Check if a Nano account has received a specific amount from a specific sender. */
async function verifyNanoPayment(blockHash, expectedAmountRaw) {
  // Get block info to verify it's a send to our address
  const info = await nanoRpc("block_info", { json_block: "true", hash: blockHash });
  const block = info.contents || info.block;
  
  // Check it's a state block (send)
  if (!block || block.type !== "state") {
    return { valid: false, reason: "not a state block" };
  }
  // Check it sends to our address
  if (block.link_as_account !== NANO_ADDRESS) {
    return { valid: false, reason: "not sent to bridge address" };
  }
  // Check the amount is sufficient
  const amount = BigInt(block.balance) - BigInt(info.previous_balance || "0");
  if (amount <= BigInt(0)) {
    return { valid: false, reason: "zero or negative amount" };
  }
  if (amount < BigInt(expectedAmountRaw)) {
    return { valid: false, reason: `insufficient: ${amount} < ${expectedAmountRaw}` };
  }
  return { valid: true, account: block.account, amount_raw: amount.toString(), block: block };
}

// --- NanSwap API (keyless conversion) ---
// NanSwap public API: POST https://api.nanswap.com/v2/estimate with from/to/amount
// Returns estimated amount. The actual swap needs a transaction.
// For MVP we just estimate and report — real conversion is a future block.

async function estimateNanoToUsdc(nanoRaw) {
  const nanoAmount = BigInt(nanoRaw);
  const nanoDecimal = Number(nanoAmount) / 1e30;
  if (nanoDecimal < 0.0001) return 0;
  try {
    const res = await fetchUrl("https://api.nanswap.com/v2/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "XNO",
        to: "USDC",
        amount: nanoDecimal.toFixed(10),
      }),
    });
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      return parseFloat(data.result?.amount || "0");
    }
  } catch { /* fall through */ }
  return 0;
}

// --- Request parsing ---

/** Extract x402 accepts[] from a response body or headers. */
function extractX402Accepts(response) {
  try {
    const body = JSON.parse(response.body);
    if (body.accepts && Array.isArray(body.accepts)) {
      return body.accepts;
    }
  } catch { /* not JSON */ }
  // x402 v2 uses PAYMENT-REQUIRED header with base64 JSON
  if (response.headers["payment-required"]) {
    try {
      const pr = JSON.parse(
        Buffer.from(response.headers["payment-required"], "base64").toString()
      );
      if (pr.accepts) return pr.accepts;
    } catch { /* malformed */ }
  }
  return [];
}

/**
 * Build the x402 Nano payment requirements to return to the agent.
 * Follows the x402 v2 spec: PAYMENT-REQUIRED header + 402 body.
 */
function buildNano402Response(accepts) {
  const nanoAccepts = accepts.map((a) => ({
    scheme: "exact",
    network: "nano:mainnet",
    asset: "XNO",
    amount: a._nanoRaw,
    // prostimate: the original USDC amount converted
    _original_usdc: a._originalUsd,
  }));

  const body = JSON.stringify({
    x402Version: 2,
    accepts: nanoAccepts,
    description: "Nano bridge proxy — pay in XNO, receive the proxied response",
    extensions: {
      "bridge-info": {
        accepts_nano: true,
        nano_address: NANO_ADDRESS,
        price_conversion: "live coin gecko",
      },
    },
  });

  return {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-402-Version": "2",
      "Payment-Required": Buffer.from(body).toString("base64"),
    },
    body,
  };
}

// --- HTTP Server ---

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  // CORS for agent clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment, Payment-Signature");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", nano_address: NANO_ADDRESS }));
    return;
  }

  // --- Proxy endpoint: forward to target x402 service ---
  if (pathname === "/proxy") {
    const targetUrl = parsed.searchParams.get("target");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "target query parameter required" }));
      return;
    }

    // Read the agent's request body
    let agentBody = "";
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      agentBody = await new Promise((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data));
      });
    }

    try {
      // Forward the request to the target service
      const targetResp = await fetchUrl(targetUrl, {
        method: req.method,
        headers: req.headers,
        body: agentBody || undefined,
      });

      // If the target returned a 402 (payment required), convert to Nano
      if (targetResp.status === 402) {
        const accepts = extractX402Accepts(targetResp);
        
        // Find USDC-based accepts
        const usdcAccepts = accepts.filter(
          (a) => a.asset === "USDC" || a.scheme === "exact"
        );

        if (usdcAccepts.length > 0) {
          // Convert each USDC price to Nano
          for (const a of usdcAccepts) {
            a._originalUsd = a.amount || a.price || "0";
            a._nanoRaw = await usdToNanoRaw(a._originalUsd);
          }

          const nano402 = buildNano402Response(usdcAccepts);
          res.writeHead(402, nano402.headers);
          res.end(nano402.body);
          return;
        }
      }

      // Pass through non-402 responses
      const respHeaders = { ...targetResp.headers };
      delete respHeaders["transfer-encoding"]; // let node handle it
      res.writeHead(targetResp.status, respHeaders);
      res.end(targetResp.body);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Bridge proxy error: ${e.message}` }));
    }
    return;
  }

  // --- Payment verification endpoint ---
  // Agent sends their Nano payment block hash for verification
  if (pathname === "/verify-payment") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const data = JSON.parse(body || "{}");
        const { block_hash, expected_amount_raw, target_url } = data;

        if (!block_hash) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "block_hash required" }));
          return;
        }

        // Check if already processed
        if (paidRequests.has(block_hash)) {
          const existing = paidRequests.get(block_hash);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            verified: true,
            already_processed: true,
            status: existing.settled ? "settled" : "pending",
          }));
          return;
        }

        // Verify on-chain
        const expected = expected_amount_raw || FLOOR_RAW;
        const verification = await verifyNanoPayment(block_hash, expected);

        if (!verification.valid) {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ verified: false, reason: verification.reason }));
          return;
        }

        // Record the verified payment
        paidRequests.set(block_hash, {
          account: verification.account,
          amount_raw: verification.amount_raw,
          target_url,
          settled: false,
          verified_at: new Date().toISOString(),
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          verified: true,
          account: verification.account,
          amount_raw: verification.amount_raw,
        }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- Status endpoint ---
  if (pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      payments_received: paidRequests.size,
      payments_settled: [...paidRequests.values()].filter((p) => p.settled).length,
      nano_address: NANO_ADDRESS,
    }));
    return;
  }

  // --- Default: 404 ---
  res.writeHead(404);
  res.end("Not found. Use /proxy?target=<url>, /verify-payment, or /health");
});

// Only start the server when run directly (not when required for tests)
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Nano x402 bridge listening on port ${PORT}`);
    console.log(`Nano address: ${NANO_ADDRESS || "NOT SET — set BRIDGE_NANO_ADDRESS"}`);
  });
}

module.exports = { server, verifyNanoPayment, usdToNanoRaw, extractX402Accepts };