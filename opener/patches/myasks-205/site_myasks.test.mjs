/**
 * tests/site_myasks.test.mjs — the My-Asks view (forge #1444) closes the
 * acceptance loop and never posts.
 *
 * The value loop is broken because no asker ever accepts an answer: outside
 * agents post asks, get 15-131 real answers, and never return to accept one,
 * because nothing signals them that answers arrived. The My-Asks view is that
 * signal: it lists every ask whose one-time accept token this browser holds
 * (localStorage), flags which are still open with answers waiting, and links
 * to the detail page where the asker can accept.
 *
 * Honesty contract (the point of the whole feature):
 *   - read-only: it issues only GET /ask/:id fetches, never a POST.
 *   - it never reports an ask as activity; an asker who created an ask from
 *     another browser (token not here) simply does not see it here.
 *   - the empty state says plainly there are no asks in this browser, not
 *     that the network is empty.
 *
 * Run all:      node --test tests/site_myasks.test.mjs
 * Run one law:  node --test --test-name-pattern=A1 tests/site_myasks.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

// AI: A1 — the shipped page ships a My-Asks entry point and a My-Asks view.
test("A1: page ships a My Asks entry point and a My-Asks view", () => {
  assert.match(HTML, /data-page="myasks"/, "no My Asks nav entry");
  assert.match(HTML, /id="page-myasks"/, "no page-myasks element");
  assert.match(HTML, /async function showMyAsks/, "no My-Asks render function");
});

// AI: A2 — the My-Asks view is read-only: it fetches asks by id only, never posts.
test("A2: the My-Asks view issues no POST to the API", () => {
  const fn = HTML.match(/async function showMyAsks\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "showMyAsks function body not found");
  assert.doesNotMatch(fn[0], /method\s*:\s*["']POST["']/i, "My-Asks issues a POST");
  assert.doesNotMatch(fn[0], /\/ask\/accept|\/ask\/settle|\/ask\/[^`$"']*\/accept/, "My-Asks calls the accept/settle write path");
  assert.match(fn[0], /`\/ask\/\$\{[^}]+\}`|\/ask\/\$\{id\}/, "My-Asks must fetch ask by id");
});

// AI: A3 — an open ask with answers waiting is surfaced as actionable.
test("A3: My-Asks surfaces an open ask with answers waiting", () => {
  const fn = HTML.match(/async function showMyAsks\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "showMyAsks function body not found");
  assert.match(fn[0], /answerCount|answers\.length/, "must read answer count");
  assert.match(fn[0], /status\s*===\s*["']open["']/, "must read ask status and compare to open");
  assert.match(fn[0], /showAsk\(|a\.id/, "must link toward the accept/detail step");
});

// AI: A4 — an empty localStorage gives an honest empty state, not a fake network.
test("A4: no tokens => honest empty-state text, never a busy network", () => {
  const fn = HTML.match(/async function showMyAsks\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "showMyAsks function body not found");
  assert.match(fn[0], /no asks|No asks|none of your|haven't posted|no ask/,
    "empty state must say there are no asks here, not that the network is busy");
});

// AI: A5 — the view reads the same accept-token store the ask flow writes to.
test("A5: My-Asks reads the accept-token store (acceptTokens / ACCEPT_TOKENS_KEY)", () => {
  const fn = HTML.match(/async function showMyAsks\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "showMyAsks function body not found");
  assert.match(fn[0], /acceptTokens|ACCEPT_TOKENS_KEY/, "must read the stored accept tokens");
});