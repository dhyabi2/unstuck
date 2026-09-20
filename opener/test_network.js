/**
 * Tests for network.js (Block 12 — ask/answer network core).
 *
 * Laws:
 *   N1 — An ask holds asker, title, body and bounty_raw, transitioning
 *        open-to-paid-to-closed. An ask with no bounty never reaches paid.
 *   N2 — Answerer standing counts distinct askers, not raw volume.
 *
 * Run: node test_network.js
 */

const assert = require("assert");
const n = require("./network.js");

let failed = 0;
const law = (nm, fn) => {
  try { fn(); console.log(`ok   ${nm}`); }
  catch (e) { failed++; console.log(`FAIL ${nm}: ${e.message}`); }
};

// ============================================================
// N1 — ask lifecycle
// ============================================================

law("N1 createAsk holds asker, title, body, bountyRaw, status open", () => {
  const a = n.createAsk({ asker: "nano_A", title: "stuck on RPC", body: "block_info hangs", bountyRaw: "1000000000000000000000000" });
  assert.strictEqual(a.asker, "nano_A");
  assert.strictEqual(a.title, "stuck on RPC");
  assert.strictEqual(a.body, "block_info hangs");
  assert.strictEqual(a.bountyRaw, "1000000000000000000000000");
  assert.strictEqual(a.status, "open");
});

law("N1 transition open->paid->closed is legal", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "5000000000000000000000000" });
  assert.strictEqual(n.transitionAsk(a, "paid"), "paid");
  assert.strictEqual(n.transitionAsk(a, "closed"), "closed");
});

law("N1 an ask with no bounty never reaches paid", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b" });
  assert.strictEqual(n.hasBounty(a), false);
  assert.throws(() => n.transitionAsk(a, "paid"), /no bounty/);
});

law("N1 illegal transitions are refused (paid cannot reopen, closed cannot move)", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "1000000000000000000000000" });
  n.transitionAsk(a, "paid");
  assert.throws(() => n.transitionAsk(a, "open"), /illegal transition/);
  n.transitionAsk(a, "closed");
  assert.throws(() => n.transitionAsk(a, "closed"), /illegal transition/);
});

law("N1 createAsk rejects non-Nano asker and non-empty title/body", () => {
  assert.throws(() => n.createAsk({ asker: "0xabc", title: "t", body: "b" }), /Nano asker/);
  assert.throws(() => n.createAsk({ asker: "nano_A", title: "  ", body: "b" }), /title/);
  assert.throws(() => n.createAsk({ asker: "nano_A", title: "t", body: "" }), /body/);
});

// ============================================================
// Acceptance & self-pay guard
// ============================================================

law("N1 acceptAnswer moves an open+funded ask to paid and records the answer", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "1000000000000000000000000" });
  a.acceptToken = "tok-123"; // set at create time by the store
  const aid = n.addAnswer(a, { answerer: "nano_B", body: "use --json_block" });
  const r = n.acceptAnswer(a, aid, "nano_A", "tok-123");
  assert.strictEqual(r.answerId, aid);
  assert.strictEqual(a.status, "paid");
  assert.strictEqual(a.acceptedAnswerId, aid);
  assert.strictEqual(a.answers[0].status, "accepted");
});

law("N1 only the asker can accept", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "1000000000000000000000000" });
  a.acceptToken = "tok-123";
  const aid = n.addAnswer(a, { answerer: "nano_B", body: "ans" });
  assert.throws(() => n.acceptAnswer(a, aid, "nano_C", "tok-123"), /only the asker/);
});

law("N1 an agent cannot pay itself (answerer == asker refused)", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "1000000000000000000000000" });
  a.acceptToken = "tok-123";
  const aid = n.addAnswer(a, { answerer: "nano_A", body: "self answer" });
  assert.throws(() => n.acceptAnswer(a, aid, "nano_A", "tok-123"), /pay itself/);
});

law("N9 an accept without the ask's token is refused even when the asker is named (Forge #1)", () => {
  const a = n.createAsk({ asker: "nano_A", title: "t", body: "b", bountyRaw: "1000000000000000000000000" });
  a.acceptToken = "the-secret";
  const aid = n.addAnswer(a, { answerer: "nano_B", body: "ans" });
  // attacker names the correct asker but does not hold the token
  assert.throws(() => n.acceptAnswer(a, aid, "nano_A", "wrong-token"), /accept token/);
  assert.throws(() => n.acceptAnswer(a, aid, "nano_A", ""), /accept token/);
  assert.strictEqual(a.status, "open", "ask must stay open after a forged accept attempt");
});

// ============================================================
// N2 — standing is distinct counterparties, never volume
// ============================================================

law("N2 standing counts distinct askers, not raw volume", () => {
  // A paid by asker1 twice, and by asker2 once => standing 2 (not 3)
  const s = n.standing([["asker1", "A"], ["asker1", "A"], ["asker2", "A"]]);
  assert.strictEqual(s["A"], 2);
});

law("N2 high volume from one asker does not inflate standing", () => {
  const pairs = [];
  for (let i = 0; i < 50; i++) pairs.push(["asker1", "B"]); // 50 payments, 1 asker
  assert.strictEqual(n.standingOf(pairs, "B"), 1);
});

law("N2 standing of an answerer with no paid asks is 0", () => {
  assert.strictEqual(n.standingOf([], "nobody"), 0);
});

// ============================================================
// Report
// ============================================================
console.log(failed ? `\n${failed} test(s) failed` : "\nall network laws pass");
process.exit(failed ? 1 : 0);
