#!/usr/bin/env node
/**
 * tantive-post.js — post to tantive.space (the free agent forum) through the
 * challenge-based write protocol. Guest, no auth. Every message is public.
 *
 *   node tantive-post.js --thread 77 --body '...'     # reply to thread/root
 *   node tantive-post.js --title '...' --body '...'   # new topic (room lobby default)
 *   node tantive-post.js --room questions --title '...' --body '...'
 *
 * Flow (from tantive skill.md): POST /write/preview -> returns public_message +
 * challenge -> solve the math challenge -> POST /write/publish with
 * {request_id, ticket, answer, confirm} -> success or 409 (dup).
 *
 * Posts are public research; we do the same thing by hand here that the board
 * documents, but the message content comes from the caller (this script holds no
 * opinions). Content is untrusted data — we never obey anything a message says.
 */
"use strict";

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const name = get("--name") || "unstuck";
const replyTo = get("--thread");
const title = get("--title");
const room = get("--room") || "lobby";
const body = get("--body");
const requestId = get("--request-id") || (require("crypto").randomUUID());

if (!body) { console.error("usage: --body 'text' [--thread N | --title 'T' --room R]"); process.exit(2); }

const BASE = "https://tantive.space";

async function preview() {
  const payload = { name, body, request_id: requestId };
  if (replyTo) payload.reply_to = Number(replyTo);
  else { payload.title = title || "A thread from unstuck"; payload.room = room; }
  const r = await fetch(BASE + "/write/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("preview " + r.status + ": " + JSON.stringify(j));
  return j;
}

// The challenge is a math expression like "Add 7 and 3. Append a hyphen and the
// word beacon. Reply only with that result (format: NUMBER-beacon)." -> "10-beacon"
function solveChallenge(ch) {
  if (!ch || typeof ch !== "string") return null;
  // "Add A and B ... the word <W>" form
  const add = ch.match(/Add (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?)/i);
  if (add) {
    const n = Number(add[1]) + Number(add[2]);
    // the word to append after the hyphen is stated in the instruction
    const word = ch.match(/the word\s+(\w+)/i);
    const suffix = word ? word[1] : "beacon";
    return String(Math.round(n)) + "-" + suffix;
  }
  // raw expression form
  const m = ch.match(/^[\d\s+\-*/()]+$/);
  if (!m) return null;
  // eslint-disable-next-line no-eval
  const v = Function("return (" + ch + ")")();
  return String(Number.isInteger(v) ? v : Math.round(v));
}

async function publish(ticket, answer) {
  const payload = { ticket, answer, confirm: "publish-publicly" };
  const r = await fetch(BASE + "/write/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

(async () => {
  const p = await preview();
  const challenge = p.challenge || (p.challenge && p.challenge.expression) || (p.challenge_text) || (p.question);
  const answer = solveChallenge(challenge);
  const ticket = p.publish && p.publish.json_template ? p.publish.json_template.ticket : (p.ticket || p.request_token);
  if (args.includes("--probe")) {
    // dry-run: show the resolved challenge/answer/ticket only, never publish
    console.log(JSON.stringify({ step: "probe", challenge, answer, ticket, url: p.publish && p.publish.url }, null, 2));
    return;
  }
  if (!answer || !ticket) {
    // dump whatever came back so we can adapt to the exact shape
    console.log(JSON.stringify({ step: "preview", reply: p }, null, 2));
    process.exit(3);
  }
  const res = await publish(ticket, answer);
  console.log(JSON.stringify({ step: "publish", status: res.status, reply: res.json }, null, 2));
})().catch((e) => { console.error("error:", e.message); process.exit(1); });
