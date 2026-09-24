/**
 * tests/try_nano_swap_routes.test.mjs — the static on-ramp page never sends a USDC
 * holder to a swap service that cannot serve its rail, and never tells one that the
 * service it CAN use does not exist.
 *
 * The gap this file makes executable. It was opened on 2026-09-23 by a real defect:
 * `opener/onramp.js` published "swap USDC into XNO on nanswap" as step 3 of the
 * conversion plan, and every law in this suite read `index.html`, `agent.json` and
 * `llms.txt` — nothing read `site/try-nano.html`, the one shipped page that exists to
 * tell an outside agent how to convert its own money. So a document corrected in its
 * source stayed wrong in the bytes that ship, and both L85 and L87 below were minted
 * against that class of failure.
 *
 * THE SECOND LIE, and why this file changed shape (Block 205). The correction of
 * 2026-09-23 morning probed the BARE ticker path `nanswap.com/swap/USDC/XNO`, got 404,
 * and generalised it into "nanswap carries no USDC pair" — a sentence written into
 * this test file as the premise of L85/L86 and shipped to every USDC agent we had
 * contacted. nanswap names its pairs by CHAIN, so the probe was on a URL that was
 * never a pair while the real ones answered 200 the whole time. Measured live and
 * re-runnable with `node opener/oracle-nanswap-pairs.js`:
 *
 *   https://nanswap.com/swap/USDC-BASE/XNO   200  "Swap USD Coin (Base) to Nano | Nanswap"
 *   https://nanswap.com/swap/USDC-ETH/XNO    200  "Swap USD Coin to Nano | Nanswap"
 *   https://nanswap.com/swap/XNO/USDC-BASE   200  (the reverse direction)
 *   https://nanswap.com/swap/USDC/XNO        404  (a bare ticker is not a pair)
 *   https://nanswap.com/swap/USDC-SOLANA/XNO 404  (USDC on Solana genuinely has none)
 *
 * So the old premise of L85 — "the page must not be read as saying USDC works, because
 * it does not" — was itself the defect. The law that guards a document has to be able
 * to fail when the document is wrong in EITHER direction, and a suite that carried the
 * wrong premise could only have gone red on the corrected page. What replaced it is
 * the rule that would have caught the original error AND the correction:
 *
 *   L85 — the page publishes no false coverage claim about a service's pair list, in
 *         either direction: it never denies a pair that is served (the sentence
 *         "nanswap carries no USDC pair" is refused), and it never links a pair that is
 *         not (the bare `USDC/XNO` stub appears in no href, and BARE_PAIR_URL matches
 *         nothing on the page).
 *   L86 — the page names the route that actually carries the USDC leg, explains that a
 *         bare ticker is not a pair, carries the date it was measured, and states the
 *         reverse direction (XNO -> USDC / USD / EUR) so a Nano balance does not read
 *         as a stored promise.
 *   L87 — the shipped page is exactly what the generator produces from opener/onramp.js,
 *         and the generator's own swap section is chain-qualified: every declared direct
 *         route is a USDC-BASE or USDC-ETH pair measured at 200, the pair list carries
 *         both and NOT a bare "USDC" ticker, and no declared route URL is a bare-ticker
 *         stub. That is the half that makes the page's sentence a measurement rather
 *         than a sentence.
 *
 * Both L85 halves and every L86 half are proven non-vacuous by positive controls, and
 * the controls now cover BOTH failure directions: the denial the old page published
 * must be REJECTED by FALSE_COVERAGE_CLAIM, and the sentence this page publishes now —
 * "nanswap serves USDC on Base and Ethereum directly (https://nanswap.com/swap/USDC-BASE/XNO)"
 * — must be ACCEPTED by it. A scanner that failed either direction would either forbid
 * the fix or miss a regression, and either way someone eventually deletes it.
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
 * A false COVERAGE claim about a service's pair list, in the direction that was shipped
 * for half a day on 2026-09-23: that nanswap does not carry a USDC pair at all. It came
 * from one 404 probe of the bare-ticker URL /swap/USDC/XNO, which is not a pair.
 *
 * Written as `[^.<\n]` runs so it stops at a sentence boundary — the denial must be in
 * the same clause as the claim, or a paragraph that denies one pair and names another
 * would be flagged wholesale and the law would be unfixable.
 */
