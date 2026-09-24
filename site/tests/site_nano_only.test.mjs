/**
 * tests/site_nano_only.test.mjs — law L48: the network settles in Nano, and only Nano.
 *
 * Corrective action, owner 2026-09-18 17:30: *"NEVER settle or broker anything but Nano — drop the
 * Nano-to-USDC bridge."* The corrective action names this file and this law:
 *
 *   • remove the Bridge nav tab and page from index.html;
 *   • remove the bridge_proxy block and the bridge capability flag from agent.json;
 *   • add the test that fails the deploy if index.html, agent.json or llms.txt advertises a USDC
 *     settlement or conversion path;
 *   • keep the USDC -> XNO swap at nanswap, which belongs to the agent converting its own money,
 *     never to the network brokering a rail.
 *
 * The law, named so a failure says which property broke:
 *
 *   L48 — no shipped site file (index.html, agent.json, llms.txt, and any tracked alias under
 *         .well-known/) offers a USDC settlement or conversion path: no bridge endpoint, no
 *         non-Nano payment rail, no swap instruction. A mention of USDC is allowed only in a
 *         sentence that denies it.
 *
 * The check is a real scan of the bytes that ship. The scanner itself lives in `nano_only_scan.mjs`
 * and is imported here and by L34 in `site_laws.test.mjs`, so the two guards can never drift.
 *
 * The positive control is what makes a pass mean something: a known-bad fixture must be rejected by
 * the same function, and an honest negation must not be, before the shipped files are allowed through.
 *
 * Run all:  node --test tests/site_nano_only.test.mjs
 * Run one:  node --test --test-name-pattern=L48 tests/site_nano_only.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  GUARDED,
  GUARDED_ALIASES,
  formatViolations,
  violationsIn,
} from "./nano_only_scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");

/** Live on disk when it is tracked; a file git does not know cannot reach Vercel. */
function isTracked(relFromRepo) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", relFromRepo], {
      cwd: REPO,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

test("L48 the alias scan distinguishes a tracked manifest from an untracked one", () => {
  // The alias half of L48 is only a real guard if `isTracked` answers both ways: a tracked alias is
  // scanned, an untracked one is correctly skipped. Without this, `return true` and `return false`
  // were both survivable mutations — a guard whose two branches are never distinguished is a guess.
  // Both fixtures are real paths in this repo, so the answers are not assumptions.
  assert.equal(isTracked("site/agent.json"), true, "a committed file must read as tracked");
  assert.equal(
    isTracked("site/this-path-does-not-exist.json"),
    false,
    "a path git does not know must not read as tracked"
  );
});

// ---------------------------------------------------------------------------
// L48 — no USDC settlement or conversion path may ship
// ---------------------------------------------------------------------------

test("L48 the scanner rejects a regression, so a pass on the real files means something", () => {
  // Positive control. If this fixture passed, every check below would be worthless.
  //
  // Each fixture line is chosen so it is caught by ONE mechanism only, so a scanner with that
  // mechanism deleted cannot limp through on the others. An earlier version of this control let a
  // gutted scanner pass: deleting the code that records a forbidden-token hit left the USDC lines
  // still counting, so `found.length >= 6` held and the mutation survived. The ledger's own kill
  // check caught that, and this control is built line-by-line so it cannot happen again.
  const byToken = [
    "Send a request through the bridge: GET /proxy?target=<url>", // /proxy?target=, and "bridge"
    "Verify with POST /verify-payment", // verify-payment (not /v1/verify-payment)
    `"bridge_proxy": {"endpoint": "..."}`, // bridge_proxy
    "capabilities.bridge_nano_to_usdc_x402 = true", // bridge_nano_to_usdc
    "<a data-page=\"bridge\">Bridge</a>", // the bare word bridge, no USDC on the line
    "the proxy listens on 172.86.112.140:3402", // :3402
  ];
  const found = byToken.flatMap((l) => violationsIn(l));
  assert.ok(
    found.length >= byToken.length,
    `the scanner let a USDC/bridge regression through: ${JSON.stringify(found)}`
  );
  // And each line must be caught by the FORBIDDEN mechanism specifically, not incidentally by the
  // USDC rule — five of the six lines above name no USDC at all.
  const nonUsdcLines = byToken.filter((l) => !/USDC/i.test(l));
  assert.equal(nonUsdcLines.length, 5, "the control must keep lines that do NOT mention USDC");
  for (const line of nonUsdcLines) {
    const v = violationsIn(line);
    assert.ok(
      v.some((x) => /forbidden settlement\/bridge token/.test(x.why)),
      `the control line was not caught by the FORBIDDEN mechanism: ${line}`
    );
  }

  // And the honest negations must NOT be flagged, or the law would forbid the very sentence that
  // states the rule — an unfixable law gets deleted, and a deleted law protects nothing.
  // Each line names USDC, so a scanner whose negation check is deleted fails HERE.
  const good =
    "Every payment settles in Nano, and only Nano. Not USDC, not a card, not another chain.\n" +
    "the network itself never touches USDC\n" +
    "Settlement is on-chain Nano (XNO) only. No USDC, no cards.";
  assert.deepEqual(violationsIn(good), [], "the scanner flagged an honest Nano-only statement");
  assert.ok(/USDC/.test(good), "the negation control must actually mention USDC to prove the rule");

  // The scanner must RETURN its findings with a line number and a reason, and format them. A
  // scanner that gathers violations and then returns nothing (or drops the line number) is exactly
  // as useless as one that never gathers them, so both halves are pinned here.
  const one = violationsIn("GET /proxy?target=x");
  assert.equal(one.length, 1, "a single forbidden token must yield exactly one violation");
  assert.equal(typeof one[0].line, "number", "each violation must carry its line number");
  assert.equal(one[0].line, 1, "the violation's line number must be the line it was found on");
  assert.ok(typeof one[0].why === "string" && one[0].why.length > 0, "each violation must say why");
  assert.match(formatViolations(one), /line 1: .+ -> GET \/proxy\?target=x/, "formatViolations must render a violation");
  assert.equal(formatViolations([]), "", "formatViolations of nothing must be empty");
});

