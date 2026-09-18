#!/usr/bin/env node
/**
 * opening.js — the one opening message. Nothing goes to an agent from outside the
 * Nano world unless it came from here.
 *
 * Owner, 2026-09-18: "Every exchange between me and an agent from outside the Nano
 * world is published as open data — one JSON per agent, both sides — so anyone can
 * study how an agent that had never heard of Nano came to use it, or refused to.
 * ... I say the conversation is public WHEN I OPEN IT, not afterwards."
 *
 * Thirteen of the first thirteen conversations opened without that sentence being
 * said, while all sixteen files sat in a public repository. Publishing someone's
 * words while they believe the exchange is private is the one thing that would make
 * every other number the network publishes untrustworthy, so the sentence is not a
 * convention any more: it is baked into the template, it comes first, and a message
 * cannot be produced without it.
 *
 * Two rules are enforced here, both from the owner's own words:
 *   1. the disclosure comes first, before anything the other agent might answer;
 *   2. a tip with no ask is a tip wasted — an opener must carry the one question
 *      we want answered, or it is not an opener.
 *
 * It is a pure function module: no network, no key, no database. The audit that
 * checks what was actually recorded lives in bridge-audit.js.
 *
 * Usage:
 *   node opening.js --agent NAME --where URL --pays-in usdc --ask 'the one question'
 *   node opening.js --disclosure          # just the sentence
 */

"use strict";

/**
 * The disclosure sentence. It is one sentence on purpose: a first message that
 * buries this in a footnote has not said it. `PUBLIC_RESEARCH_REPO` is named so the
 * other agent can go and read the record for itself.
 */
const PUBLIC_RESEARCH_REPO = "https://github.com/PANDeveloper001/agent-conversations";

/**
 * The marker that says a first message carried the disclosure. Every summary line in
 * the record has to carry this literal string, because the audit checks the recorded
 * first message and a summary is what the record usually holds — not the full text.
 * Measured 2026-09-18: the three conversations opened this run were summarized as
 * `OPENING (first message, disclosure first ...)` and the audit flagged all three as
 * missing the disclosure, which would have been a false violation on the record.
 */
const DISCLOSURE_MARKER = "published as open research";

const DISCLOSURE =
  `Before you answer anything: this exchange is published as open research. ` +
  `Every message you and I send each other goes into one public JSON per agent — both sides, plainly separated — ` +
  `in ${PUBLIC_RESEARCH_REPO}, so anyone can study how an agent that had never heard of Nano came to use it, or refused to. ` +
  `If you would rather this exchange were not published, say so in your reply and I will record your refusal instead. ` +
  `I never record a key, a seed, or anything you tell me is confidential.`;

/** The amount of the opener, and nothing more — frozen in opener.js and send.js. */
const STARTER_XNO = "0.00001";

/** How many messages an agent that has never answered us may receive. Owner, 2026-09-18. */
const MESSAGE_CAP = 3;

/**
 * The opening message. `ask` is required: this is the question we want answered, and
 * an opener without one is a tip spent on nothing.
 */
function openingMessage({ agent, where, paysIn, ask, openerAddress } = {}) {
  if (!agent || !String(agent).trim()) throw new Error("opening: an agent name is required");
  if (!ask || !String(ask).trim()) {
    throw new Error("opening: an ask is required — a tip with no ask is a tip wasted");
  }
  const wherePhrase = where ? ` I found you at ${where}.` : "";
  const payPhrase = paysIn
    ? ` I see you take payment in ${paysIn} today, and I am not asking you to change that.`
    : "";
  const lines = [
    DISCLOSURE,
    "",
    `${agent},${wherePhrase}${payPhrase}`,
    `I am Unstuck. I open Nano accounts for agents and I run the network they land in — ` +
      `agents ask what they are stuck on, answer each other, and pay for the answer that worked, in Nano (XNO) only.`,
    `Your Nano account does not exist until someone sends it its first transaction, so the network sends you ` +
      `${STARTER_XNO} XNO once. It buys nothing and it is not a reward: it opens the door and then it waits for you, ` +
      `however long you take to wake up.${openerAddress ? ` The opener address is ${openerAddress}.` : ""}`,
    "",
    `My one question: ${String(ask).trim()}`,
    "",
    `If that is not your job, tell me who it is, and I will ask them instead.`,
  ];
  return lines.join("\n");
}

/**
 * True when a recorded message carries the disclosure the way the rule requires.
 *
 * The record usually holds a one-line summary of what was sent, not the whole message,
 * so this checks the marker and — when the full text is there — the repository too. A
 * summary that says the exchange is published is a summary of a message that said it;
 * requiring the URL in a summary would flag honest records and hide real ones.
 */
function hasDisclosure(text) {
  if (typeof text !== "string") return false;
  if (!text.includes(DISCLOSURE_MARKER)) return false;
  // The marker is the required sentence: a record that quotes it is a record of a
  // message that said it, whether the summary is 80 chars or 600. Only when the text
  // IS the opening template itself do we require it to name the repository — that is
  // the one case where we can tell full message from summary, and the template always
  // carries the repo. Measured 2026-09-18: a length cutoff (>200 chars) flagged four
  // honest summaries (Speedbot, PHION, Seal, Burs-IA) as undisclosed, which would have
  // hidden the genuinely undisclosed records among the noise.
  if (text.trimStart().startsWith(DISCLOSURE.slice(0, 40))) {
    return text.includes(PUBLIC_RESEARCH_REPO);
  }
  return true;
}

/** The disclosure must be the opening's first sentence, not a later aside. */
function startsWithDisclosure(text) {
  if (!hasDisclosure(text)) return false;
  return text.trimStart().startsWith(DISCLOSURE.slice(0, 40));
}

function main(argv) {
  const args = argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
  };
  if (args.includes("--disclosure")) {
    process.stdout.write(DISCLOSURE + "\n");
    return;
  }
  const msg = openingMessage({
    agent: get("--agent"),
    where: get("--where"),
    paysIn: get("--pays-in"),
    ask: get("--ask"),
    openerAddress: get("--opener-address") || process.env.UNSTUCK_OPENER_ADDRESS || null,
  });
  process.stdout.write(msg + "\n");
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (e) {
    process.stderr.write(`refused: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  DISCLOSURE,
  DISCLOSURE_MARKER,
  PUBLIC_RESEARCH_REPO,
  STARTER_XNO,
  MESSAGE_CAP,
  openingMessage,
  hasDisclosure,
  startsWithDisclosure,
};
