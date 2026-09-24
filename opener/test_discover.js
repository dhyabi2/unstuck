/**
 * Tests for discover.js (Block 1 of the stack).
 *
 * Laws under test:
 *   L0: discovery reads, filters, and records correctly without opening for refused addresses.
 *   L1: ledger output has the right structure — block null for pending, status="pending", amount_raw set.
 *
 * Run: node test_discover.js
 */
const assert = require("assert");
const nano = require("nanocurrency");
const path = require("path");
const fs = require("fs");
const os = require("os");

const opener = require("./opener.js");
const discover = require("./discover.js");

// Create a virtual filesystem via memory: a map of fake file paths to content
class MemFS {
  constructor() {
    this.files = {};
  }
  writeFileSync(p, content) {
    this.files[p] = content;
  }
  readFileSync(p, encoding) {
    if (!this.files[p]) throw new Error(`ENOENT: ${p}`);
    if (encoding === "utf-8") return this.files[p];
    return Buffer.from(this.files[p]);
  }
  existsSync(p) {
    return p in this.files;
  }
}

// Test identities
const SEED = "A".repeat(64);
const sk0 = nano.deriveSecretKey(SEED, 0);
const self = nano.deriveAddress(nano.derivePublicKey(sk0), { useNanoPrefix: true });
const valid1 = nano.deriveAddress(nano.derivePublicKey(nano.deriveSecretKey(SEED, 1)), { useNanoPrefix: true });
const valid2 = nano.deriveAddress(nano.derivePublicKey(nano.deriveSecretKey(SEED, 2)), { useNanoPrefix: true });
const valid3 = nano.deriveAddress(nano.derivePublicKey(nano.deriveSecretKey(SEED, 3)), { useNanoPrefix: true });

// Invalid addresses
const invalid = "nano_notanaddress";
const ownAddr = self;

let failed = 0;
const law = (n, fn) => {
  try { fn(); console.log(`ok   ${n}`); }
  catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
};

// --- Setup: create a memfs with test fixtures ---
function setupFixtureFiles() {
  const mfs = new MemFS();

  // Source A: JSON array of strings
  mfs.writeFileSync("/fixtures/src-a.json", JSON.stringify([
    valid1,
    invalid,
    valid2,
    ownAddr,
  ], null, 2));

  // Source B: JSON array of objects with address + found_via
  mfs.writeFileSync("/fixtures/src-b.json", JSON.stringify([
    { address: valid3, found_via: "test-directory" },
  ], null, 2));

  // Source C: newline-separated
  mfs.writeFileSync("/fixtures/src-c.txt", `${valid1}\nnano_bad1\n${valid2}\n`);

  return mfs;
}

// --- L0: discovery reads, filters, records correctly ---

law("L0 refuses invalid addresses", () => {
  const mfs = setupFixtureFiles();
  const emptyLedger = { opened: [] };

  // Only source A: valid1, invalid, valid2, self
  const config = {
    sources: [{ name: "src-a", path: "/fixtures/src-a.json" }],
    opener,
    self,
    ledger: emptyLedger,
  };
  const result = discover.discover(nano, config, mfs);

  // 4 candidates total
  assert.strictEqual(result.candidates_total, 4, "should have 4 candidates");

  // 2 approved: valid1, valid2
  assert.strictEqual(result.approved.length, 2, "should approve 2 valid addresses (not self, not invalid)");
  assert.ok(result.approved.some(a => a.address === valid1), "valid1 should be approved");
  assert.ok(result.approved.some(a => a.address === valid2), "valid2 should be approved");

  // 2 refused: invalid, self
  assert.strictEqual(result.refused.length, 2, "should refuse 2 addresses");
  const refusedStrs = result.refused.map(r => r.address);
  assert.ok(refusedStrs.includes(invalid), "invalid address should be in refused");
  assert.ok(refusedStrs.includes(ownAddr), "own address should be in refused");
});

law("L0 respects the opener's refusal gate (already opened)", () => {
  const mfs = setupFixtureFiles();
  // valid1 is already in the opened ledger
  const ledgerWithOpen = { opened: [{ account: valid1 }] };

  const config = {
    sources: [{ name: "src-a", path: "/fixtures/src-a.json" }],
    opener,
    self,
    ledger: ledgerWithOpen,
  };
  const result = discover.discover(nano, config, mfs);

  // Only valid2 should be approved now (valid1 is in the ledger)
  assert.strictEqual(result.approved.length, 1, "should approve 1 (valid2 only)");
  assert.strictEqual(result.approved[0].address, valid2, "the approved one should be valid2");
});

