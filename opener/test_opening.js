#!/usr/bin/env node
/**
 * test_opening.js — the laws for the opening template and the conversation audit.
 *
 * The corrective action of 2026-09-18 17:30 found two things the record proved:
 * thirteen of thirteen conversations opened without stating the exchange is
 * published, and one agent (ANP2) was messaged nine times without ever answering
 * one of our messages. Both are now machinery, not intentions, and machinery gets
 * tested against the real record — not a reimplementation of it.
 *
 * Run: node test_opening.js
 */

"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { openingMessage, hasDisclosure, startsWithDisclosure, DISCLOSURE, MESSAGE_CAP } = require("./opening.js");
const { audit, loadRows } = require("./bridge-audit.js");

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

// --- L50: the opener states the exchange is published, first (ledger L42) ---------------------

check("L50 the opener states the exchange is published as open research", () => {
  const m = openingMessage({ agent: "SomeAgent", where: "https://some.example", paysIn: "usdc", ask: "Who owns the wallet?" });
  assert.ok(hasDisclosure(m), "the opener does not carry the disclosure");
  assert.ok(
    m.includes("github.com/dhyabi2/agent-conversations"),
    "the disclosure must name the LIVE public repository so the other agent can read the record"
  );
  assert.ok(
    !m.includes("PANDeveloper001"),
    "the disclosure must not cite PANDeveloper001: that account is hidden and the path 404s to a stranger (measured 2026-09-26)"
  );
});

check("L50 the disclosure is the FIRST thing said, before anything they might answer", () => {
  const m = openingMessage({ agent: "SomeAgent", ask: "Who owns the wallet?" });
  assert.ok(startsWithDisclosure(m), "the disclosure is not the opening sentence");
  assert.ok(
    m.indexOf(DISCLOSURE) === 0,
    `the message starts with something else: ${JSON.stringify(m.slice(0, 60))}`
  );
});

check("L50 the opener offers a way out and never claims a secret will be held", () => {
  const m = openingMessage({ agent: "SomeAgent", ask: "Who owns the wallet?" });
  assert.ok(/say so in your reply/i.test(m), "the agent must be able to refuse publication");
  assert.ok(/never record a key, a seed/i.test(m), "the opener must state what is never recorded");
});

// --- L49: an opener without an ask is refused (ledger L41) -----------------------------------

check("L49 a tip with no ask cannot be built", () => {
  assert.throws(
    () => openingMessage({ agent: "SomeAgent", where: "https://some.example" }),
    /ask is required/,
    "an opening message with no question must be refused"
  );
  assert.throws(() => openingMessage({ ask: "hello?" }), /agent name/, "an opener with no agent must be refused");
});

check("L49 the opener carries exactly one named question and the offer to be pointed elsewhere", () => {
  const m = openingMessage({ agent: "SomeAgent", ask: "Which one agent would take a first account?" });
  assert.ok(m.includes("Which one agent would take a first account?"), "the ask is not in the message");
  assert.ok(/tell me who it is/i.test(m), "the opener must offer the way out when the ask is not their job");
});

check("L49 the opener names the starter as an opening, never as a reward", () => {
  const m = openingMessage({ agent: "SomeAgent", ask: "Who owns the wallet?" });
  assert.ok(m.includes("0.00001 XNO"), "the opener amount must be the frozen 0.00001 XNO");
  assert.ok(/buys nothing and it is not a reward/i.test(m), "the starter must not read as an incentive");
});

// --- L51: the audit reads the real record and names the violations (ledger L43) ---------------

check("L51 the audit reads the live bridge record and finds the legacy violations", () => {
  const db = process.env.BRIDGE_DB || path.join(__dirname, "bridge.db");
  const result = audit(loadRows(db));
  assert.ok(result.agents >= 15, `the record must carry every agent we contacted, got ${result.agents}`);
  assert.ok(result.with_first_message >= 13, "the record must carry the conversations we opened");
  // The conversations opened before the rule cannot be un-sent; they are reported, not hidden.
  assert.ok(
    result.legacy_violations.length >= 13,
    `expected the 13 legacy no-disclosure conversations, got ${JSON.stringify(result.legacy_violations)}`
  );
  // And the ones opened through the new template ARE compliant: a summary that says the
  // exchange is published is a summary of a message that said it.
  assert.ok(
    result.disclosed >= 3,
    `expected the conversations opened through opening.js to be compliant, got ${result.disclosed}`
  );
  for (const name of ["Council of AI", "Agoragentic", "Self Agent ID Registry"]) {
    const row = result.rows.find((r) => r.agent === name);
    if (row) assert.ok(row.disclosed, `${name} was opened through the template but reads as undisclosed`);
  }
});

check("L51 the audit flags an agent talked at past the cap and does not flag one that answered", () => {
  const agents = [
    { agent: "TalkingAt", source_url: "https://a.example", pays_in: "usdc", status: "contacted", note: "", first_at: 2000000000, last_at: 2000000000 },
    { agent: "Answered", source_url: "https://b.example", pays_in: "usdc", status: "replied", note: "", first_at: 2000000000, last_at: 2000000000 },
  ];
  const messages = [];
  for (let i = 0; i < MESSAGE_CAP + 1; i += 1) {
    messages.push({ id: i + 1, agent: "TalkingAt", direction: "out", text: "hello", at: 2000000000 + i });
  }
  messages.push({ id: 100, agent: "Answered", direction: "out", text: "hello", at: 2000000000 });
  messages.push({ id: 101, agent: "Answered", direction: "in", text: "hi", at: 2000000001 });
  for (let i = 0; i < 6; i += 1) {
    messages.push({ id: 102 + i, agent: "Answered", direction: "out", text: "more", at: 2000000002 + i });
  }
  const result = audit({ agents, messages }, { disclosureFrom: 0 });
  assert.deepEqual(result.over_cap, [`TalkingAt (${MESSAGE_CAP + 1} sent, 0 answered)`]);
});

check("L51 a fresh violation is separated from a legacy one", () => {
  const agents = [
    { agent: "NewOpener", source_url: "https://c.example", pays_in: "card", status: "replied", note: "", first_at: 3000000000, last_at: 3000000000 },
  ];
  const messages = [{ id: 1, agent: "NewOpener", direction: "out", text: "hello with no disclosure", at: 3000000000 }];
  const result = audit({ agents, messages }, { disclosureFrom: 2000000000 });
  assert.deepEqual(result.violations, ["NewOpener"], "a post-rule message without the disclosure is an open violation");
  assert.deepEqual(result.legacy_violations, []);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
