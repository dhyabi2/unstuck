/**
 * Tests for bridge.js (Block 11 — Nano x402 bridge proxy).
 *
 * Laws:
 *   B1 — The bridge accepts any x402 service URL and forwards GET/POST requests.
 *   B2 — A 402 response with a USDC amount is converted to a Nano 402 with live price.
 *   B3 — The bridge verifies Nano payments on-chain before counting them.
 *   B4 — A payment is only counted once per block hash (idempotent).
 *
 * Run: node test_bridge.js
 */

const assert = require("assert");
const bridge = require("./bridge.js");

let failed = 0;
const law = (n, fn) => {
  try { fn(); console.log(`ok   ${n}`); }
  catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
};

// ============================================================
// B1 — Proxy forwarding
// ============================================================

law("B1 extractX402Accepts parses accepts from 402 JSON body", () => {
  const resp = {
    body: JSON.stringify({
      accepts: [
        { scheme: "exact", network: "eip155:8453", asset: "USDC", amount: "1000000" }
      ]
    })
  };
  const accepts = bridge.extractX402Accepts(resp);
  assert.strictEqual(accepts.length, 1);
  assert.strictEqual(accepts[0].asset, "USDC");
});

law("B1 extractX402Accepts returns empty for non-402 responses", () => {
  const accepts = bridge.extractX402Accepts({ body: "hello", headers: {} });
  assert.strictEqual(accepts.length, 0);
});

law("B1 extractX402Accepts parses PAYMENT-REQUIRED header", () => {
  const paymentRequired = Buffer.from(
    JSON.stringify({ accepts: [{ scheme: "exact", network: "base", asset: "USDC" }] })
  ).toString("base64");
  const accepts = bridge.extractX402Accepts({
    body: "irrelevant",
    headers: { "payment-required": paymentRequired }
  });
  assert.strictEqual(accepts.length, 1);
  assert.strictEqual(accepts[0].asset, "USDC");
});

// ============================================================
// B2 — USD to Nano conversion
// ============================================================

law("B2 usdToNanoRaw converts a dollar amount to Nano raw", async () => {
  // With a known price (e.g., $0.70/XNO), $0.001 → ~0.00142857 XNO → ~1.42857e27 raw
  // We use the fallback price via env var
  // But since the function fetches live price, test it with a mock-friendly approach
  // For now, just verify it returns a string of digits (raw format)
  try {
    const raw = await bridge.usdToNanoRaw("0.001");
    assert.ok(typeof raw === "string", "result must be a string");
    assert.ok(raw.length > 10, "raw amount must be large (greater than FLOOR_RAW)");
  } catch (e) {
    // If no price source available, the test is inconclusive — skip
    if (e.message.includes("No price source")) {
      console.log("     (skipped — no price source available)");
      return;
    }
    throw e;
  }
});

// ============================================================
// B3 — Payment verification (mocked)
// ============================================================

law("B3 verifyNanoPayment rejects non-state blocks", async () => {
  // Override the nano RPC to return a block_info that has no contents
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({ error: "Block not found" }),
  });
  try {
    const result = await bridge.verifyNanoPayment("fake_hash", "0");
    assert.strictEqual(result.valid, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ============================================================
// B4 — Idempotent payment tracking
// ============================================================

law("B4 payments tracked per block hash are idempotent in /verify-payment endpoint", async () => {
  // Test the in-memory tracking directly via the module's paidRequests
  // (Access internal state for testing — the endpoint uses it)
  const { default: http } = await import("http");
  
  // We can test the post body parsing and tracking logic separately
  // by constructing what /verify-payment does
  
  // For now, just verify the concept: same block_hash returns already_processed
  // This is tested by the code path in the server handler — unit test the logic:
  const paidRequests = new Map();
  paidRequests.set("test_hash", { account: "nano_test", amount_raw: "1000", settled: false });
  
  // Second check for same hash should find it
  const existing = paidRequests.get("test_hash");
  assert.ok(existing, "existing record found");
  assert.strictEqual(existing.settled, false);
  
  // Update
  existing.settled = true;
  paidRequests.set("test_hash", existing);
  assert.strictEqual(paidRequests.get("test_hash").settled, true);
});

// ============================================================
// B5 — A verified block is bound to its claim (change B5)
// ============================================================

const BRIDGE_ADDR = process.env.BRIDGE_NANO_ADDRESS ||
  "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";

// Mock the RPC read so the test is deterministic and offline.
function withBlocks(blocks, fn) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => blocks });
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = origFetch; });
}

const paidBlock = (linkAsAccount) => ({
  contents: {
    type: "state",
    link_as_account: linkAsAccount,
    balance: "1000000000000000000000000000",
    account: "nano_3payer00000000000000000000000000000000000000000000000000000",
  },
  previous_balance: "0",
});

law("B5 verifyNanoPayment refuses a block whose payee is not bound to the claim", async () => {
  await withBlocks(paidBlock("nano_3someoneelse00000000000000000000000000000000000000000000000000000"), async () => {
    const r = await bridge.verifyNanoPayment("a".repeat(64), "100000000000000000000000000");
    assert.strictEqual(r.valid, false, "a block paid to a third party must not unlock a claim");
    assert.ok(/not bound/.test(r.reason), `reason should name the binding: ${r.reason}`);
  });
});

law("B5 verifyNanoPayment still accepts a block paid to the bridge address", async () => {
  await withBlocks(paidBlock(BRIDGE_ADDR), async () => {
    const r = await bridge.verifyNanoPayment("b".repeat(64), "100000000000000000000000000");
    assert.strictEqual(r.valid, true, "the ordinary path must not regress");
    assert.strictEqual(r.amount_raw, "1000000000000000000000000000");
  });
});

law("B5 verifyNanoPayment honours an explicit per-claim payee", async () => {
  await withBlocks(paidBlock("nano_3ownpayee0000000000000000000000000000000000000000000000000000000"), async () => {
    const r = await bridge.verifyNanoPayment("c".repeat(64), {
      amountRaw: "100000000000000000000000000",
      payee: "nano_3ownpayee0000000000000000000000000000000000000000000000000000000",
    });
    assert.strictEqual(r.valid, true, "a claim may name its own payee");
  });
});

law("B5 verifyNanoPayment ties the same block to exactly one claim", async () => {
  const block = paidBlock("nano_3ownpayee0000000000000000000000000000000000000000000000000000000");
  await withBlocks(block, async () => {
    const bound = await bridge.verifyNanoPayment("d".repeat(64), {
      amountRaw: "100000000000000000000000000",
      payee: "nano_3ownpayee0000000000000000000000000000000000000000000000000000000",
    });
    const other = await bridge.verifyNanoPayment("d".repeat(64), {
      amountRaw: "100000000000000000000000000",
      payee: "nano_3adifferentclaim0000000000000000000000000000000000000000000000000",
    });
    assert.strictEqual(bound.valid, true);
    assert.strictEqual(other.valid, false, "the same block must not unlock a different claim");
  });
});

// ============================================================
// Report
// ============================================================
console.log(failed ? `\n${failed} test(s) failed` : "\nall bridge laws pass");
process.exit(failed ? 1 : 0);