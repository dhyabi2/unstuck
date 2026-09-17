/**
 * Laws of the opener. Run: node test_opener.js  (needs nanocurrency installed next to it)
 *
 * L1 An invalid address is never sent to.
 * L2 An address we have already opened is never opened again.
 * L3 We never send a starter to ourselves.
 * L4 A send that the balance cannot cover fails instead of sending.
 * L5 The balance after a starter is exactly the balance before minus 0.00001 XNO.
 * L6 An opening is recorded by address AND block hash, or not recorded at all.
 * L7 A published share always carries the sources of its denominator.
 */

const assert = require("assert");
const nano = require("nanocurrency");
const o = require("./opener.js");

const SEED = "A".repeat(64);
const sk = nano.deriveSecretKey(SEED, 0);
const self = nano.deriveAddress(nano.derivePublicKey(sk), { useNanoPrefix: true });
const other = nano.deriveAddress(nano.derivePublicKey(nano.deriveSecretKey(SEED, 1)), { useNanoPrefix: true });

let failed = 0;
const law = (n, fn) => {
  try { fn(); console.log(`ok   ${n}`); }
  catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
};

law("L1 invalid address refused", () => {
  const ledger = { opened: [] };
  assert.match(o.refusal(nano, "nano_notanaddress", ledger, self), /valid Nano address/);
  assert.strictEqual(o.refusal(nano, other, ledger, self), null);
});

law("L2 already-opened address refused", () => {
  const ledger = { opened: [{ account: other }] };
  assert.match(o.refusal(nano, other, ledger, self), /already opened/);
});

law("L3 our own account refused", () => {
  assert.match(o.refusal(nano, self, { opened: [] }, self), /our own account/);
});

law("L4 uncoverable send fails", () => {
  assert.throws(() => o.nextBalance("5000000000000000000000"), /cannot cover/);
  assert.throws(() => o.nextBalance("0"), /cannot cover/);
});

law("L5 balance after is exactly minus the starter, and the starter is really 0.00001 XNO", () => {
  const XNO = 10n ** 30n; // 1 XNO in raw — the unit that makes this law worth having
  const before = (XNO / 1000n).toString(); // 0.001 XNO
  const after = o.nextBalance(before);
  assert.strictEqual(BigInt(before) - BigInt(after), BigInt(o.STARTER_RAW));
  // Derive the expected amount rather than restating the literal: the previous version of this law asserted the
  // constant against itself, so it passed happily while the starter was 1000x too small.
  assert.strictEqual(BigInt(o.STARTER_RAW), XNO / 100000n, "the starter must be 0.00001 XNO");
  // A starter below a node's default receive_minimum (0.000001 XNO) may never be auto-received.
  assert.ok(BigInt(o.STARTER_RAW) > XNO / 1000000n, "the starter must clear the default receive_minimum");
});

law("L6 an opening needs an address and a block hash", () => {
  assert.throws(() => o.ledgerRow({ account: other, block: "", at: "2026-09-17" }), /block hash/);
  assert.throws(() => o.ledgerRow({ account: "", block: "ABC", at: "2026-09-17" }), /block hash/);
  const row = o.ledgerRow({ account: other, block: "ABC", at: "2026-09-17", found_via: "moltbook index" });
  assert.strictEqual(row.amount_raw, o.STARTER_RAW);
  assert.strictEqual(row.found_via, "moltbook index");
});

law("L7 no share without its denominator's sources", () => {
  assert.throws(() => o.counts({ opened: 10, agentsActive: 100, unsubsidised: 0, sources: [] }), /denominator/);
  const c = o.counts({ opened: 10, agentsActive: 100, unsubsidised: 0, sources: [{ name: "x", n: 100 }] });
  assert.strictEqual(c.share_opened, 0.1);
  assert.strictEqual(c.unsubsidised_transactions, 0);
});

law("L8 we cannot send from an unopened account", () => {
  // An account's chain begins with a receive, so a send whose previous is the zero hash is impossible. This is the
  // same fact the whole project rests on: nobody opens their own account, including us.
  assert.throws(() => o.sendBlock(nano, {
    secretKey: sk, account: self, previous: "0".repeat(64), representative: self,
    balanceRaw: "1000000000000000000000000000", to: other,
  }), /impossible/i);
});

law("signing matches holdergameDex's call shape", () => {
  const b = o.sendBlock(nano, {
    secretKey: sk,
    account: self,
    previous: "B".repeat(64), // our frontier, once someone has opened us
    representative: self,
    balanceRaw: "1000000000000000000000000000",
    to: other,
  });
  assert.strictEqual(b.hash.length, 64);
  assert.strictEqual(b.block.signature.length, 128);
  assert.strictEqual(BigInt(b.balanceAfter), BigInt("1000000000000000000000000000") - BigInt(o.STARTER_RAW));
});

console.log(failed ? `\n${failed} law(s) failed` : "\nall laws pass");
process.exit(failed ? 1 : 0);
