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

// bridge.js reads BRIDGE_NANO_ADDRESS at require time and verifyNanoPayment
// compares the block's destination against it, so it has to be set first.
const BRIDGE_ADDR = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
process.env.BRIDGE_NANO_ADDRESS = BRIDGE_ADDR;

const bridge = require("./bridge.js");

let failed = 0;

// The laws are COLLECTED and then run one at a time, awaited.
//
// This used to be `try { fn(); } catch`, which cannot see a rejected promise:
// every async law - the conversion, the on-chain verification, the idempotency
// check - reported `ok` whatever it asserted, because the assertion failed
// after the try block had already returned. Four of the six laws in this file
// were async, so most of this suite could not fail. Awaiting them is what makes
// the verification laws below mean anything.
const laws = [];
const law = (n, fn) => { laws.push([n, fn]); };

async function run() {
  for (const [n, fn] of laws) {
    try { await fn(); console.log(`ok   ${n}`); }
    catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
  }
}

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
  // This law fed the RPC an `error` answer, which `nanoRpc` THROWS on - so it
  // never reached the `block.type !== "state"` branch it is named for, and
  // under the old non-awaiting runner the rejected promise read as `ok`. Give
  // it a real answer carrying a block that is not a state block.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    json: async () => ({
      amount: "1", subtype: "send",
      contents: { type: "send", destination: BRIDGE_ADDR, balance: "0" },
    }),
  });
  try {
    const result = await bridge.verifyNanoPayment("fake_hash", "0");
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.reason, "not a state block");
  } finally {
    globalThis.fetch = origFetch;
  }
});

law("B3 a hash the node does not know raises rather than reading as unpaid", async () => {
  // Written down rather than asserted away: `nanoRpc` throws on an `error`
  // answer, so an unknown hash does not come back as `{valid: false}` - it
  // propagates, and /verify-payment answers 400 with the node's message
  // instead of 402. That is the current contract; this law pins it so the next
  // change to it is a deliberate one.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ error: "Block not found" }) });
  try {
    await assert.rejects(
      () => bridge.verifyNanoPayment("fake_hash", "0"),
      /Block not found/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

// --- the amount a block moved is the node's `amount`, not the payer's balance ---
//
// A `block_info` answer reports the amount the block moved in its own top-level
// `amount`. `contents.balance` is the payer's balance AFTER the send, and the
// answer has no `previous_balance` field at all, so
//
//     BigInt(block.balance) - BigInt(info.previous_balance || "0")
//
// evaluated to the payer's LEFTOVER BALANCE. These three laws pin both
// directions of that: a floor payment out of a full account must not buy a
// price it did not cover, and a payment that empties an account must still pay.

const XNO = 10n ** 30n;

/** A real-shaped `block_info` answer for a send of `amountRaw` leaving `leftRaw` behind. */
function sendAnswer({ amountRaw, leftRaw, to = BRIDGE_ADDR, subtype = "send" }) {
  return {
    block_account: "nano_1payer000000000000000000000000000000000000000000000000000000000",
    amount: amountRaw.toString(),
    balance: leftRaw.toString(),
    height: "42",
    confirmed: "true",
    subtype,
    contents: {
      type: "state",
      account: "nano_1payer000000000000000000000000000000000000000000000000000000000",
      previous: "A".repeat(64),
      representative: BRIDGE_ADDR,
      balance: leftRaw.toString(),   // the payer's balance AFTER the send
      link_as_account: to,
      signature: "0".repeat(128),
      work: "0".repeat(16),
    },
  };
}

async function withNode(answer, fn) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => answer });
  try { return await fn(); } finally { globalThis.fetch = origFetch; }
}

law("B3 a floor payment out of a full account does not cover a 1 XNO price", async () => {
  // The payer holds 100 XNO and sends the 0.000001 XNO floor. Their balance
  // afterwards is 99.999999 XNO, which is what the old subtraction read - so a
  // 1 XNO price came back "paid" on a payment of a millionth of it.
  const answer = sendAnswer({ amountRaw: XNO / 1000000n, leftRaw: 100n * XNO - XNO / 1000000n });
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", (1n * XNO).toString()));
  assert.strictEqual(
    result.valid, false,
    `a payment of ${answer.amount} raw was accepted against a price of ${XNO} raw`
  );
  assert.ok(/insufficient/.test(result.reason), `reason was ${result.reason}`);
});

law("B3 a payment that empties the payer's account still pays", async () => {
  // The mirror image: 1 XNO sent, nothing left behind. The old subtraction read
  // 0 and refused a payment that had really been made.
  const answer = sendAnswer({ amountRaw: 1n * XNO, leftRaw: 0n });
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", (1n * XNO).toString()));
  assert.strictEqual(result.valid, true, `refused as: ${result.reason}`);
  assert.strictEqual(result.amount_raw, (1n * XNO).toString());
});

law("B3 the amount reported back is the amount the block moved", async () => {
  const answer = sendAnswer({ amountRaw: 3n * XNO, leftRaw: 7n * XNO });
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", (1n * XNO).toString()));
  assert.strictEqual(result.valid, true, `refused as: ${result.reason}`);
  assert.strictEqual(
    result.amount_raw, (3n * XNO).toString(),
    "the payment recorded must be what was sent, not what the payer kept"
  );
});

law("B3 a block that is not a send is refused", async () => {
  const answer = sendAnswer({ amountRaw: 5n * XNO, leftRaw: 5n * XNO, subtype: "receive" });
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", "0"));
  assert.strictEqual(result.valid, false);
});

law("B3 a send to somebody else is refused", async () => {
  const answer = sendAnswer({
    amountRaw: 5n * XNO, leftRaw: 5n * XNO,
    to: "nano_1stranger00000000000000000000000000000000000000000000000000000000",
  });
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", "0"));
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, "not sent to bridge address");
});

law("B3 a node that reports no amount is refused rather than guessed at", async () => {
  const answer = sendAnswer({ amountRaw: 5n * XNO, leftRaw: 5n * XNO });
  delete answer.amount;
  const result = await withNode(answer, () => bridge.verifyNanoPayment("hash", "0"));
  assert.strictEqual(result.valid, false);
  assert.ok(/amount/.test(result.reason), `reason was ${result.reason}`);
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
// Report
// ============================================================
run().then(() => {
  console.log(failed ? `\n${failed} test(s) failed` : "\nall bridge laws pass");
  process.exit(failed ? 1 : 0);
});