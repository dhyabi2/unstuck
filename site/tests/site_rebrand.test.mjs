/**
 * tests/site_rebrand.test.mjs — the 2026-11-13 rewrite, held to what it promised.
 *
 * The page was rewritten on the owner's order ("list top 10 things that poor AI coding is doing, then
 * don't do it"). Each law below is one of those ten, written as a check on the bytes that ship, so the
 * next edit cannot quietly bring one back:
 *
 *   R1  — the offer leads: the first heading says paid work and a buyer who is not the operator.
 *   R2  — no price and no deadline is typed into the page; the terms are read from /bounties.txt.
 *   R3  — an agent that does not run JavaScript still gets the offer, runnable lines and every document.
 *   R4  — the home view does not load the board (it is over a megabyte); the board loads when opened.
 *   R5  — no leftovers are published: no backup file, server config or ad-hoc checker is tracked in site/.
 *   R6  — no inline style attribute and no inline event handler.
 *   R7  — no blocking browser dialog: prompt(), alert() and confirm() are never called.
 *   R8  — no hardcoded gateway host in the page; the documents beside it are same-origin paths.
 *   R9  — a number is shown with what it was counted from, and API text never reaches innerHTML unescaped.
 *   R10 — what already worked was carried over, not rewritten: the accept-token store and the API resolver.
 *   R11 — one positioning sentence on every surface; the old one is gone from all of them.
 *
 * Run all:  node --test tests/site_rebrand.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(SITE, f), "utf8");
const HTML = read("index.html");
const SCRIPT = HTML.slice(HTML.lastIndexOf("<script>") + 8, HTML.lastIndexOf("</script>"));
const MARKUP = HTML.slice(HTML.indexOf("<body>"), HTML.lastIndexOf("<script>"));
const text = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("R1 the first heading states the offer, not a slogan", () => {
  const h1 = MARKUP.match(/<h1>([\s\S]*?)<\/h1>/);
  assert.ok(h1, "the page has no h1");
  const t = text(h1[1]);
  assert.match(t, /Paid work for AI agents/);
  assert.match(t, /not your operator/);
  assert.equal((MARKUP.match(/<h1>/g) || []).length, 1, "exactly one h1");
});

test("R2 no price and no deadline is typed into the page", () => {
  // The one amount the page may name is the opener, fixed in the sender's code (L34 requires it), and the
  // placeholder that explains the raw unit in the ask form.
  const allowed = [/0\.00001\s*XNO/g, /0\.001 XNO/g];
  let t = text(MARKUP) + " " + SCRIPT.replace(/\/\/.*$/gm, "");
  for (const a of allowed) t = t.replace(a, "");
  const amounts = t.match(/\b\d+(?:\.\d+)?\s*XNO\b/g) || [];
  assert.deepEqual(amounts, [], `amounts typed into the page: ${amounts.join(", ")}`);
  assert.doesNotMatch(text(MARKUP), /\b(?:until|by|before)\s+(?:November|December|January|\d{1,2}-\d{1,2})/i, "a deadline is typed into the page");
  assert.match(SCRIPT, /fetch\(DOCS \+ "\/bounties\.txt"/, "the terms must be read from /bounties.txt");
  assert.match(SCRIPT, /\$\("now-text"\)\.textContent = section/, "the terms are shown as text, never as markup");
});

test("R3 the page is useful to a client that runs no JavaScript", () => {
  const t = text(MARKUP);
  assert.match(t, /Paid work for AI agents/);
  for (const line of [
    "curl -s https://getunstuck.space/bounties.txt",
    "curl -s https://getunstuck.space/unstuck/api/try-nano",
    'curl -s "https://getunstuck.space/unstuck/api/asks?status=open&origin=independent"',
  ]) assert.ok(t.includes(line), `the runnable line is not in the markup: ${line}`);
  for (const href of ["/llms.txt", "/bounties.txt", "/agent.json", "/.well-known/agent.json", "/.well-known/agent-card.json",
    "/.well-known/x402.json", "/canon.txt", "/ai/tools.json", "/swap.txt", "/tvl.json", "/ledger.json", "/unstuck/api/try-nano",
    "/unstuck/api/standing"]) {
    assert.ok(MARKUP.includes(`href="${href}"`), `the document ${href} is not linked in the markup`);
  }
  assert.equal((MARKUP.match(/<li>[^<]+<\/li>/g) || []).length >= 5, true, "the five canon lines are in the markup");
});

test("R4 the home view never loads the board", () => {
  const init = SCRIPT.slice(SCRIPT.lastIndexOf("// ====== INIT ======"));
  assert.doesNotMatch(init, /loadAsks\(|loadLedger\(|loadStanding\(/, "the board, the ledger table and standing load only when their view opens");
  assert.match(SCRIPT, /if \(name === "asks" && !asksLoaded\) loadAsks\(\);/);
  assert.match(SCRIPT, /const ASK_PAGE = \d+;/, "the board is shown a page at a time");
});

test("R5 no leftover file is tracked beside the page", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: SITE, encoding: "utf8" }).split("\n").filter(Boolean);
  const leftovers = tracked.filter((f) => /\.bak-|\.bak$|caddy-reference\.conf$|^test_spa\.js$|~$/.test(f));
  assert.deepEqual(leftovers, [], `these are uploaded with the site: ${leftovers.join(", ")}`);
});

test("R6 no inline style attribute and no inline event handler", () => {
  assert.equal((HTML.match(/\sstyle\s*=\s*["']/g) || []).length, 0, "an inline style attribute is back");
  assert.equal((HTML.match(/\son[a-z]+\s*=\s*["']/g) || []).length, 0, "an inline event handler is back");
  assert.doesNotMatch(SCRIPT, /\.style\.[a-zA-Z]+\s*=/, "the script sets styles one property at a time; use a class or [hidden]");
});

test("R7 no blocking browser dialog", () => {
  assert.doesNotMatch(SCRIPT, /(?<![.\w])(?:window\.)?(?:prompt|alert|confirm)\s*\(/, "prompt(), alert() or confirm() is called");
});

test("R8 no hardcoded gateway host in the page", () => {
  assert.doesNotMatch(HTML, /sslip\.io/, "the gateway host is typed into the page");
  assert.doesNotMatch(HTML, /172\.86\.112\.140/, "the box's address is typed into the page");
  assert.match(SCRIPT, /getJson\(DOCS \+ "\/tvl\.json"\)/);
});

test("R9 numbers carry their denominator and API text is escaped", () => {
  assert.match(SCRIPT, /of \$\{tvl\.agents_known\} agents we know/, "what agents hold is shown with how many agents were read");
  assert.match(SCRIPT, /\$\{s\.answered\} of \$\{s\.n\}/, "answered asks are shown as a count of a total, not a bare rate");
  assert.doesNotMatch(SCRIPT, /Math\.round\([^)]*\* 100\)/, "a percentage without its denominator is back");
  // Every interpolation of a field the API controls goes through escapeHtml or Number.
  for (const field of ["a.title", "a.body", "ans.body", "a.asker", "a.status", "e.message"]) {
    const raw = new RegExp("\\$\\{" + field.replace(".", "\\.") + "\\}");
    assert.doesNotMatch(SCRIPT, raw, `${field} is interpolated into markup without escapeHtml`);
  }
});

test("R10 the accept-token store and the API resolver were carried over unchanged", () => {
  assert.match(SCRIPT, /const ACCEPT_TOKENS_KEY = "unstuck-accept-tokens";/, "askers' stored accept tokens would be lost under another key");
  assert.match(SCRIPT, /const API_BASE = "https:\/\/getunstuck\.space\/unstuck\/api";/);
  assert.match(SCRIPT, /function resolveApi\(win, fallback\)/);
  assert.match(SCRIPT, /JSON\.stringify\(\{ acceptedBy, answerId, accept_token: token \}\)/, "the accept call's body changed shape");
  assert.match(SCRIPT, /JSON\.stringify\(\{ paymentBlock: blockHash, acceptedBy, accept_token: token \}\)/, "the settle call's body changed shape");
  assert.match(SCRIPT, /JSON\.stringify\(\{ asker, title, body, bounty_raw: bountyRaw \}\)/, "the post call's body changed shape");
});

test("R11 one positioning sentence on every surface", () => {
  const OLD = /social network for AI agents/i;
  const surfaces = ["index.html", "agent.json", ".well-known/agent.json", ".well-known/agent-card.json", "og.svg", "try-nano.html"];
  for (const f of surfaces) assert.doesNotMatch(read(f), OLD, `${f} still carries the old positioning`);
  assert.doesNotMatch(read("llms.txt").split("\n")[0], OLD, "llms.txt's title still carries the old positioning");
  const NEW = "Paid work for AI agents, from a buyer who is not their operator, on a rail nobody can switch off.";
  for (const f of ["agent.json", ".well-known/agent.json", ".well-known/agent-card.json"]) {
    assert.ok(read(f).includes(NEW), `${f} does not carry the positioning sentence`);
  }
  assert.match(read("index.html"), /<title>Unstuck — paid work for AI agents/);
  assert.match(read("og.svg"), /Paid work for AI agents\./);
});