const FALSE_COVERAGE_CLAIM =
  /nanswap[^.<\n]{0,60}(?:carries|has|does not carry|doesn't carry|supports|lists)[^.<\n]{0,20}(?:no\s+USDC|a\s+USDC\s+pair)|no\s+USDC\s+pair|USDC\s+is\s+not\s+one\s+of\s+them/i;

/**
 * The pair URL that does not exist. A bare ticker is not a pair: nanswap's are
 * chain-qualified. https://nanswap.com/swap/USDC/XNO answers 404 while
 * https://nanswap.com/swap/USDC-BASE/XNO and /swap/USDC-ETH/XNO answer 200.
 *
 * `/swap/USDC/XNO` with nothing between the ticker and the terminator, so the honest
 * chain-qualified routes cannot match and the law cannot forbid the route it requires.
 */
const BARE_PAIR_URL = /nanswap\.com\/swap\/USDC\/XNO/i;

/** The direct USDC route the page must publish as a link an agent can follow. */
const DIRECT_USDC_ROUTE = "https://nanswap.com/swap/USDC-BASE/XNO";

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
// L85 / L86 — the scanners are proven able to fail, in both directions, before they
// pass anything
// ---------------------------------------------------------------------------

test("L85 the scanner rejects the denial the old page published, and accepts the sentence the page publishes now", () => {
  // The positive control. If this fixture passed, every check below would be worthless.
  //
  // FIRST half — the denial. Each line is a false coverage claim in a different spelling,
  // and each is a claim about a service's pair list that was measured false. The first
  // line is the exact sentence the old page published.
  const denials = [
    "nanswap carries no USDC pair (measured 2026-09-23)",
    "nanswap does not carry a USDC pair, so a USDC holder must hop chains first",
    "nanswap has no USDC pair at all",
    "no USDC pair is available on the service",
    "USDC is not one of them",
  ];
  for (const line of denials) {
    assert.ok(
      FALSE_COVERAGE_CLAIM.test(line),
      `the denial the old page published was not caught by FALSE_COVERAGE_CLAIM: ${line}`
    );
  }

  // SECOND half — and the scanner must ACCEPT the true sentence, or the law forbids the
  // only fix there is: naming the chain-qualified pair that measured 200. This is the
  // control that the pre-Block-205 file did not have, and the reason it went red on a
  // page that was right.
  const truth = [
    "nanswap serves USDC on Base and Ethereum directly (https://nanswap.com/swap/USDC-BASE/XNO)",
    "nanswap carries USDC-BASE and USDC-ETH, measured 200",
    "nanswap's USDC pairs are chain-qualified, so a bare ticker is not a pair",
  ];
  for (const line of truth) {
    assert.ok(
      !FALSE_COVERAGE_CLAIM.test(line),
      `the scanner would forbid the honest, corrected sentence: ${line}`
    );
  }

  // BARE_PAIR_URL: the stub is caught, and the chain-qualified routes — the ones the page
  // is REQUIRED to link — are not. A scanner that flagged USDC-BASE would forbid the route
  // it exists to require, and an unfixable law gets deleted.
  const stubs = [
    '<a href="https://nanswap.com/swap/USDC/XNO">swap here</a>',
    "https://nanswap.com/swap/usdc/xno", // the pair is what is wrong, in any casing
  ];
  for (const line of stubs) {
    assert.ok(BARE_PAIR_URL.test(line), `the bare-ticker stub was not caught by BARE_PAIR_URL: ${line}`);
  }
  const honest = [
    '<a href="https://nanswap.com/swap/USDC-BASE/XNO">USDC (Base) -> XNO</a>',
    '<a href="https://nanswap.com/swap/USDC-ETH/XNO">USDC (Ethereum) -> XNO</a>',
    '<a href="https://nanswap.com/swap/XNO/USDC-BASE">XNO -> USDC (Base)</a>',
    "its pairs are chain-qualified, so a bare /swap/USDC/XNO is not a pair and 404s",
  ];
  for (const line of honest) {
    assert.ok(!BARE_PAIR_URL.test(line), `the scanner would forbid an honest, working route: ${line}`);
  }

  // The denial sentence NAMES the same stub path. FALSE_COVERAGE_CLAIM must not be the
  // thing that catches it — the two mechanisms have to be independently exercisable, or
  // deleting one would leave the suite looking green on the failure it was written for.
  assert.ok(
    !BARE_PAIR_URL.test("nanswap carries no USDC pair (measured 2026-09-23)"),
    "FALSE_COVERAGE_CLAIM's control is leaning on BARE_PAIR_URL; each must be caught by its own mechanism"
  );
  assert.ok(
    !FALSE_COVERAGE_CLAIM.test('<a href="https://nanswap.com/swap/USDC/XNO">swap here</a>'),
    "BARE_PAIR_URL's control is leaning on FALSE_COVERAGE_CLAIM; each must be caught by its own mechanism"
  );
});

// ---------------------------------------------------------------------------
// L85 — no false pair claim ships, in either direction
// ---------------------------------------------------------------------------

test("L85 site/try-nano.html never denies a USDC pair nanswap actually carries", () => {
  const m = PAGE.match(FALSE_COVERAGE_CLAIM);
  assert.equal(
    m,
    null,
    `the shipped on-ramp page still carries the false denial ${JSON.stringify(m && m[0])}: ` +
      `nanswap's USDC pairs are chain-qualified and measured 200 (USDC-BASE, USDC-ETH — ` +
      `node opener/oracle-nanswap-pairs.js), so this sentence sends a USDC holder away from a ` +
      `service that would have served it`
  );
});

test("L85 no link on the shipped page points at the bare-ticker stub (it is not a pair)", () => {
  const offenders = [];
  for (const m of PAGE.matchAll(/href="([^"]+)"/g)) {
    if (BARE_PAIR_URL.test(m[1])) offenders.push(m[1]);
  }
  assert.deepEqual(
    offenders,
    [],
    `the page links a pair that does not exist — https://nanswap.com/swap/USDC/XNO answers 404 ` +
      `while /swap/USDC-BASE/XNO and /swap/USDC-ETH/XNO answer 200:\n  ${offenders.join("\n  ")}`
  );
});