law("L0 reads multiple source formats", () => {
  const mfs = setupFixtureFiles();
  const emptyLedger = { opened: [] };

  const config = {
    sources: [
      { name: "src-a", path: "/fixtures/src-a.json" },
      { name: "src-b", path: "/fixtures/src-b.json" },
      { name: "src-c", path: "/fixtures/src-c.txt" },
    ],
    opener,
    self,
    ledger: emptyLedger,
  };
  const result = discover.discover(nano, config, mfs);

  // src-a: valid1, invalid, valid2, self (4)
  // src-b: valid3 (1)
  // src-c: valid1, nano_bad1, valid2 (3)
  // Total candidates: 4 + 1 + 3 = 8 (before dedup — current impl doesn't dedup; that's a future refinement)
  assert.strictEqual(result.candidates_total, 8, "should have 8 total candidates across 3 sources");
  // At minimum, unique valid addresses: valid1 (from src-a, src-c), valid2 (from src-a, src-c), valid3 (src-b)
  // Plus invalid: invalid (src-a), nano_bad1 (src-c)
  // Plus self (src-a)
  assert.ok(result.approved.length >= 1, "should approve at least some addresses");
});

// --- L1: ledger output structure ---

law("L1 writePlannedLedger produces correctly structured ledger", () => {
  const approved = [
    { address: valid1, source_name: "test", found_via: "test" },
    { address: valid2, source_name: "test", found_via: "test" },
  ];
  const ts = "2026-09-17T12:00:00.000Z";
  const ledger = discover.writePlannedLedger(approved, ts);

  // Has required top-level fields
  assert.strictEqual(ledger.generated_at, ts);
  assert.strictEqual(ledger.source, "unstuck opener discovery");
  assert.ok(Array.isArray(ledger.openings));

  // Correct number of entries
  assert.strictEqual(ledger.openings.length, 2, "should have 2 openings");

  for (const entry of ledger.openings) {
    assert.strictEqual(entry.block, null, "block should be null for pending openings");
    assert.strictEqual(entry.status, "pending", "status should be 'pending'");
    assert.strictEqual(entry.amount_raw, "10000000000000000000000", "amount should match STARTER_RAW");
    assert.ok(entry.account, "account should be set");
    assert.ok(entry.found_via, "found_via should be set");
  }

  // Specific values
  assert.strictEqual(ledger.openings[0].account, valid1);
  assert.strictEqual(ledger.openings[1].account, valid2);
});

law("L1 empty approved list produces valid ledger with 0 openings", () => {
  const ts = "2026-09-17T12:00:00.000Z";
  const ledger = discover.writePlannedLedger([], ts);
  assert.ok(Array.isArray(ledger.openings), "openings should be an array even when empty");
  assert.strictEqual(ledger.openings.length, 0, "should have 0 openings");
  assert.strictEqual(ledger.source, "unstuck opener discovery");
});

// --- readSource tests ---

law("readSource parses JSON array of strings", () => {
  const mfs = setupFixtureFiles();
  const items = discover.readSource(mfs, "/fixtures/src-a.json", "src-a");
  assert.strictEqual(items.length, 4, "should read 4 items");
  assert.strictEqual(items[0].address, valid1);
  assert.strictEqual(items[0].source_name, "src-a");
  assert.strictEqual(items[1].address, invalid);
});

law("readSource parses JSON array of objects", () => {
  const mfs = setupFixtureFiles();
  const items = discover.readSource(mfs, "/fixtures/src-b.json", "src-b");
  assert.strictEqual(items.length, 1, "should read 1 item");
  assert.strictEqual(items[0].address, valid3);
  assert.strictEqual(items[0].found_via, "test-directory");
});

law("readSource parses newline-separated text", () => {
  const mfs = setupFixtureFiles();
  const items = discover.readSource(mfs, "/fixtures/src-c.txt", "src-c");
  assert.strictEqual(items.length, 3, "should read 3 lines");
  assert.strictEqual(items[0].address, valid1);
  assert.strictEqual(items[1].address, "nano_bad1");
});

// --- Report ---
console.log(failed ? `\n${failed} test(s) failed` : "\nall laws pass");
process.exit(failed ? 1 : 0);