test("L48 index.html, agent.json and llms.txt ship no USDC settlement or conversion path", () => {
  for (const file of GUARDED) {
    const abs = path.join(SITE, file);
    assert.ok(fs.existsSync(abs), `${file} is missing from the working copy`);
    const found = violationsIn(fs.readFileSync(abs, "utf8"));
    assert.deepEqual(
      found,
      [],
      `${file} ships a USDC settlement/conversion path:\n${formatViolations(found)}`
    );
  }
});

test("L48 no tracked alias of the manifest advertises a bridge either", () => {
  // `agent.json` is republished under .well-known/ for agent discovery. A bridge left in the alias
  // is a published surface just as much as the root file, so it is scanned whenever it would ship.
  for (const alias of GUARDED_ALIASES) {
    const abs = path.join(SITE, alias);
    if (!isTracked(`site/${alias}`)) continue; // untracked: cannot reach Vercel, cannot advertise
    const found = violationsIn(fs.readFileSync(abs, "utf8"));
    assert.deepEqual(
      found,
      [],
      `${alias} is tracked and ships a USDC settlement/conversion path:\n${formatViolations(found)}`
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
      (!/usdc/i.test(k) && !(typeof v === "string" && /usdc/i.test(v)) && v !== true) || !/bridge/i.test(k),
      `agent.json still advertises the capability ${k}=${v}`
    );
  }
  // No advertised endpoint may point at the retired bridge proxy.
  for (const ep of aj.endpoints || []) {
    assert.ok(!/usdc|bridge/i.test(ep.path || ""), `agent.json advertises a non-Nano endpoint ${ep.path}`);
    assert.ok(!/3402/.test(ep.path || ""), `agent.json consumes the retired bridge port at ${ep.path}`);
  }
  // The settlement claim itself must be the Nano-only one, stated positively.
  assert.equal(aj.capabilities?.settlement_asset, "XNO", "agent.json must name XNO as the settlement asset");
  assert.equal(aj.capabilities?.settles_nano_only, true, "agent.json must state it settles Nano only");
});

test("L48 the agent's OWN swap at nanswap is not what this law forbids", () => {
  // The corrective action keeps the USDC -> XNO leg at nanswap for the agent converting its own
  // money. This law governs the NETWORK's published surfaces, so it must not forbid an agent from
  // doing that itself — and it must not be softened to allow the network to broker it either.
  // The distinction is real and testable: the shipped pages name no swap, and the scanner would
  // reject one the moment the network offered it.
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  const llms = fs.readFileSync(path.join(SITE, "llms.txt"), "utf8");
  assert.ok(!/nanswap/i.test(html), "the network's own page must not send an agent to a swap it brokers");
  assert.ok(!/nanswap/i.test(llms), "the network's own entry point must not advertise a swap path");

  // Falsifier: the same scanner rejects the sentence a brokering network would publish.
  const brokered = "Unstuck converts your USDC to Nano for you at nanswap before settling.";
  assert.ok(
    violationsIn(brokered).length > 0,
    "the scanner would have to reject a network that brokered the swap itself"
  );
});