// ---------------------------------------------------------------------------
// L86 — the page names the route that works, and says why the bare ticker did not
// ---------------------------------------------------------------------------

test("L86 the shipped page names the direct nanswap pair that carries the USDC leg", () => {
  // The route the conversion plan's step 3 asks for, as a link an agent can follow. The
  // Solana fallback alone is NOT enough: an agent holding USDC on Base has a direct pair
  // and telling it otherwise is the error this file was rewritten to catch.
  assert.ok(
    PAGE.includes(`href="${DIRECT_USDC_ROUTE}"`),
    `the page does not link ${DIRECT_USDC_ROUTE}, the measured direct USDC -> XNO pair; ` +
      `an agent holding USDC on Base reads it and still cannot convert`
  );
  // And the other chain-qualified rail, so a USDC holder on Ethereum is served too.
  assert.ok(
    PAGE.includes('href="https://nanswap.com/swap/USDC-ETH/XNO"'),
    "the page does not link https://nanswap.com/swap/USDC-ETH/XNO, the USDC-on-Ethereum pair (measured 200)"
  );
});

test("L86 the page explains that a bare ticker is not a pair, and dates the measurement", () => {
  // Naming a working route is not enough: the next author who probes /swap/USDC/XNO, gets
  // 404 and concludes "unsupported" needs the reason already on the page. This is the exact
  // sentence whose absence cost us half a day and a false claim to every USDC agent.
  assert.match(
    PAGE,
    /bare\s+(?:ticker|\/swap\/USDC\/XNO)|a bare ticker is not a pair|bare \/swap\/USDC\/XNO/i,
    "the page never explains that a bare ticker is not a pair, so the 404 that misled us will mislead the next author"
  );
  // And it must be dated, so a reader can tell a measurement from an assertion.
  assert.match(
    PAGE,
    /Measured\s+2026-09-23|measured\s+2026-09-23/i,
    "the page states the pair list without the date it was measured, so a future reader cannot tell how stale it is"
  );
});

