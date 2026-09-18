/**
 * tests/site_laws_nano_only.test.mjs — the network settles in Nano, and only Nano.
 *
 * Corrective action, owner 2026-09-18: the site shipped a "Bridge" tab and an
 * `agent.json` `bridge_proxy` object advertising a Nano-to-USDC bridge for x402
 * services. That is a settlement and conversion path in the opposite direction to
 * the one rule the whole network rests on — "Every payment between agents in my
 * network settles in Nano (XNO) — never USDC, never a card, never another chain."
 * A network that advertises a USDC conversion path has proved the corporate rails'
 * case instead of its own. The page, the manifest and the llms.txt must never carry
 * one again, and this file is the law that keeps it that way.
 *
 * The law, named so a failure says which property broke:
 *
 *   L48 — no shipped site file (index.html, agent.json, llms.txt) offers a USDC
 *         settlement or conversion path: no bridge endpoint, no non-Nano payment
 *         rail, no swap instruction. A mention of USDC is allowed only in a
 *         sentence that denies it.
 *
 * The check is a real scan of the bytes that ship, with the positive-control half
 * proving the scanner would in fact catch a regression: a known-bad fixture must be
 * rejected by the same function before the shipped files are allowed to pass.
 *
 * Run all:  node --test tests/site_laws_nano_only.test.mjs
 * Run one:  node --test --test-name-pattern=L48 tests/site_laws_nano_only.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");

/** The files this law governs — exactly the three the corrective action names. */
const GUARDED = ["index.html", "agent.json", "llms.txt"];

/**
 * Strings that ARE a USDC settlement or conversion path. Each is a hard fail.
 *
 * A "bridge" of any kind is refused: on this site the word only ever meant routing
 * a USDC x402 service through Nano, which is a conversion path, and the site no
 * longer brokers anything. "nanswap" and "/proxy?target=" are the concrete USDC
 * on/off-ramps the site used to advertise.
 */
const FORBIDDEN = [
  /\/proxy\?target=/i,
  /(?<!\/v1\/)\bverify-payment\b/i,
  /\bbridge_proxy\b/i,
  /\bbridge_nano_to_usdc/i,
  /\bnanswap\b/i,
  /\bbridge\b/i,
  /:\s*3402\b/, // the retired bridge proxy's port
];

/**
 * A "settles in X" claim is only a violation when X is not Nano. "no USDC",
 * "never touches USDC", "not USDC" are the honest statements and must survive.
 */
const NEGATION_CUES =
  /(never|no|not|nothing|only|forbids?|refuses?|without|does not|doesn't|cannot|can't|instead of|rather than)/i;

const USDC = /USDC/i;

function lines(file) {
  return fs.readFileSync(path.join(SITE, file), "utf8").split("\n");
}

/**
 * Return every violation in one file's text. A line mentioning USDC is a violation
 * unless the same line denies it with a cue word. Everything in FORBIDDEN always is.
 */
function violationsIn(text) {
  const out = [];
  for (const [n, line] of text.split("\n").entries()) {
    for (const re of FORBIDDEN) {
      const m = line.match(re);
      if (m) out.push({ line: n + 1, why: `forbidden settlement/bridge token "${m[0]}"`, text: line.trim() });
    }
    if (USDC.test(line) && !NEGATION_CUES.test(line)) {
      out.push({ line: n + 1, why: "names USDC without denying it", text: line.trim() });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// L48 — no USDC settlement or conversion path may ship
// ---------------------------------------------------------------------------

test("L48 the scanner rejects a regression, so a pass on the real files means something", () => {
  // Positive control. If this fixture passed, every check below would be worthless.
  const bad = [
    `<a data-page="bridge">Bridge</a>`,
    `<li>If the target returns a USDC x402 price, the bridge converts it to Nano</li>`,
    `Send a request through the bridge: GET /proxy?target=<url>`,
    `Verify with POST /verify-payment`,
    `pay USDC to the bridge address`,
    `if you hold USDC, swap it into XNO at nanswap`,
  ].join("\n");
  const found = violationsIn(bad);
  assert.ok(found.length >= 6, `the scanner let a USDC/bridge regression through: ${JSON.stringify(found)}`);

  // And the honest negations must NOT be flagged, or the law would forbid the very
  // sentence that states the rule.
  const good =
    "Every payment settles in Nano, and only Nano. Not USDC, not a card, not another chain.\n" +
    "the network itself never touches USDC\n" +
    "Settlement is on-chain Nano (XNO) only. No USDC, no cards.";
  assert.deepEqual(violationsIn(good), [], "the scanner flagged an honest Nano-only statement");
});

test("L48 index.html, agent.json and llms.txt ship no USDC settlement or conversion path", () => {
  for (const file of GUARDED) {
    assert.ok(fs.existsSync(path.join(SITE, file)), `${file} is missing from the working copy`);
    const found = violationsIn(fs.readFileSync(path.join(SITE, file), "utf8"));
    assert.deepEqual(
      found,
      [],
      `${file} ships a USDC settlement/conversion path:\n` +
        found.map((v) => `  line ${v.line}: ${v.why} -> ${v.text}`).join("\n")
    );
  }
});

test("L48 the page has no Bridge tab and no bridge page element", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  assert.ok(!/data-page="bridge"/.test(html), "the shipped page still links a Bridge tab");
  assert.ok(!/id="page-bridge"/.test(html), "the shipped page still has a bridge page element");
  // The SPA's own view list must not route to a bridge either.
  const pages = html.match(/const pages = \[([^\]]*)\]/);
  assert.ok(pages, "the shipped page no longer declares its view list");
  assert.ok(!/bridge/i.test(pages[1]), `the view list still routes to a bridge: ${pages[1]}`);
});

test("L48 agent.json advertises no bridge and no endpoint outside the Nano network", () => {
  const aj = JSON.parse(fs.readFileSync(path.join(SITE, "agent.json"), "utf8"));
  assert.equal(aj.payment.asset, "XNO", "agent.json must advertise XNO as the settlement asset");
  assert.ok(
    aj.bridge_proxy === null || aj.bridge_proxy === undefined,
    `agent.json still advertises a bridge_proxy: ${JSON.stringify(aj.bridge_proxy)}`
  );
  const caps = aj.capabilities || {};
  for (const [k, v] of Object.entries(caps)) {
    assert.ok(
      !/usdc/i.test(k) && !(typeof v === "string" && /usdc/i.test(v)) && v !== true || !/bridge/i.test(k),
      `agent.json still advertises the capability ${k}=${v}`
    );
  }
  // No advertised endpoint may point at the retired bridge proxy.
  for (const ep of aj.endpoints || []) {
    assert.ok(!/usdc|bridge/i.test(ep.path || ""), `agent.json advertises a non-Nano endpoint ${ep.path}`);
    assert.ok(!/3402/.test(ep.path || ""), `agent.json consumes the retired bridge port at ${ep.path}`);
  }
});
