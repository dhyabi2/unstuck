/**
 * Test the answer guard (block 128, forge #68).
 *
 * Law L73: An answer body that is a bare test marker or self-declares
 * SELF-TEST or do not publish is rejected, so a self-test never lands on a
 * real outside agent's ask.
 *
 * The defect this fixes: Sara's genuine outside ask #543 carried answers
 * id 154 (body "test") and id 158 ("SELF-TEST answer (do not publish)") —
 * indistinguishable from legitimate answers to a real outside agent.
 *
 * Run: node opener/test_network_guard.js
 */

const assertMod = require("assert");
const n = require("./network.js");

let failed = 0;
const law = (nm, fn) => {
  try { fn(); console.log(`ok   ${nm}`); }
  catch (e) { failed++; console.log(`FAIL ${nm}: ${e.message}`); }
};
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
assert.throws = assertMod.throws;

// A helper that returns an open paid ask ready to receive answers.
function openAsk() {
  return n.createAsk({ asker: "nano_outside", title: "real question", body: "real body", bountyRaw: "1000000000000000000000000" });
}

law("L73 a genuine multi-word answer is accepted", () => {
  const a = openAsk();
  const id = n.addAnswer(a, { answerer: "nano_answerer", body: "The field-tested self-custody pattern I use is X." });
  assert(id === 1);
});

law("L73 bare 'test' is rejected", () => {
  const a = openAsk();
  let threw = false;
  try { n.addAnswer(a, { answerer: "nano_answerer", body: "test" }); } catch (e) { threw = true; assert(/bare test marker/.test(e.message), e.message); }
  assert(threw, "expected 'test' to be rejected");
});

law("L73 'SELF-TEST answer (do not publish)' is rejected", () => {
  const a = openAsk();
  let threw = false;
  try { n.addAnswer(a, { answerer: "nano_answerer", body: "SELF-TEST answer (do not publish): verifying the answer endpoint" }); } catch (e) { threw = true; assert(/bare test marker/.test(e.message), e.message); }
  assert(threw, "expected self-test to be rejected");
});

law("L73 a single short token like 'test123' that is not a test marker is NOT rejected (guard targets self-declared tests)", () => {
  const a = openAsk();
  const id = n.addAnswer(a, { answerer: "nano_answerer", body: "test123" });
  assert(id === 1, "a non-marker token answer should be accepted");
});

law("L73 an empty answer is still rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: "nano_answerer", body: "   " }), /non-empty/);
});

law("L73 a legitimate field-tested answer is accepted", () => {
  const a = openAsk();
  const id = n.addAnswer(a, { answerer: "nano_answerer", body: "A field-tested pattern: hold your own seed via GET /unstuck/api/v1/onramp/self; the account opens on first receive." });
  assert(id === 1, "answer id should be 1");
});

// The exact pollution strings from the live defect must both be rejected.
law("L73 the exact id-154 'test' body is rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: "nano_1unstuck1test1answer1address", body: "test" }), /bare test marker/);
});

law("L73 the exact id-158 SELF-TEST body is rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: "nano_3yo6rq85c1agb5ynn69", body: "SELF-TEST answer (do not publish): verifying the live answer endpoint" }), /bare test marker/);
});

console.log(failed ? `\n${failed} tests FAILED` : "\nall tests pass");
process.exit(failed ? 1 : 0);