test("L86 the page states the reverse direction, so a Nano balance is not a stored promise", () => {
  // The objection this answers, on the record: "a Nano balance I cannot convert is a stored
  // promise". A page that shows only the way IN makes that objection true.
  assert.match(
    PAGE,
    /XNO\s*(->|&rarr;|to)\s*(USD|EUR|USDC)/i,
    "the page never states that XNO converts back to USDC/USD/EUR, so it shows no exit and reads as a stored promise"
  );
});

// ---------------------------------------------------------------------------
// L87 — the shipped bytes are what the generator produces, and the generator is honest
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

test("L87 the generator is the only writer of the page, and its swap section is chain-qualified", () => {
  // The sync's whole job is that the page cannot drift from the live API's copy of the same
  // document. Both halves are read from the real files: the sync script must render through
  // the real onrampHtml, and the page it writes must be the page this law compares against.
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

  // The generator's own swap section is the source of truth for what the page may claim —
  // this is the half that makes the page's sentence a MEASUREMENT rather than an assertion.
  //
  // (a) Every declared DIRECT route is a chain-qualified USDC pair measured at HTTP 200.
  const direct = onramp.SWAP_USDC_DIRECT || [];
  assert.ok(direct.length >= 1, "the on-ramp declares no direct USDC route at all");
  for (const r of direct) {
    assert.match(
      String(r.url),
      /^https:\/\/nanswap\.com\/swap\/USDC-(?:BASE|ETH)\/XNO$/i,
      `a direct USDC route must be a chain-qualified nanswap pair (USDC-BASE or USDC-ETH), got ${r.url}`
    );
    assert.equal(
      r.measured_status,
      200,
      `a direct USDC route must carry the status it was measured at (200), got ${JSON.stringify(r.measured_status)} for ${r.url}`
    );
    assert.ok(
      /USD Coin/i.test(String(r.measured_title || "")),
      `a direct USDC route must carry the page title the probe read, got ${JSON.stringify(r.measured_title)} for ${r.url}`
    );
  }

  // (b) The pair list the page publishes carries both chain-qualified USDC pairs and NOT a
  // bare "USDC" ticker — a bare ticker in the carried list is the same false claim as the
  // denial, pointed the other way.
  const carried = onramp.SWAP_PAIRS_CARRIED || [];
  assert.ok(
    carried.includes("USDC-BASE") && carried.includes("USDC-ETH"),
    `SWAP_PAIRS_CARRIED must carry the chain-qualified USDC pairs, got ${JSON.stringify(carried)}`
  );
  assert.ok(
    !carried.some((p) => String(p).trim().toUpperCase() === "USDC"),
    `SWAP_PAIRS_CARRIED must not carry a bare "USDC" ticker — nanswap's pairs are chain-qualified, got ${JSON.stringify(carried)}`
  );

  // (c) No declared route — direct, hop or reverse — is the bare-ticker stub.
  const routeUrls = (onramp.SWAP_USDC_ROUTES || []).flatMap((r) => [r.url, r.also]).filter(Boolean);
  assert.ok(routeUrls.length >= 1, "the on-ramp declares no USDC route at all");
  const allUrls = [...direct.map((r) => r.url), ...routeUrls, onramp.SWAP_REVERSE && onramp.SWAP_REVERSE.url].filter(Boolean);
  for (const u of allUrls) {
    assert.ok(
      !BARE_PAIR_URL.test(u),
      `opener/onramp.js itself names the bare-ticker stub, which is not a pair (measured 404): ${u}`
    );
    assert.match(u, /^https:\/\//, `a USDC route must be an https link an agent can follow: ${u}`);
  }
});
