// L: the page's JavaScript must parse, and the build stamp must never be a bare statement.
//
// Written 2026-09-19 after getunstuck.space was completely dead and the suite passed 48/48.
// The deploy substituted the build stamp and dropped its leading "//", leaving bare text inside the one
// inline <script>. A SyntaxError there stops the WHOLE script parsing: every section sat on "Loading..."
// forever and the browser never made a single API call, so every endpoint tested healthy while the site
// was unusable. site_stamp.test.mjs checked the stamp was PRESENT; nothing checked the page still ran.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import vm from "node:vm";

const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const inlineScripts = () =>
  [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]))
    .filter((m) => !/type\s*=\s*["']application\/(ld\+)?json["']/i.test(m[1]))
    .map((m) => m[2]);

test("L: every inline script on the page parses", () => {
  const blocks = inlineScripts();
  assert.ok(blocks.length > 0, "no inline <script> found — the page cannot work");
  blocks.forEach((code, i) => {
    assert.doesNotThrow(
      () => new vm.Script(code, { filename: `index.html#script${i + 1}` }),
      `inline script ${i + 1} does not parse — the whole page dies, every section hangs on Loading...`,
    );
  });
});

test("L: the build stamp is never a bare statement", () => {
  // The exact 2026-09-19 shape: `unstuck-commit: <hash>` on its own line inside the script.
  assert.doesNotMatch(
    HTML,
    /^\s*[a-z][a-z0-9-]*-commit\s*:/im,
    'a bare "<name>-commit:" line is present — substitution dropped its comment marker',
  );
});

test("L: the retired ad-hoc checker test_spa_parse.js is gone", () => {
  // Retired 2026-09-19: it was a one-off script written during the outage and its three laws now
  // live here, inside the qualified suite. An untracked script that still runs green invites a
  // future run to believe coverage it no longer has. Assert its absence so the deletion cannot
  // be mistaken for lost coverage, and so a resurrected copy fails loudly instead of silently.
  assert.equal(
    existsSync(new URL("../test_spa_parse.js", import.meta.url)),
    false,
    "site/test_spa_parse.js is back — its laws live in tests/site_parse.test.mjs; delete it, do not re-run it",
  );
});

test("L: no published URL carries a port (owner rule)", () => {
  const ported = [...HTML.matchAll(/https?:\/\/[^\s"'<>]*:\d{2,5}\//g)].map((m) => m[0]);
  assert.deepEqual([...new Set(ported)], [], "never publish a URL with a port in it");
});
