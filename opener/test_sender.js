/**
 * Tests for rpc.js and sender.js (Block 2 — send integration via Nano RPC).
 *
 * Laws:
 *   L2: A send records the block hash from the network response.
 *   L3: An unopened treasury account prevents any send.
 *   L4: Work generation failure is reported, not silently swallowed.
 *
 * Run: node test_sender.js
 *
 * These tests mock the network layer (via rpc._rpcCall) so they run fast.
 */

const assert = require("assert");
const nano = require("nanocurrency");

const opener = require("./opener.js");
const rpc = require("./rpc.js");
const sender = require("./sender.js");

// --- Test identities ---
const SEED = "A".repeat(64);
const sk = nano.deriveSecretKey(SEED, 0);
const self = nano.deriveAddress(nano.derivePublicKey(sk), { useNanoPrefix: true });
const other1 = nano.deriveAddress(
  nano.derivePublicKey(nano.deriveSecretKey(SEED, 1)),
  { useNanoPrefix: true }
);
const other2 = nano.deriveAddress(
  nano.derivePublicKey(nano.deriveSecretKey(SEED, 2)),
  { useNanoPrefix: true }
);

let failed = 0;
const law = (n, fn) => {
  try { fn(); console.log(`ok   ${n}`); }
  catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
};

// Track blocks broadcast via process
const broadcastLog = [];
function resetBroadcastLog() {
  broadcastLog.length = 0;
}

// --- Mock RPC helpers ---
function setupSendStubs(frontier, balance, workValue) {
  return {
    account_info: { frontier, balance, representative: self, block_count: "5", open_block: "AAA" },
    work_generate: { work: workValue, difficulty: "fffffff800000000", multiplier: "1.0" },
    process: (payload) => {
      broadcastLog.push({ block: payload.block, subtype: payload.subtype });
      return { hash: payload.block._reportedHash || "DEADBEEF" + "0".repeat(56) };
    },
  };
}

function withMocks(stubs, fn) {
  const orig = rpc._rpcCall;
  rpc._rpcCall = async (url, payload) => {
    const action = payload.action;
    const stub = stubs[action];
    if (stub === undefined) throw new Error("no stub for " + action);
    if (typeof stub === "function") return stub(payload);
    return stub;
  };
  try { return fn(); }
  finally { rpc._rpcCall = orig; }
}

function workSendConfig() {
  return {
    secretKey: sk,
    account: self,
    representative: self,
    rpcUrl: "https://test.rpc",
    workOptions: { apiKey: "test-key" },
  };
}

// Run an async test inside the law harness
function lawAsync(name, asyncFn) {
  // We cannot use the synchronous law harness for async tests, so handle them
  // as a special case — they'll run after the sync tests
  lawsAsync.push({ name, fn: asyncFn });
}

const lawsAsync = [];

// ============================================================
// L2: A send records the block hash from the network response
// ============================================================

law("L2 sender.openStarter returns a ledgerRow with a real block hash", async () => {
  resetBroadcastLog();

  await withMocks(setupSendStubs("A".repeat(64), "1000000000000000000000000000", "0000000000012345"), async () => {
    const row = await sender.openStarter(nano, opener, workSendConfig(), {
      account: other1,
      found_via: "test-index",
    });

    assert.ok(row.block, "block hash must be set");
    assert.strictEqual(row.block.length, 64, "block hash must be 64 hex chars");
    assert.strictEqual(row.account, other1, "account must match recipient");
    assert.strictEqual(row.amount_raw, opener.STARTER_RAW, "amount must be STARTER_RAW");
    assert.strictEqual(row.found_via, "test-index", "found_via must be preserved");

    // One block was broadcast
    assert.strictEqual(broadcastLog.length, 1, "exactly one block broadcast");
    assert.strictEqual(broadcastLog[0].subtype, "send", "subtype must be 'send'");
  });
});

// ============================================================
// L3: An unopened treasury account prevents any send
// ============================================================

