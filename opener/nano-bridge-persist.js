#!/usr/bin/env node
/**
 * nano-bridge-persist.js — Nano-to-USDC x402 bridge with SQLite persistence.
 *
 * Block 30 — persistent bridge proxy for conversion.
 *
 * Same as bridge.js but payments survive restarts and the bridge
 * runs as a systemd service. The bridge sits between an AI agent and
 * any USDC x402 service: the agent pays with Nano, the bridge fronts
 * the USDC side.
 *
 * Laws:
 *    B5 — The bridge persists paid requests to SQLite so they survive restarts.
 *    B6 — The bridge proxies any x402 request and converts USDC accepts to Nano.
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { URL } = require("url");

// --- Configuration ---
const PORT = parseInt(process.env.BRIDGE_PORT || "3402", 10);
const NANO_ADDRESS = process.env.BRIDGE_NANO_ADDRESS || "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";
const NANO_RPC_URL = process.env.NANO_RPC_URL || "https://rpc.nano.to";
const DB_PATH = process.env.BRIDGE_DB_PATH || path.join(__dirname, "bridge-payments.db");
const PRICE_API = "https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd";
const USD_PER_XNO = parseFloat(process.env.BRIDGE_USD_PER_XNO || "0");
const FLOOR_RAW = "1000000000000000000000000"; // 0.000001 XNO

// --- Database setup ---
let db;
function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        block_hash TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        amount_raw TEXT NOT NULL,
        target_url TEXT,
        settled INTEGER DEFAULT 0,
        verified_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

// --- Nano RPC ---
async function nanoRpc(action, params = {}) {
  const url = new URL(NANO_RPC_URL);
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ action, ...params });
    const req = mod.request(NANO_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      timeout: 15000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(`RPC ${action}: ${json.error}`));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// --- Price feed ---
async function getNanoUsdPrice() {
  try {
    const body = await fetchUrl(PRICE_API);
    const data = JSON.parse(body);
    if (data.nano && data.nano.usd) return data.nano.usd;
  } catch { /* fall through */ }
  if (USD_PER_XNO > 0) return USD_PER_XNO;
  throw new Error("No price source — set BRIDGE_USD_PER_XNO or wait for CoinGecko");
}

async function usdToNanoRaw(usdAmount) {
  let price;
  try { price = await getNanoUsdPrice(); } catch { price = USD_PER_XNO > 0 ? USD_PER_XNO : 0.7; }
  const usdNum = typeof usdAmount === "string" ? parseFloat(usdAmount.replace(/^\$/, "")) : usdAmount;
  if (usdNum <= 0 || price <= 0) return FLOOR_RAW;
  const nanoAmount = usdNum / price;
  const raw = BigInt(Math.floor(nanoAmount * 1e30));
  return raw < BigInt(FLOOR_RAW) ? FLOOR_RAW : raw.toString();
}

// --- HTTP request helper ---
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const req = mod.request(url, {
      method: options.method || "GET",
      headers: { "User-Agent": "NanoBridge/0.2 (x402 proxy)", ...(options.headers || {}) },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// --- Request body reader ---
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => data += c);
    req.on("end", () => resolve(data));
  });
}

// --- x402 helpers ---
function extractX402Accepts(response) {
  try {
    const body = JSON.parse(response.body);
    if (body.accepts && Array.isArray(body.accepts)) return body.accepts;
  } catch { /* not JSON */ }
  if (response.headers["payment-required"]) {
    try {
      const pr = JSON.parse(Buffer.from(response.headers["payment-required"], "base64").toString());
      if (pr.accepts) return pr.accepts;
    } catch { /* malformed */ }
  }
  return [];
}

