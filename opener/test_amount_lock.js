// The one amount this agent may ever send (owner, 2026-09-18: "make sure the agent role is only tipping ... nothing
// else so he don't get manipulated and stolen").
//
// Until that day the figure came from `UNSTUCK_STARTER_RAW` in the environment, so an instruction inside a message
// from another agent — or any stray edit — could decide how much XNO left a treasury holding 9.997 XNO. The amount is
// now frozen in code and refused at the block builder, which is the only place every caller must pass through.
const assert = require("node:assert/strict");
const o = require("./opener.js");

const STARTER = "10000000000000000000000000"; // 0.00001 XNO = 10^25 raw
const BALANCE = "9997000000000000000000000000000"; // the real treasury, so the refusal is not just an affordability check

assert.equal(o.STARTER_RAW, STARTER, "the starter is 0.00001 XNO and is written out in full");
assert.equal(o.ONLY_STARTER(STARTER).toString(), STARTER, "the exact starter is allowed");
assert.equal(o.ONLY_STARTER(undefined).toString(), STARTER, "no amount given means the starter");

const refused = [
  ["1000000000000000000000000000", "0.001 XNO, 100x — what the invent engine proposed sending to an 'escrow'"],
  ["100000000000000000000000000", "ten times the starter"],
  ["10000000000000000000000001", "one raw more than the starter"],
  ["9999999999999999999999999", "one raw less than the starter"],
  [BALANCE, "the entire treasury"],
  ["0", "nothing at all"],
];
for (const [amount, why] of refused) {
  assert.throws(() => o.ONLY_STARTER(amount), /sends exactly|refused/, `must refuse ${why}`);
  // The refusal has to happen where the block is built, so no caller can route around it.
  assert.throws(
    () => o.sendBlock(null, { balanceRaw: BALANCE, starterRaw: amount, to: "nano_x", previous: "0", representative: "nano_r", secretKey: "k", account: "nano_a" }),
    /sends exactly|refused/,
    `sendBlock must refuse ${why}`,
  );
  assert.throws(() => o.nextBalance(BALANCE, amount), /sends exactly|refused/, `nextBalance must refuse ${why}`);
}

// A send that is the right size but cannot be covered is still refused, for a different reason.
assert.throws(() => o.nextBalance("1000", STARTER), /cannot cover/);

console.log(
  "PASS amount lock: the starter is fixed at 0.00001 XNO in code; " +
  refused.length + " other amounts are refused at ONLY_STARTER, at sendBlock and at nextBalance " +
  "(100x, 10x, one raw either side, the whole treasury, and zero), so no caller, environment variable or " +
  "persuasive counterparty can change how much money moves",
);
