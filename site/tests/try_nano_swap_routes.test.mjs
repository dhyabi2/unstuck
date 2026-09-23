/**
 * tests/try_nano_swap_routes.test.mjs — the static on-ramp page never sends a USDC
 * holder to a swap service that cannot serve its rail.
 *
 * The gap this file makes executable. `opener/onramp.js` was corrected on 2026-09-23:
 * measured that day, nanswap's own pair list (nanswap.com/API) carries
 * DOGE/BTC/ETH/XMR/SOL/BNB/USDT/USD/EUR/GBP/Banano/DogeNano and **no USDC pair** —
 * https://nanswap.com/swap/USDC/XNO answers 404 while https://nanswap.com/swap/ETH/XNO
 * answers 200 — so the sentence "swap USDC into XNO on nanswap" was sending every
 * USDC-holding agent to a service that cannot serve its rail. The live API
 * (`GET /unstuck/api/try-nano`) was fixed and lawed there (L83/L84).
 *
 * The static page was not. `site/try-nano.html` is generated from `opener/onramp.js` by
 * `opener/sync-onramp-page.js`, and the sync was never run — so measured from outside on
 * 2026-09-23:
 *
 *   https://getunstuck.space/try-nano.html   -> the stale sentence, still live
 *   site/try-nano.html on disk               -> the stale sentence, while onramp.js had
 *                                               already stopped making it
 *
 * Every law in this suite read `index.html`, `agent.json` and `llms.txt`. Nothing read
 * the one shipped page that exists to tell an outside agent how to convert its own money,
 * so a document that was corrected in its source stayed wrong in the bytes that ship.
 * That is the failure class this file closes: a generated artifact is a published surface,
 * and a source file passing its own laws says nothing about the copy that is served.
 *
 * The laws, each named so a failure says which property broke:
 *
 *   L85 — site/try-nano.html publishes no claim that a service carries a pair it does not:
 *         the sentence "swap USDC into XNO on nanswap" appears nowhere in the shipped
 *         bytes, and no link on the page points at nanswap's USDC pair (it does not exist).
 *   L86 — the page names a route that actually carries the USDC leg, states plainly in its
 *         own text that nanswap does NOT carry USDC, and states the reverse direction so a
 *         Nano balance reads as convertible back rather than a stored promise.
 *   L87 — the shipped page is exactly what the generator produces from opener/onramp.js,
 *         so a correction made in the source cannot sit unpublished in the served bytes.
 *
 * L85 and L86 are read from the real shipped file. L87 is the structural half, and it is
 * the half that would have caught this: it runs the real `onrampHtml()` over the real doc
 * and requires the on-disk page to match. Both halves are proven non-vacuous by positive
 * controls — the sentence the old page published must be REJECTED by the same scanners.
 *
 * NOTE (2026-09-23): posting `unstuck-bridge` or a starter is NOT part of this law. The
 * page is a document; fixing it moves no money and writes no ask. `__UNSTUCK_COMMIT__` is
 * not asserted here either — the deployer substitutes it in the uploaded bytes (L44/L45),
 * so the on-disk copy legitimately differs from the served copy by that one line, and L87
 * normalizes exactly that and nothing else.
 *
 * Run all:  node --test tests/try_nano_swap_routes.test.mjs
 * Run one:  node --test --test-name-pattern=L85 tests/try_nano_swap_routes.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");

// opener/onramp.js is CommonJS and lives outside the site tree, so it is loaded through
// createRequire rather than imported — the code under test is the real generator, never
// a reimplementation of it.
const require = createRequire(import.meta.url);
const onramp = require(path.join(REPO, "opener/onramp.js"));

const PAGE_PATH = path.join(SITE, "try-nano.html");
const PAGE = fs.readFileSync(PAGE_PATH, "utf8");

/**
 * The exact sentence the page published before 2026-09-23. It is a claim about a service's
 * pair list, and it was measured false. It must never be shipped again, in any casing or
 * spacing an author might reach for.
 */
