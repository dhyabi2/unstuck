/**
 * rpc.js — Nano RPC client abstraction.
 *
 * Wraps the Nano node JSON RPC interface: account_info, process, work_generate.
 * Supports multiple RPC URLs with fallback.
 *
 * Block 2 — send integration.
 *
 * TESTABILITY: The internal `_rpcCall` reference is exported. Tests may override
 * it (e.g. `rpc._rpcCall = async (url, payload) => ...`) to avoid network calls.
 */

const DEFAULT_RPC = "https://rpc.nano.to";
const FALLBACK_RPC = "https://node.somenano.com/proxy";

const SEND_DIFFICULTY = "fffffff800000000"; // send/change difficulty
const WORK_GEN_COST_RAW = "1000000000000000000000000000"; // 0.001 XNO

/**
 * The actual network call to a Nano node.
 * Returns the parsed JSON response, or throws on HTTP/network/error response.
 */
async function _realRpcCall(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.error) {
    const err = new Error(data.message || data.error);
    err.code = data.error;
    err.rpcData = data;
    throw err;
  }
  return data;
}

// This is the indirection point. All internal calls go here.
// Tests can override it to mock network responses.
let _rpcCall = _realRpcCall;

/**
 * Get account info: frontier, balance, representative, block_count.
 * Returns null if the account doesn't exist on the ledger.
 */
async function accountInfo(account, rpcUrl = DEFAULT_RPC) {
  try {
    const data = await _rpcCall(rpcUrl, {
      action: "account_info",
      account,
      representative: "true",
    });
    return {
      frontier: data.frontier,
      balance: data.balance,
      representative: data.representative,
      blockCount: parseInt(data.block_count, 10),
      openBlock: data.open_block,
    };
  } catch (e) {
    if (e.message && e.message.includes("Account not found")) {
      return null;
    }
    throw e;
  }
}

/**
 * Broadcast a signed block to the network.
 * Returns the block hash on success.
 */
async function processBlock(block, subtype = "send", rpcUrl = DEFAULT_RPC) {
  const data = await _rpcCall(rpcUrl, {
    action: "process",
    json_block: "true",
    subtype,
    block,
  });
  return data.hash;
}

/**
 * Generate proof-of-work for a block hash.
 * Without an API key, rpc.nano.to returns 402 payment-required.
 */
async function generateWork(blockHash, options = {}) {
  const {
    rpcUrl = DEFAULT_RPC,
    apiKey = null,
    difficulty = SEND_DIFFICULTY,
  } = options;

  const payload = {
    action: "work_generate",
    hash: blockHash,
    difficulty,
  };
  if (apiKey) {
    payload.key = apiKey;
  }

  const data = await _rpcCall(rpcUrl, payload);
  return data.work;
}

/**
 * Execute one complete send: sign, generate work, broadcast.
 */
async function executeSend(nano, opener, params, workOptions = {}) {
  const blockResult = opener.sendBlock(nano, {
    secretKey: params.secretKey,
    account: params.account,
    previous: params.previous,
    representative: params.representative,
    balanceRaw: params.balanceRaw,
    to: params.to,
    starterRaw: params.starterRaw,
  });

  const work = await generateWork(blockResult.hash, workOptions);
  const signedBlock = { ...blockResult.block, work };
  const hash = await processBlock(signedBlock, "send");

  return {
    hash,
    block: signedBlock,
    balanceAfter: blockResult.balanceAfter,
  };
}

module.exports = {
  DEFAULT_RPC,
  FALLBACK_RPC,
  SEND_DIFFICULTY,
  WORK_GEN_COST_RAW,
  // Public API
  accountInfo,
  processBlock,
  generateWork,
  executeSend,
  // Testability hook
  get _rpcCall() { return _rpcCall; },
  set _rpcCall(fn) { _rpcCall = fn; },
};
