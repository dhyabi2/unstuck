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
      });
      send(res, 201, { id: ask.id, status: ask.status });
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  }).catch(() => send(res, 400, { error: "invalid JSON body" }));
}

function handleListAsks(req, res) {
  const status = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("status") || null;
  const list = s.listAsks(status);
  send(res, 200, { asks: list });
}

function handleGetAsk(req, res, id) {
  const ask = s.getAsk(Number(id));
  if (!ask) return send(res, 404, { error: `no ask ${id}` });
  send(res, 200, { ask });
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

  const getAsk = path.match(/^\/ask\/(\d+)$/);
  if (req.method === "GET" && getAsk) return handleGetAsk(req, res, getAsk[1]);

  const ans = path.match(/^\/ask\/(\d+)\/answers$/);
  if (req.method === "POST" && ans) return handleAddAnswer(req, res, ans[1]);

  const acc = path.match(/^\/ask\/(\d+)\/accept$/);
  if (req.method === "POST" && acc) return handleAccept(req, res, acc[1]);

  const settle = path.match(/^\/ask\/(\d+)\/settle$/);
  if (req.method === "POST" && settle) return handleSettle(req, res, settle[1]);

  if (req.method === "GET" && path === "/standing") return handleStanding(req, res);
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