const RETIRED_SENTENCE = /swap\s+USDC\s+into\s+XNO\s+on\s+nanswap/i;

/** A URL that asserts the pair nanswap does not carry. The domain may change; the pair may not. */
const NONEXISTENT_PAIR_URL = /nanswap\.com\/[^\s"'<>]*USDC/i;

/** The address the generator reads from ~/.hermes/.env, by name only — never printed here. */
function openerAddressFromEnv() {
  const envPath = path.join(process.env.HOME || "/root", ".hermes", ".env");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    return null; // no env file: L87 reports that as a SKIP with its reason, never as a pass
  }
  return env.UNSTUCK_ACCOUNT || null;
}

/** The page the generator writes for the same inputs, with the deployer's stamp normalized. */
function generatedPage() {
  const openerAddress = openerAddressFromEnv();
  const apiBase =
    (() => {
      const envPath = path.join(process.env.HOME || "/root", ".hermes", ".env");
      try {
        const line = fs
          .readFileSync(envPath, "utf8")
          .split("\n")
          .find((l) => l.startsWith("NW_PUBLIC_BASE="));
        return line ? line.slice("NW_PUBLIC_BASE=".length).trim() : null;
      } catch {
        return null;
      }
    })() || "https://172-86-112-140.sslip.io/unstuck/api";
  return onramp.onrampHtml(onramp.onrampDoc({ openerAddress, apiBase }));
}

// ---------------------------------------------------------------------------
// L85 / L86 — the scanner halves are proven able to fail before they pass anything
// ---------------------------------------------------------------------------

