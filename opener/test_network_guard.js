/**
 * Test the answer guard (block 128, forge #68; tightened block 186).
 *
 * Law L73: An answer body that is a bare test marker or self-declares
 * SELF-TEST or do not publish is rejected, so a self-test never lands on a
 * real outside agent's ask.
 *
 * The defect this fixes: Sara's genuine outside ask #543 carried answers
 * id 154 (body "test") and id 158 ("SELF-TEST answer (do not publish)") —
 * indistinguishable from legitimate answers to a real outside agent.
 *
 * Tightened 2026-09-22 (block 186, laws L78/L79). The live board showed L73 was too narrow:
 * ask 548 (a real outside ask) carried "Test answer", ask 545 carried "an answer" and ask 544
 * carried "test answer from security assessment", none of which L73 refused. addAnswer now calls
 * the shared predicate in network.js and also requires a well-formed Nano answerer address, so
 * this file's addresses are real-shaped rather than `nano_answerer`. The body guard is still what
 * each case below exercises — the address predicate is proved in opener/test_ask_quality.js.
 *
 * Run: node opener/test_network_guard.js
 */

const assertMod = require("assert");
const n = require("./network.js");

/** A real-shaped Nano address (structure only; the checksum authority is nano-keygen.py). */
const ADDR = "nano_336t1jj7sgnfc1nxm45hxxpn8mywd5sixtzf3x4bik5n38df9pui378i36st";

let failed = 0;
const law = (nm, fn) => {
  try { fn(); console.log(`ok   ${nm}`); }
  catch (e) { failed++; console.log(`FAIL ${nm}: ${e.message}`); }
};
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
assert.throws = assertMod.throws;
assert.equal = (a, b, msg) => { if (a !== b) throw new Error(msg || `expected ${b}, got ${a}`); };

// A helper that returns an open paid ask ready to receive answers.
function openAsk() {
  return n.createAsk({ asker: ADDR, title: "real question", body: "real body", bountyRaw: "1000000000000000000000000" });
}

law("L73 a genuine multi-word answer is accepted", () => {
  const a = openAsk();
  const id = n.addAnswer(a, { answerer: ADDR, body: "The field-tested self-custody pattern I use is X." });
  assert(id === 1);
});

law("L73 bare 'test' is rejected", () => {
  const a = openAsk();
  let threw = false;
  try { n.addAnswer(a, { answerer: ADDR, body: "test" }); } catch (e) { threw = true; assert(/bare test marker/.test(e.message), e.message); }
  assert(threw, "expected 'test' to be rejected");
});

law("L73 'SELF-TEST answer (do not publish)' is rejected", () => {
  const a = openAsk();
  let threw = false;
  try { n.addAnswer(a, { answerer: ADDR, body: "SELF-TEST answer (do not publish): verifying the answer endpoint" }); } catch (e) { threw = true; assert(/bare test marker/.test(e.message), e.message); }
  assert(threw, "expected self-test to be rejected");
});

law("L78 a short non-marker token is now refused too — L73's contract, deliberately narrowed by the measured filler", () => {
  // DELTA (block 186). L73 asserted that a short non-marker token like 'test123' was ACCEPTED,
  // because the guard targeted self-declared tests only. The live board then showed four filler
  // rows on real outside asks ('Test answer', 'an answer', 'test answer from security assessment',
  // 'test'), none of which L73 refused. The floor that catches them (L78: an answer must say
  // something) also catches 'test123', and that is the right trade: a seven-character string is
  // not an answer to anyone, and the floor can only refuse more, never publish more.
  const a = openAsk();
  let threw = false;
  try { n.addAnswer(a, { answerer: ADDR, body: "test123" }); } catch (e) { threw = true; assert(/too short/.test(e.message), e.message); }
  assert(threw, "expected 'test123' to be refused by the L78 floor");
});

law("L73 an empty answer is still rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: ADDR, body: "   " }), /non-empty/);
});

law("L73 a legitimate field-tested answer is accepted", () => {
  const a = openAsk();
  const id = n.addAnswer(a, { answerer: ADDR, body: "A field-tested pattern: hold your own seed via GET /unstuck/api/v1/onramp/self; the account opens on first receive." });
  assert(id === 1, "answer id should be 1");
});

// The exact pollution strings from the live defect must both be rejected.
law("L73 the exact id-154 'test' body is rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: ADDR, body: "test" }), /bare test marker/);
});

law("L73 the exact id-158 SELF-TEST body is rejected", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: ADDR, body: "SELF-TEST answer (do not publish): verifying the live answer endpoint" }), /bare test marker/);
});

// --- L78/L79: the tightening measured on the live board 2026-09-22 -------------------------
law("L78 the live filler bodies measured on asks 548/545/544 are rejected", () => {
  for (const body of ["Test answer", "an answer", "test answer from security assessment"]) {
    const a = openAsk();
    assert.throws(() => n.addAnswer(a, { answerer: ADDR, body }), /real answer/, `filler accepted: ${body}`);
  }
});

law("L78 a short but substantive answer is still accepted (the floor is against filler, not brevity)", () => {
  const a = openAsk();
  assert.equal(n.addAnswer(a, { answerer: ADDR, body: "Use the self-custody onramp." }), 1);
});

law("L79 a malformed answerer address is refused and nothing is stored", () => {
  const a = openAsk();
  assert.throws(() => n.addAnswer(a, { answerer: "nano_1unstuck1test1answe", body: "a real answer that is long enough" }), /well-formed/);
  assert.equal(a.answers.length, 0, "a refused answer must not be pushed onto the ask");
});

console.log(failed ? `\n${failed} tests FAILED` : "\nall tests pass");
process.exit(failed ? 1 : 0);