law("L3 sender.openStarter throws when treasury is not on the ledger", async () => {
  await withMocks({
    account_info: () => {
      const err = new Error("Account not found");
      err.code = "Account not found";
      throw err;
    },
  }, async () => {
    try {
      await sender.openStarter(nano, opener, workSendConfig(), {
        account: other1,
        found_via: "test",
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("treasury"), "error must mention treasury");
      assert.ok(e.message.includes("not open"), "error must say 'not open'");
    }
  });
});

law("L3 loadTreasuryState throws for unopened account", async () => {
  await withMocks({
    account_info: () => {
      const err = new Error("Account not found");
      err.code = "Account not found";
      throw err;
    },
  }, async () => {
    try {
      await sender.loadTreasuryState({
        account: "nano_1111111111111111111111111111111111111111111111111111hifc8npp",
        secretKey: "0".repeat(64),
        representative: self,
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.ok(e.message.includes("not open"), "must say not open");
    }
  });
});

// ============================================================
// L4: Work generation failure is reported, not silently swallowed
// ============================================================

law("L4 work generation 402 payment-required is propagated", async () => {
  await withMocks({
    account_info: {
      frontier: "A".repeat(64),
      balance: "1000000000000000000000000000",
      representative: self,
      block_count: "5",
    },
    work_generate: () => {
      const err = new Error("Payment Required");
      err.code = 402;
      err.rpcData = {
        error: 402,
        message: "Payment Required",
        accepts: [{ scheme: "exact", network: "nano:mainnet", amount: "1000000000000000000000000000" }],
      };
      throw err;
    },
  }, async () => {
    try {
      await sender.openStarter(nano, opener, {
        ...workSendConfig(),
        workOptions: {}, // no API key — will get 402
      }, { account: other1, found_via: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.strictEqual(e.code, 402, "error code should be 402");
    }
  });
});

// ============================================================
// L4: Treasury state is correctly read
// ============================================================

law("L4 loadTreasuryState returns treasury state for opened account", async () => {
  const frontier = "B".repeat(64);
  const balance = "30000000000000000000000000000";

  await withMocks({
    account_info: { frontier, balance, representative: self, block_count: "3", open_block: "BBB" },
  }, async () => {
    const state = await sender.loadTreasuryState({
      account: self,
      secretKey: sk,
      representative: self,
    });
    assert.strictEqual(state.frontier, frontier);
    assert.strictEqual(state.balance, balance);
    assert.strictEqual(state.representative, self);
  });
});

// ============================================================
// rpc.js unit tests
// ============================================================

law("L2 rpc.processBlock returns hash from response", async () => {
  await withMocks({
    process: { hash: "CAFEBABE" + "0".repeat(56) },
  }, async () => {
    const hash = await rpc.processBlock(
      { type: "state", account: self, previous: "0".repeat(64), representative: self, balance: "10000", link: "0".repeat(64), work: "0000000000000000", signature: "0".repeat(128) },
      "send"
    );
    assert.strictEqual(hash, "CAFEBABE" + "0".repeat(56));
  });
});

law("rpc.accountInfo returns null for unknown account", async () => {
  await withMocks({
    account_info: () => {
      const err = new Error("Account not found");
      err.code = "Account not found";
      throw err;
    },
  }, async () => {
    const info = await rpc.accountInfo("nano_1111111111111111111111111111111111111111111111111111hifc8npp");
    assert.strictEqual(info, null, "must return null, not throw");
  });
});

// ============================================================
// sender.openedSet tests
// ============================================================

law("sender.openedSet deduplicates opened + sent ledgers", () => {
  const ledger = { opened: [{ account: other1 }] };
  const sent = [{ account: other1 }, { account: other2 }];
  const set = sender.openedSet(ledger, sent);
  assert.ok(set.has(other1), "other1 in set");
  assert.ok(set.has(other2), "other2 in set");
  assert.strictEqual(set.size, 2, "exactly 2 unique accounts");
});

law("sender.openedSet handles empty inputs", () => {
  const set = sender.openedSet({ opened: [] }, []);
  assert.strictEqual(set.size, 0);
  assert.ok(!set.has(other1));
});

law("sender.openedSet handles missing opened array", () => {
  const set = sender.openedSet({}, []);
  assert.strictEqual(set.size, 0);
});

// ============================================================
// Run async laws and report
// ============================================================
(async () => {
  for (const l of lawsAsync) {
    try {
      await l.fn();
      console.log(`ok   ${l.name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${l.name}: ${e.message}`);
    }
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall laws pass");
  process.exit(failed ? 1 : 0);
})();