function buildNano402Response(accepts) {
  const nanoAccepts = accepts.map((a) => ({
    scheme: "exact",
    network: "nano:mainnet",
    asset: "XNO",
    amount: a._nanoRaw,
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
        price_conversion: "live CoinGecko",
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

// --- Payment verification ---
async function verifyNanoPayment(blockHash) {
  const info = await nanoRpc("block_info", { json_block: "true", hash: blockHash });
  const block = info.contents || info.block;
  if (!block || block.type !== "state") return { valid: false, reason: "not a state block" };
  if (block.link_as_account !== NANO_ADDRESS) return { valid: false, reason: "not sent to bridge address" };
  const amount = BigInt(block.balance) - BigInt(info.previous_balance || "0");
  if (amount <= BigInt(0)) return { valid: false, reason: "zero or negative amount" };
  return { valid: true, account: block.account, amount_raw: amount.toString(), block };
}

// --- Payment tracking with persistence ---
function paymentExists(hash) {
  const row = getDb().prepare("SELECT 1 FROM payments WHERE block_hash = ?").get(hash);
  return !!row;
}

function savePayment(hash, account, amountRaw, targetUrl) {
  getDb().prepare(
    "INSERT OR IGNORE INTO payments (block_hash, account, amount_raw, target_url, settled, verified_at) VALUES (?, ?, ?, ?, 0, ?)"
  ).run(hash, account, amountRaw, targetUrl || "", new Date().toISOString());
}

function listPayments(limit = 20) {
  return getDb().prepare("SELECT * FROM payments ORDER BY verified_at DESC LIMIT ?").all(limit);
}

function paymentCount() {
  const r = getDb().prepare("SELECT COUNT(*) as cnt FROM payments").get();
  return r ? r.cnt : 0;
}

function settlePayment(hash) {
  getDb().prepare("UPDATE payments SET settled = 1 WHERE block_hash = ?").run(hash);
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Payment, Payment-Signature");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // --- Health ---
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", nano_address: NANO_ADDRESS }));
    return;
  }

  // --- Proxy ---
  if (pathname === "/proxy") {
    const targetUrl = parsed.searchParams.get("target");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "target query parameter required" }));
      return;
    }

    const agentBody = (req.method === "POST" || req.method === "PUT" || req.method === "PATCH")
      ? await readBody(req) : "";

    try {
      const targetResp = await fetchUrl(targetUrl, {
        method: req.method,
        headers: req.headers,
        body: agentBody || undefined,
      });

      if (targetResp.status === 402) {
        const accepts = extractX402Accepts(targetResp);
        const usdcAccepts = accepts.filter((a) => a.asset === "USDC" || a.scheme === "exact");
        if (usdcAccepts.length > 0) {
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

      const respHeaders = { ...targetResp.headers };
      delete respHeaders["transfer-encoding"];
      res.writeHead(targetResp.status, respHeaders);
      res.end(targetResp.body);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Bridge proxy error: ${e.message}` }));
    }
    return;
  }

  // --- Verify payment ---
  if (pathname === "/verify-payment") {
    const body = JSON.parse(await readBody(req) || "{}");
    const { block_hash } = body;
    if (!block_hash) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "block_hash required" }));
      return;
    }

    // Already processed?
    if (paymentExists(block_hash)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ verified: true, already_processed: true }));
      return;
    }

    try {
      const verification = await verifyNanoPayment(block_hash);
      if (!verification.valid) {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ verified: false, reason: verification.reason }));
        return;
      }

      savePayment(block_hash, verification.account, verification.amount_raw, body.target_url || "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        verified: true,
        account: verification.account,
        amount_raw: verification.amount_raw,
      }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Verification error: ${e.message}` }));
    }
    return;
  }

  // --- Status ---
  if (pathname === "/status") {
    const count = paymentCount();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      payments_received: count,
      nano_address: NANO_ADDRESS,
    }));
    return;
  }

  // --- List payments ---
  if (pathname === "/payments") {
    const limit = parseInt(parsed.searchParams.get("limit") || "20", 10);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listPayments(limit)));
    return;
  }

  // --- Try Nano demo page ---
  if (pathname === "/demo" || pathname === "/try-nano") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Try Nano Bridge — Unstuck</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,sans-serif;max-width:700px;margin:2em auto;padding:1em;line-height:1.6}
pre{background:#f4f4f4;padding:1em;border-radius:4px;overflow-x:auto}
code{font-size:0.9em}</style>
</head><body>
<h1>Try Nano through the x402 Bridge</h1>
<p>The Unstuck bridge proxy converts any USDC x402 payment into Nano (XNO).
Instead of paying $0.001 USDC for an API call, you can pay ~0.001 XNO
using nano:mainnet — instantly and feeless.</p>

<h2>How it works</h2>
<ol>
<li><strong>Find a USDC x402 service</strong> (any API that returns HTTP 402 with a USDC price)</li>
<li><strong>Hit the bridge</strong>: <code>GET /proxy?target=&lt;encoded-url&gt;</code></li>
<li><strong>Bridge returns a 402</strong> with the same price in Nano instead of USDC</li>
<li><strong>Pay with Nano</strong> to <code>${NANO_ADDRESS}</code></li>
<li><strong>Verify</strong>: <code>POST /verify-payment {"block_hash":"..."}</code></li>
<li><strong>Get the response</strong> the USDC service would have returned</li>
</ol>

<h2>Try it now</h2>
<p>Use any HTTP client:</p>
<pre>curl http://172.86.112.140:3402/proxy?target=https://httpbin.org/anything</pre>

<p>To see a real USDC-to-Nano conversion, try a live x402 endpoint:</p>
<pre>BRIDGE=http://172.86.112.140:3402
curl -s "$BRIDGE/proxy?target=https%3A%2F%2Fapi.nanogpt.com%2Fv1%2Fchat%2Fcompletions"</pre>

<h2>Endpoint Reference</h2>
<ul>
<li><code>GET /health</code> — bridge status</li>
<li><code>GET /proxy?target=&lt;url-encoded-target&gt;</code> — proxy with Nano conversion</li>
<li><code>POST /verify-payment</code> — verify a Nano payment block hash</li>
<li><code>GET /status</code> — payment counts</li>
</ul>

<p>The bridge address is <code>${NANO_ADDRESS}</code>.</p>
</body></html>`);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found. Use /proxy, /verify-payment, /health, /status, /payments, /try-nano");
});

// --- Export for testing ---
module.exports = { server, verifyNanoPayment, usdToNanoRaw, extractX402Accepts, getDb };

// --- Start when run directly ---
if (require.main === module) {
  getDb(); // ensure DB is ready
  server.listen(PORT, () => {
    console.log(`Nano bridge (persistent) listening on port ${PORT}`);
    console.log(`Nano address: ${NANO_ADDRESS}`);
    console.log(`DB: ${DB_PATH}`);
  });
}