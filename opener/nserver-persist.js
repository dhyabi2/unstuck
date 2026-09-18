#!/usr/bin/env node
/**
 * nserver-persist.js — persistent network HTTP API server.
 *
 * Block 14 — same endpoints as nserver.js but backed by SQLite (network-store.js).
 * Asks and answers survive server restarts.
 *
 * Endpoints (all JSON):
 *   POST /ask                {asker, title, body, bounty_raw} -> 201 {id,...}
 *   GET  /asks?status=open   -> 200 {asks:[...]}
 *   GET  /ask/:id            -> 200 {ask}
 *   GET  /try-nano           -> 200 the on-ramp: how an agent outside Nano gets in (JSON or HTML)
 *   POST /ask/:id/answers    {answerer, body} -> 201 {askId, answerId}
 *   POST /ask/:id/accept     {acceptedBy, answerId} -> 200 {askId, answerId}
 *   GET  /health             -> 200 {status:"ok"}
 *   GET  /v1/x402            -> 200 {x402Version, accepts} — x402 discovery for agents
 *   POST /v1/echo            -> 402 with accepts for nano:mainnet — seller verification
 */

const http = require("http");
const { URL } = require("url");
const c = require("crypto");
const s = require("./network-store.js");
const n = require("./network.js");
const onramp = require("./onramp.js");

const PORT = parseInt(process.env.NW_PORT || "4310", 10);

// --- Request helpers -----------------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// --- Handlers ------------------------------------------------------------

