#!/usr/bin/env node
/**
 * The laws of the receive path. It moves money INTO the treasury, so the thing worth pinning is not an amount — a
 * receive has no amount of its own to choose — but the invariant that it can only ever add.
 */
const assert = require("assert");
const r = require("./receive.js");

let pass = 0;
function law(name, fn) { fn(); pass++; console.log(`PASS ${name}`); }

law("a receive adds exactly the claimed amount", () => {
  // 9.89690989 XNO + 20.000005 XNO, the real figures the day this was written.
  assert.strictEqual(r.nextBalance("9896909890000000000000000000000", "20000005000000000000000000000000"),
    "29896914890000000000000000000000");
});

law("the balance must strictly increase", () => {
  assert.throws(() => r.nextBalance("1000", "0"), /positive amount/);
  assert.throws(() => r.nextBalance("1000", "-5"), /positive amount/);
});

law("an unopened account starts from zero", () => {
  assert.strictEqual(r.nextBalance("0", "10000000000000000000000000"), "10000000000000000000000000");
});

law("raw is arithmetic on BigInt, never on floats", () => {
  // 1 raw more than a float can represent. A Number here would round and silently lose the difference — which is the
  // same class of defect as the starter that shipped a thousandth of its intended size.
  assert.strictEqual(r.nextBalance("100000000000000000000000000000001", "1"), "100000000000000000000000000000002");
});

law("the receive threshold is the cheaper one, and is not the send threshold", () => {
  assert.strictEqual(r.RECEIVE_DIFFICULTY, "fffffe0000000000");
  assert.notStrictEqual(r.RECEIVE_DIFFICULTY, "fffffff800000000");
});

console.log(`\n${pass} laws pass`);
