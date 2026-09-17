/**
 * Laws of the openings ledger. Run: node test_openings.js
 *
 * These are the laws that stand between "one starter per agent, ever" and an irreversible second send.
 *
 * L1  A first claim succeeds.
 * L2  A second claim on the same address is refused, whatever state the first is in.
 * L3  Two racing claims produce exactly one winner.
 * L4  A confirm without a 64-character block hash is refused.
 * L5  Only a reservation can be confirmed, and only once.
 * L6  A release requires a stated reason and makes the address claimable again.
 * L7  An unknown outcome is never claimable again.
 * L8  Only sent rows count as openings.
 * L9  The lock excludes a second live sender and ignores a dead one.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const led = require("./openings.js");

const A = "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";
const B = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const HASH = "A".repeat(64);

let failed = 0;
const law = (n, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openings-"));
  try { fn(path.join(dir, "openings.db"), dir); console.log(`ok   ${n}`); }
  catch (e) { failed++; console.log(`FAIL ${n}: ${e.message}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

law("L1 a first claim succeeds", (p) => {
  const db = led.open(p);
  assert.strictEqual(led.reserve(db, A, { foundVia: "test" }).ok, true);
  assert.deepStrictEqual(led.counts(db), { sent: 0, reserved: 1, unknown: 0 });
});

law("L2 a second claim is refused", (p) => {
  const db = led.open(p);
  led.reserve(db, A);
  const second = led.reserve(db, A);
  assert.strictEqual(second.ok, false);
  assert.match(second.reason, /already reserved/);
  led.confirm(db, A, HASH);
  const third = led.reserve(db, A);
  assert.strictEqual(third.ok, false);
  assert.match(third.reason, /already sent/);
  assert.strictEqual(third.block, HASH);
});

law("L3 two racing claims produce exactly one winner", (p) => {
  const db1 = led.open(p);
  const db2 = led.open(p);
  const r1 = led.reserve(db1, A);
  const r2 = led.reserve(db2, A);
  assert.strictEqual([r1.ok, r2.ok].filter(Boolean).length, 1, "exactly one claim may win");
  assert.strictEqual(led.counts(db1).reserved, 1);
});

law("L4 a confirm needs a real block hash", (p) => {
  const db = led.open(p);
  led.reserve(db, A);
  assert.throws(() => led.confirm(db, A, ""), /block hash/);
  assert.throws(() => led.confirm(db, A, "TOOSHORT"), /block hash/);
});

law("L5 only a reservation can be confirmed, once", (p) => {
  const db = led.open(p);
  assert.throws(() => led.confirm(db, B, HASH), /no reservation/);
  led.reserve(db, B);
  led.confirm(db, B, HASH);
  assert.throws(() => led.confirm(db, B, HASH), /no reservation/);
});

law("L6 release needs a reason and frees the address", (p) => {
  const db = led.open(p);
  led.reserve(db, A);
  assert.throws(() => led.release(db, A), /stated reason/);
  assert.strictEqual(led.release(db, A, "nothing was broadcast").ok, true);
  assert.strictEqual(led.reserve(db, A).ok, true, "a released address may be claimed again");
});

law("L7 an unknown outcome is never claimable again", (p) => {
  const db = led.open(p);
  led.reserve(db, A);
  assert.strictEqual(led.markUnknown(db, A, "process call failed").ok, true);
  const again = led.reserve(db, A);
  assert.strictEqual(again.ok, false);
  assert.match(again.reason, /already unknown/);
  assert.strictEqual(led.release(db, A, "try to force it").ok, false, "release must not resurrect an unknown");
});

law("L8 only sent rows are openings", (p) => {
  const db = led.open(p);
  led.reserve(db, A); led.confirm(db, A, HASH);
  led.reserve(db, B); // still only reserved
  const rows = led.opened(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].account, A);
  assert.strictEqual(rows[0].block, HASH);
  assert.deepStrictEqual(led.counts(db), { sent: 1, reserved: 1, unknown: 0 });
});

law("L9 the lock excludes a live sender and ignores a dead one", (p, dir) => {
  const lp = path.join(dir, "sender.lock");
  const first = led.lock(lp);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(led.lock(lp).ok, false, "a live lock excludes a second sender");
  first.release();
  assert.strictEqual(led.lock(lp).ok, true, "a released lock is free");
  fs.writeFileSync(lp, "999999"); // a pid that is not running
  assert.strictEqual(led.lock(lp).ok, true, "a dead owner's lock is taken over");
});

console.log(failed ? `\n${failed} law(s) failed` : "\nall laws pass");
process.exit(failed ? 1 : 0);