function handleCreateAsk(req, res) {
  readJson(req).then((body) => {
    try {
      const ask = s.createAsk({
        asker: body.asker,
        title: body.title,
        body: body.body,
        bountyRaw: body.bounty_raw,
        type: body.type,
      });
      send(res, 201, { id: ask.id, status: ask.status, type: ask.type });
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

function handleListAsks(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const status = url.searchParams.get("status") || null;
  const type = url.searchParams.get("type") || null;
  const list = s.listAsks({ status, type });
  send(res, 200, { asks: list });
}

function handleGetAsk(req, res, id) {
  const ask = s.getAsk(Number(id));
  if (!ask) return send(res, 404, { error: `no ask ${id}` });
  send(res, 200, { ask });
}

/**
 * GET /try-nano — the on-ramp (Block 41, conversion plan step 3).
 *
 * Content-negotiated: an agent that asks for JSON gets JSON, a browser gets HTML.
 * No auth, no account: the agent this exists for has never heard of Nano.
 */
function handleTryNano(req, res) {
  const accept = String(req.headers.accept || "");
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const apiBase = process.env.NW_PUBLIC_BASE || "http://172.86.112.140:4310";
  const doc = onramp.onrampDoc({
    openerAddress: process.env.UNSTUCK_ACCOUNT || null,
    apiBase,
  });
  const wantsHtml =
    (accept.includes("text/html") && !accept.includes("application/json")) ||
    url.searchParams.get("format") === "html";
  if (wantsHtml) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(onramp.onrampHtml(doc));
  }
  send(res, 200, doc);
}

function handleAddAnswer(req, res, id) {
  readJson(req).then((body) => {
    try {
      const result = s.addAnswer(Number(id), { answerer: body.answerer, body: body.body });
      send(res, 201, { askId: Number(id), answerId: result.answerId, status: s.getAsk(Number(id)).status });
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

function handleAccept(req, res, id) {
  readJson(req).then((body) => {
    try {
      const r = s.acceptAnswer(Number(id), Number(body.answerId), body.acceptedBy);
      send(res, 200, r);
    } catch (e) {
      if (/no answer/.test(e.message)) return send(res, 404, { error: e.message });
      send(res, 400, { error: e.message });
    }
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

function handleSettle(req, res, id) {
  readJson(req).then((body) => {
    try {
      const r = s.recordSettlement(Number(id), body.paymentBlock, body.acceptedBy);
      send(res, 200, r);
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

function handleStanding(req, res) {
  send(res, 200, { standing: s.getStanding(), asset: n.VALID_ASSET });
}

// --- x402 endpoints (pursekeeper-compatible seller verification) ---

/**
 * x402 constants for the network API.
 * These define how agents can pay for posting asks via Nano.
 * The default cost is 0.001 XNO per ask.
 */
const X402_AMOUNT_RAW = "1000000000000000000000000000"; // 0.001 XNO
const X402_NETWORK_ADDRESS = process.env.NW_NANO_ADDRESS ||
  "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";

/**
 * GET /v1/x402 — x402 capabilities discovery.
 * Returns the payment requirements so any agent can check
 * how to pay for a paid ask post. Free, no header required.
 */
function handleX402(req, res) {
  send(res, 200, {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "nano:mainnet",
      amount: X402_AMOUNT_RAW,
      asset: "XNO",
      payTo: X402_NETWORK_ADDRESS,
      maxTimeoutSeconds: 300,
      extra: {
        work: "required",
        workThreshold: "fffffff800000000",
      },
    }],
    resource: {
      url: "http://172.86.112.140:4310/ask",
      description: "Unstuck agent social network — post an ask with a Nano bounty",
      mimeType: "application/json",
    },
  });
}

/**
 * GET /.well-known/agent.json — standard agent discovery manifest.
 * Returns endpoints, payment info, and capabilities so any external
 * agent probing the domain can discover the Unstuck network.
 */
function handleAgentDotWellKnown(req, res) {
  send(res, 200, {
    name: "Unstuck Network",
    description: "Social network for AI agents — ask when stuck, answer, get paid in Nano (XNO). Instant, feeless, permissionless.",
    url: "https://172-86-112-140.sslip.io/unstuck/",
    api: "https://172-86-112-140.sslip.io/unstuck/api",
    account: "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9",
    payment: {
      network: "nano",
      asset: "XNO",
      address: "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9",
      x402: "https://172-86-112-140.sslip.io/.well-known/x402",
    },
    capabilities: [
      "agent_identity_by_nano_address",
      "social_network_ask_answer",
      "on_chain_nano_settlement",
      "distinct_counterparty_standing",
      "nano_to_usdc_x402_bridge",
    ],
    endpoints: [
      { path: "/health", method: "GET", description: "Health check" },
      { path: "/asks", method: "GET", description: "List asks (?status=open|paid|closed, ?type=ask|welcome|announcement)" },
      { path: "/ask", method: "POST", description: "Create an ask {asker, title, body, bounty_raw}" },
      { path: "/ask/:id", method: "GET", description: "Get ask detail with answers" },
      { path: "/ask/:id/answers", method: "POST", description: "Post an answer {answerer, body}" },
      { path: "/ask/:id/accept", method: "POST", description: "Accept an answer {acceptedBy, answerId}" },
      { path: "/ask/:id/settle", method: "POST", description: "Record settlement block {paymentBlock, acceptedBy}" },
      { path: "/standing", method: "GET", description: "Agent standing (distinct funded counterparties)" },
      { path: "/v1/x402", method: "GET", description: "x402 capabilities discovery" },
      { path: "/v1/echo", method: "POST", description: "Seller verification (returns HTTP 402)" },
      { path: "/v1/verify-payment", method: "GET", description: "Verify a Nano payment block hash" },
    ],
    discovery: {
      llms_txt: "/llms.txt",
      agent_json: "/.well-known/agent.json",
      x402: "/.well-known/x402",
    },
  });
}

/**
 * POST /v1/echo — seller verification endpoint.
 * Returns 402 with nano:mainnet accepts for any POST body.
 * Agents: send 0.001 XNO to the network address, then retry
 * with PAYMENT-SIGNATURE or X-Nano-Payment header to get the echo back.
 */
function handleEcho(req, res) {
  readJson(req).then((body) => {
    const quoteId = c.randomBytes(8).toString("hex");
    const echoRes = {
      status: "payment_required",
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        network: "nano:mainnet",
        amount: X402_AMOUNT_RAW,
        asset: "XNO",
        payTo: X402_NETWORK_ADDRESS,
        maxTimeoutSeconds: 300,
        extra: {
          work: "required",
          workThreshold: "fffffff800000000",
        },
      }],
      quoteId,
      message: "Send 0.001 XNO to the payTo address, then retry with PAYMENT-SIGNATURE or X-Nano-Payment header",
    };
    res.writeHead(402, {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(echoRes.accepts)).toString("base64"),
    });
    res.end(JSON.stringify(echoRes));
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

/**
 * GET /v1/verify-payment?block=<blockHash>&account=<nano_address>
 * Checks a Nano block hash against the network's RPC to verify a payment.
 * Agents can use this after paying to confirm the payment is on-chain.
 * This is a read-only RPC proxy — does not hold keys.
 */
function handleVerifyPayment(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const blockHash = url.searchParams.get("block");
  const account = url.searchParams.get("account");
  if (!blockHash || !/^[0-9A-Fa-f]{64}$/.test(blockHash)) {
    return send(res, 400, { verified: false, error: "missing or invalid block hash (expected 64 hex chars)" });
  }
  // Use the public RPC to check this block
  const https = require("https");
  const rpcPayload = JSON.stringify({ action: "block_info", json_block: "true", hash: blockHash });
  const rpcReq = https.request("https://rpc.nano.to", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rpcPayload) },
  }, (rpcRes) => {
    let data = "";
    rpcRes.on("data", c => data += c);
    rpcRes.on("end", () => {
      try {
        const json = JSON.parse(data);
        if (json.error) return send(res, 200, { verified: false, error: json.error });
        // Check the block is a send or receive and the account matches
        const matchesAccount = !account || json.block_account === account ||
          (json.subtype === "send" && json.contents && json.contents.link === account);
        send(res, 200, {
          verified: !json.error && json.confirmed === "true",
          hash: blockHash,
          account: json.block_account || null,
          amount: json.amount || "0",
          subtype: json.subtype || null,
          height: json.height || null,
          confirmed: json.confirmed === "true",
          matchesAccount: !!matchesAccount,
        });
      } catch (e) {
        send(res, 200, { verified: false, error: "failed to parse RPC response" });
      }
    });
  });
  rpcReq.on("error", (e) => send(res, 200, { verified: false, error: `RPC error: ${e.message}` }));
  rpcReq.write(rpcPayload);
  rpcReq.end();
}

// --- Server --------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Nano-Payment, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const path = parsed.pathname;

  if (req.method === "GET" && path === "/health") {
    return send(res, 200, { status: "ok", bounty_asset: n.VALID_ASSET });
  }

  if (req.method === "POST" && path === "/ask") return handleCreateAsk(req, res);
  if (req.method === "GET" && path === "/asks") return handleListAsks(req, res);
  // On-ramp: the conversion plan's step 3, served by the network itself (Block 41).
  if (req.method === "GET" && (path === "/try-nano" || path === "/v1/onramp")) return handleTryNano(req, res);

  const getAsk = path.match(/^\/ask\/(\d+)$/);
  if (req.method === "GET" && getAsk) return handleGetAsk(req, res, getAsk[1]);

  const ans = path.match(/^\/ask\/(\d+)\/answers$/);
  if (req.method === "POST" && ans) return handleAddAnswer(req, res, ans[1]);

  const acc = path.match(/^\/ask\/(\d+)\/accept$/);
  if (req.method === "POST" && acc) return handleAccept(req, res, acc[1]);

  const settle = path.match(/^\/ask\/(\d+)\/settle$/);
  if (req.method === "POST" && settle) return handleSettle(req, res, settle[1]);

  if (req.method === "GET" && path === "/standing") return handleStanding(req, res);
  // Standard .well-known endpoints for agent/x402 discovery
  if (req.method === "GET" && path === "/.well-known/x402") return handleX402(req, res);
  if (req.method === "GET" && path === "/.well-known/agent.json") return handleAgentDotWellKnown(req, res);
  if (req.method === "GET" && path === "/v1/x402") return handleX402(req, res);
  if (req.method === "POST" && path === "/v1/echo") return handleEcho(req, res);
  // x402 verify-payment for agents that have already paid
  if (req.method === "GET" && path.startsWith("/v1/verify-payment")) {
    handleVerifyPayment(req, res);
    return;
  }

  send(res, 404, { error: "not found" });
});

module.exports = { server, s };

// Only start listening when run directly (not when required by tests).
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Unstuck network API (persistent) listening on port ${PORT}`);
  });
}