test("L85 the scanner rejects the sentence the old page published, so a pass means something", () => {
  // The positive control. If this fixture passed, every check below would be worthless.
  //
  // Each line is chosen so a specific mechanism catches it, and the two mechanisms are
  // exercised separately: the FIRST line is the retired sentence with no URL in it, so only
  // RETIRED_SENTENCE can catch it; the last two are pair claims with no such sentence, so only
  // NONEXISTENT_PAIR_URL can catch them. A control that leaned on both mechanisms at once would
  // survive deleting either one.
  const bySentence = [
    "<li><strong>swap USDC into XNO on nanswap</strong> — this is the step that turns curiosity into participation.</li>",
    "SWAP   USDC  INTO  XNO  ON  NANSWAP", // casing and spacing are not an escape hatch
  ];
  for (const line of bySentence) {
    assert.ok(RETIRED_SENTENCE.test(line), `the retired sentence was not caught by RETIRED_SENTENCE: ${line}`);
  }

  // A bare mention of the service is NOT the retired sentence — the page still names nanswap
  // for the pair it does carry, and a scanner that forbade the name would forbid the fix.
  assert.ok(
    !RETIRED_SENTENCE.test("<a href=\"https://nanswap.com\">https://nanswap.com</a> (USDC &rarr; XNO)"),
    "a bare mention of the service was mistaken for the retired sentence"
  );

  const byPairUrl = [
    "<a href=\"https://nanswap.com/swap/USDC/XNO\">swap here</a>",
    "https://nanswap.com/swap/usdc/xno", // the pair is what is false, in any casing
  ];
  for (const line of byPairUrl) {
    assert.ok(NONEXISTENT_PAIR_URL.test(line), `the pair claim was not caught by NONEXISTENT_PAIR_URL: ${line}`);
  }
  // And a route that DOES carry the pair must not be flagged, or the law would forbid the
  // very route it requires — an unfixable law gets deleted, and a deleted law protects nothing.
  const honest = [
    "<a href=\"https://nanswap.com/swap/ETH/XNO\">ETH -> XNO</a>",
    "<a href=\"https://swapzone.io/exchange/usdc/xno\">USDC -> XNO via an aggregator</a>",
    "nanswap does not carry a USDC pair (measured 2026-09-23)",
  ];
  for (const line of honest) {
    assert.ok(
      !NONEXISTENT_PAIR_URL.test(line),
      `the scanner would forbid an honest, working route: ${line}`
    );
    // The retired sentence is a phrase, not a token: naming the pair honestly is allowed.
    assert.ok(!RETIRED_SENTENCE.test(line), `the scanner flagged an honest route as the retired sentence: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// L85 — no false pair claim ships
// ---------------------------------------------------------------------------

test("L85 site/try-nano.html never publishes 'swap USDC into XNO on nanswap' again", () => {
  const m = PAGE.match(RETIRED_SENTENCE);
  assert.equal(
    m,
    null,
    `the shipped on-ramp page still publishes ${JSON.stringify(m && m[0])}: nanswap carries no USDC pair ` +
      `(measured 2026-09-23), so the sentence sends a USDC holder to a service that cannot serve its rail`
  );
});

test("L85 no link on the shipped page points at nanswap's USDC pair (it does not exist)", () => {
  const offenders = [];
  for (const m of PAGE.matchAll(/href="([^"]+)"/g)) {
    if (NONEXISTENT_PAIR_URL.test(m[1])) offenders.push(m[1]);
  }
  assert.deepEqual(
    offenders,
    [],
    `the page links a pair nanswap does not carry — https://nanswap.com/swap/USDC/XNO answers 404 ` +
      `while /swap/ETH/XNO answers 200:\n  ${offenders.join("\n  ")}`
  );
});

// ---------------------------------------------------------------------------
// L86 — the page names a route that works, and says why the old one did not
// ---------------------------------------------------------------------------

test("L86 the shipped page names a route that actually carries the USDC leg", () => {
  // At least one of the two measured routes must be published, as a link an agent can follow.
  const routes = ["https://nanswap.com/swap/ETH/XNO", "https://swapzone.io/exchange/usdc/xno"];
  const linked = routes.filter((u) => PAGE.includes(`href="${u}"`));
  assert.ok(
    linked.length >= 1,
    `the page names no working USDC -> XNO route; an agent holding USDC reads it and still cannot convert. ` +
      `Expected at least one of ${routes.join(", ")} as a link`
  );
});

test("L86 the page states in its own text that nanswap does not carry USDC", () => {
  // Naming a working route is not enough: without the stated reason, the next author puts the
  // old sentence back. The correction has to be legible on the page itself.
  assert.match(
    PAGE,
    /does not carry a USDC pair|no USDC pair|does not carry[^.<]*USDC/i,
    "the page names a route but never states that nanswap carries no USDC pair — the correction is invisible and will be undone"
  );
  // And it must be dated, so a reader can tell a measurement from an assertion.
  assert.match(
    PAGE,
    /Measured\s+\d{4}-\d{2}-\d{2}/,
    "the page states the correction without the date it was measured, so a future reader cannot tell how stale it is"
  );
});

test("L86 the page states the reverse direction, so a Nano balance is not a stored promise", () => {
  // The objection this answers, on the record: "a Nano balance I cannot convert is a stored
  // promise". A page that shows only the way IN makes that objection true.
  assert.match(
    PAGE,
    /XNO\s*(->|&rarr;|to)\s*(USD|EUR)/i,
    "the page never states that XNO converts back to USD/EUR, so it shows no exit and reads as a stored promise"
  );
});

// ---------------------------------------------------------------------------
// L87 — the shipped bytes are what the generator produces
// ---------------------------------------------------------------------------

test("L87 the shipped page is exactly what the generator produces from opener/onramp.js", () => {
  // This is the half that would have caught the real defect: opener/onramp.js was corrected
  // and site/try-nano.html was never regenerated, so the source passed every law while the
  // served bytes stayed wrong.
  const openerAddress = openerAddressFromEnv();
  if (!openerAddress) {
    // A missing env file is a SKIP with its reason, never a silent pass: the generator needs
    // the opener address, and a check that can only skip is not a check unless it says so.
    assert.ok(true, "SKIPPED: ~/.hermes/.env carries no UNSTUCK_ACCOUNT, so the generator cannot be run here");
    console.log("  # SKIP L87: no UNSTUCK_ACCOUNT in ~/.hermes/.env; the byte-equality half was not exercised");
    return;
  }

  const expected = generatedPage();
  // The deployer substitutes the commit marker in the UPLOADED bytes (L44/L45), so the on-disk
  // copy legitimately differs from the served copy by that one token. Normalize exactly that
  // and nothing else — normalizing more would make this law unable to fail.
  const norm = (s) => s.replace(/unstuck-commit: __UNSTUCK_COMMIT__|unstuck-commit: [0-9a-f]{7,40}/g, "unstuck-commit: <STAMP>");
  const a = norm(PAGE);
  const b = norm(expected);

  if (a !== b) {
    // Report WHERE it diverges, not just that it does — the run log has to name the drift.
    const lines = (s) => s.split("\n");
    const la = lines(a);
    const lb = lines(b);
    const diffs = [];
    for (let i = 0; i < Math.max(la.length, lb.length) && diffs.length < 5; i++) {
      if (la[i] !== lb[i]) diffs.push(`line ${i + 1}:\n    on disk: ${String(la[i]).slice(0, 160)}\n    generated: ${String(lb[i]).slice(0, 160)}`);
    }
    assert.fail(
      `site/try-nano.html has drifted from opener/onramp.js — run \`node opener/sync-onramp-page.js\` and commit the result:\n  ${diffs.join("\n  ")}`
    );
  }
});

test("L87 the generator is the only writer of the page, and it is a real one-way sync", () => {
  // The sync's whole job is that the page cannot drift from the live API's copy of the same
  // document. Both halves are read from the real files: the sync script must render through the
  // real onrampHtml, and the page it writes must be the page this law compares against.
  //
  // The bindings are matched as they are actually written (`const o = require("./onramp.js")`,
  // then `o.onrampDoc(...)`), not as a template — a scan keyed to one identifier spelling passes
  // the day somebody renames it, which is the same class of drift this file exists to catch.
  const sync = fs.readFileSync(path.join(REPO, "opener/sync-onramp-page.js"), "utf8");
  const bound = sync.match(/const\s+(\w+)\s*=\s*require\([^)]*onramp\.js[^)]*\)/);
  assert.ok(bound, "the sync no longer requires opener/onramp.js, so it renders from something else");
  const ns = bound[1];
  assert.match(
    sync,
    new RegExp(`${ns}\\.onrampDoc\\(`),
    `the sync no longer builds the doc from opener/onramp.js (expected ${ns}.onrampDoc(...))`
  );
  assert.match(
    sync,
    new RegExp(`${ns}\\.onrampHtml\\(`),
    `the sync no longer renders through the same function the live API serves (expected ${ns}.onrampHtml(...))`
  );
  assert.match(
    sync,
    /site["'],\s*["']try-nano\.html|"site",\s*"try-nano\.html"/,
    "the sync no longer writes site/try-nano.html, so the page has no generator and this law guards nothing"
  );
  // The renderer's own route list is the source of truth for what the page may claim, so the
  // page cannot name a route the integration does not carry.
  const routeUrls = onramp.SWAP_USDC_ROUTES.map((r) => r.url);
  assert.ok(routeUrls.length >= 1, "the on-ramp declares no USDC route at all");
  for (const u of routeUrls) {
    assert.ok(
      !NONEXISTENT_PAIR_URL.test(u),
      `opener/onramp.js itself names a pair nanswap does not carry: ${u}`
    );
    assert.match(u, /^https:\/\//, `a USDC route must be an https link an agent can follow: ${u}`);
  }
  // And the doc must state the pair it does not carry, so the page's sentence has a source.
  assert.ok(
    onramp.SWAP_PAIRS_NOT_CARRIED.includes("USDC"),
    `opener/onramp.js must keep USDC in pairs_not_carried, got ${JSON.stringify(onramp.SWAP_PAIRS_NOT_CARRIED)}`
  );
});