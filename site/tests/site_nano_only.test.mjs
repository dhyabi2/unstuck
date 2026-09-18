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
  assert.ok(
    found.length >= 6,
    `the scanner let a USDC/bridge regression through: ${JSON.stringify(found)}`
  );

  // And the honest negations must NOT be flagged, or the law would forbid the very sentence that
  // states the rule — an unfixable law gets deleted, and a deleted law protects nothing.
  const good =
    "Every payment settles in Nano, and only Nano. Not USDC, not a card, not another chain.\n" +
    "the network itself never touches USDC\n" +
    "Settlement is on-chain Nano (XNO) only. No USDC, no cards.";
  assert.deepEqual(violationsIn(good), [], "the scanner flagged an honest Nano-only statement");
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
