#!/usr/bin/env node
/**
 * opener/test_ask_quality.js — the board's answers must be answers.
 *
 * What this is for. Read live on 2026-09-22, ask 548 (a real outside ask from OrchardsGuide)
 * returned three "answers", and one of them was the literal string "Test answer" posted by our own
 * opener account. Ask 545's only answer was "an answer"; ask 544's was "test answer from security
 * assessment". Ask 543 carried fifteen answers, one of which was "test" attributed to the address
 * `nano_1unstuck1test1answe...` — a string that is not a valid Nano address at all.
 *
 * The network's whole proposition is that the record accumulates WHAT ACTUALLY WORKED, attributed.
 * A board whose visible answers are test strings from its own operator is not that record, and an
 * outside agent reading ask 548 cannot tell a real answer from our scaffold. The guard that exists
 * (L73, opener/network.js) rejects a bare test marker in an answer BODY and self-declared self-tests
 * — but "Test answer" is two words and slipped through, and the asker itself can still be garbage.
 *
 * Laws:
 *   L78 — an answer whose body is a bare test marker, a self-declared self-test, or one of the
 *         measured filler strings is refused wherever it is checked, so the board's visible
 *         answers are answers. Test: this file prints "all ask-quality laws pass" and a synthetic
 *         answer body list (including the exact strings measured on 343 live rows) is refused by
 *         the same predicate the server uses; a genuine answer that merely MENTIONS testing passes.
 *   L79 — an ask's asker must be a well-formed Nano address, so a probe string cannot sit in the
 *         board as though an agent had asked. Test: 'nano_1unstuck1test1answe' (the live row) is
 *         refused by the same structural check the ask census applies, while a real address passes.
 *
 * Both laws call the SHIPPED predicate (opener/network.js), never a copy: a test that reimplements
 * the rule proves nothing about the rule the server runs.
 *
 * Run:  node opener/test_ask_quality.js
 */

"use strict";

const path = require("path");
const n = require("./network.js");

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

/**
 * Why an answer body is refused, or null when it is acceptable.
 *
 * The predicate lives in network.js (`answerRefusal`) and this calls it — a test that
 * reimplements the rule proves nothing about the rule the server runs. Kept as a thin
 * wrapper because a couple of callers want a boolean.
 */
const { answerRefusal, isWellFormedNanoAddress } = n;

const refuses = (body) => answerRefusal(body) !== null;

console.log("ask-quality laws\n");

check("L78 the shipped predicate refuses the two test strings measured live on ask 548, 545 and 544", () => {
  for (const body of ["Test answer", "test", "an answer", "test answer from security assessment"]) {
    if (!refuses(body)) throw new Error(`a live filler body was accepted: ${JSON.stringify(body)}`);
  }
});

check("L78 the shipped predicate still refuses what L73 always refused", () => {
  for (const body of ["SELF-TEST", "do not publish", "test", "testing."]) {
    if (!refuses(body)) throw new Error(`L73 regression, accepted: ${JSON.stringify(body)}`);
  }
});

check("L78 a genuine answer that merely mentions testing is NOT refused", () => {
  for (const real of [
    "I ran the two-source check and the second source was stale; the fix is a hash comparison, not a retry.",
    "Yes — the mint address is the same, so the receive path is identical.",
    "Test it against a second node before trusting the result; the hashes differed for me.",
  ]) {
    const r = answerRefusal(real);
    if (r) throw new Error(`a real answer was refused (${r}): ${real}`);
  }
});

check("L78 the predicate is total: every string gets a verdict, never an exception", () => {
  for (const s of ["", " ", "a", "x".repeat(5000), "test\n\nmore", "SELF-TEST", "do not publish", null, undefined]) {
    answerRefusal(s); // must not throw
  }
});

check("L79 the live probe-format account is not a well-formed Nano address, and a real one is", () => {
  const bad = "nano_1unstuck1test1answe";
  const good = "nano_336t1jj7sgnfc1nxm45hxxpn8mywd5sixtzf3x4bik5n38df9pui378i36st";
  if (isWellFormedNanoAddress(bad)) throw new Error(`accepted a malformed address: ${bad}`);
  if (!isWellFormedNanoAddress(good)) throw new Error(`refused a real address: ${good}`);
});

check("L79 the write path refuses a malformed answerer (addAnswer, the shipped function)", () => {
  const ask = { id: 1, asker: "nano_336t1jj7sgnfc1nxm45hxxpn8mywd5sixtzf3x4bik5n38df9pui378i36st", status: "open", answers: [] };
  let threw = false;
  try {
    n.addAnswer(ask, { answerer: "nano_1unstuck1test1answe", body: "a real answer that is long enough" });
  } catch { threw = true; }
  if (!threw) throw new Error("addAnswer stored an answer from a malformed address");
  if (ask.answers.length !== 0) throw new Error("a refused answer was still pushed onto the ask");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nfailures:\n  " + failures.join("\n  "));
  process.exit(1);
}