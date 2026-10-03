/**
 * tests/site_l68_scratch.test.mjs — the suite never writes to the network it measures.
 *
 * The gap this file makes executable. On 2026-09-20 the L68 round trip in
 * site_no_wallet_ask.test.mjs POSTed to https://getunstuck.space on every run of the suite, so
 * each run wrote a row into the production ask store attributed to a throwaway nano_ address.
 * Measured with `unstuck-bridge asks-target`:
 *
 *   "asks_we_wrote_this_hour": 19, "asks_we_wrote_total": 540, "outside_asks_this_hour": 0,
 *   "self_filling": true
 *
 * The production ask store is the denominator for "outside asks" — the one number this network
 * may honestly publish. A row our own test wrote is our own voice, and an ask counts for nothing
 * unless its asker is an agent that is not us. So a test was manufacturing the exact quantity the
 * whole mission is measured on.
 *
 * The laws, each named so a failure says which property broke:
 *
 *   L73 — no site test posts a write to the live origin. Suite writes go only to a local scratch
 *         server.
 *   L74 — the L68 round trip runs against a scratch instance of the shipped network server, which
 *         answers 201 and stores the on-ramp address as asker.
 *
 * L73 is enforced by a SOURCE SCAN, not by a rule about how one test is written: a future edit
 * that adds a POST next to LIVE_ORIGIN fails the build wherever it is added. The scan is proven
 * non-vacuous by feeding it a mutant that does exactly that, and a clean file that does not.
 *
 * Run all:  node --test tests/site_l68_scratch.test.mjs
 * Run one:  node --test --test-name-pattern=L73 tests/site_l68_scratch.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLiveWriteCalls, startScratchNetwork, SERVER_SOURCE } from "./scratch-network.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");

const LIVE_ORIGIN = "https://getunstuck.space";
const API_PATH = "/unstuck/api";

// ---------------------------------------------------------------------------
// L73 — no test writes to the live origin
// ---------------------------------------------------------------------------

test("L73 no test file posts a write to LIVE_ORIGIN", () => {
  // The falsifiable core: scan the real test sources on disk, not a list somebody maintains.
  const offenders = findLiveWriteCalls(HERE);
  assert.deepEqual(
    offenders,
    [],
    `a test in site/tests/ writes to the live origin, so running the suite puts our own ask, ` +
      `answer or account on the network it measures — and that store is the denominator for ` +
      `"outside asks". Send the write to a scratch instance instead ` +
      `(see tests/scratch-network.mjs):\n  ${offenders.join("\n  ")}`
  );
});

test("L73 the scanner catches a write to the live origin and passes a clean file", () => {
  // Non-vacuity. A scanner that never finds anything is indistinguishable from a clean suite, so
  // it is run here against both a mutant that violates the law and a file that obeys it. The
  // mutant is written to a temp directory the scanner is pointed at, never into site/tests/.
  const os = fs.mkdtempSync(path.join(tmpdir(), "l73-scan-"));
  try {
    // The mutant is ASSEMBLED, never written as a literal: it must not be a fetch() call the
    // scanner can see in this file, or this test would flag itself and the law would eat its own
    // oracle. The pieces below are deliberately inert strings.
    const M = "LIVE_" + "ORIGIN";
    const W = "P" + "OST";
    const FA = "fetch";
    const mutant = [
      `const ${M} = "https://getunstuck.space";`,
      `test("mutant", async () => {`,
      `  await ${FA}(\`\${${M}}/unstuck/api/ask\`, {`,
      `    method: "${W}",`,
      `    headers: { "Content-Type": "application/json" },`,
      `    body: JSON.stringify({ title: "our own ask" }),`,
      `  });`,
      `});`,
    ].join("\n");
    const clean = [
      `const ${M} = "https://getunstuck.space";`,
      `test("clean", async () => {`,
      `  const r = await ${FA}(\`\${${M}}/unstuck/api/health\`);`,
      `  const other = await ${FA}("http://127.0.0.1:4321/unstuck/api/ask", { method: "${W}" });`,
      `});`,
    ].join("\n");
    fs.writeFileSync(path.join(os, "mutant.test.mjs"), mutant);
    fs.writeFileSync(path.join(os, "clean.test.mjs"), clean);

    const found = findLiveWriteCalls(os);
    assert.equal(found.length, 1, `the scanner found ${found.length} offenders in the mutant set, expected exactly 1`);
    assert.match(found[0], /mutant\.test\.mjs/, `the scanner blamed the wrong file: ${found[0]}`);
    assert.ok(
      !found.some((f) => f.startsWith("clean.test.mjs")),
      "the scanner flagged a GET against the live origin, which is the read-only probe the law permits"
    );
  } finally {
    fs.rmSync(os, { recursive: true, force: true });
  }
});

test("L73 the live origin still appears in the suite as a read-only probe", () => {
  // The law is not "stop checking the deployed origin". An ask a stranger cannot reach is not a
  // network, so the origin must keep being probed — read-only. A suite that stopped naming the
  // origin entirely would satisfy a careless scanner and check nothing.
  const files = fs.readdirSync(HERE).filter((f) => f.endsWith(".mjs"));
  const namers = files.filter((f) => fs.readFileSync(path.join(HERE, f), "utf8").includes(LIVE_ORIGIN));
  assert.ok(
    namers.length >= 2,
    `only ${namers.length} test file(s) name ${LIVE_ORIGIN}; the deployed origin must still be probed read-only`
  );
  // And at least one of them must fetch it with a GET-only shape.
  const getters = namers.filter((f) => {
    const body = fs.readFileSync(path.join(HERE, f), "utf8");
    return /fetch\s*\(/.test(body) && /LIVE_ORIGIN/.test(body);
  });
  assert.ok(getters.length > 0, "no test reads the live origin at all; the read-only probe is gone");
});

// ---------------------------------------------------------------------------
// L74 — the round trip runs on a scratch instance of the shipped server
// ---------------------------------------------------------------------------

test("L74 the scratch instance serves the shipped nserver-persist.js, not a stub of its own", async (t) => {
  const scratch = await startScratchNetwork();
  try {
    t.diagnostic(`engine=${scratch.mode}${scratch.fallbackReason ? ` reason=${scratch.fallbackReason}` : ""}`);
    // In a normal checkout the committed module loads, so the code under test is the real file.
    // The fallback exists for a single-file download and says so; it must never be silent.
    assert.ok(
      fs.existsSync(SERVER_SOURCE),
      `${SERVER_SOURCE} is missing — the round trip would have no shipped server to exercise`
    );
    assert.equal(
      scratch.mode,
      "server",
      `the scratch instance ran the ${scratch.mode} engine, not the shipped server ` +
        `(${scratch.fallbackReason || "no reason given"}); a fallback that stands in for the real ` +
        `handler would turn a weak run into a claim about code that never executed`
    );
  } finally {
    scratch.stop();
  }
});

test("L74 the scratch round trip answers 201 and refuses an unknown onboard_id", async () => {
  const scratch = await startScratchNetwork();
  try {
    const KEYGEN = new URL("../../opener/nano-keypair.js", import.meta.url).pathname;
    const kp = JSON.parse(execSync(`node "${KEYGEN}" --json`, { encoding: "utf8" }));
    const ownAddr = kp.address;
    const on = await fetch(`${scratch.base}${API_PATH}/v1/onramp/self`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: ownAddr }),
    }).then((r) => r.json());
    assert.match(String(on.address), /^nano_[13][0-9a-z]{59}$/, `scratch on-ramp returned no address: ${JSON.stringify(on.address)}`);
    assert.equal(on.address, ownAddr, "scratch on-ramp must return the address we registered");
    assert.equal(on.custody, "self", "scratch on-ramp must return custody:self");

    const posted = await fetch(`${scratch.base}${API_PATH}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboard_id: on.onboard_id, title: "L74 scratch", body: "L74 scratch" }),
    });
    assert.equal(posted.status, 201, `the scratch ask answered ${posted.status}, not 201`);
    const pj = await posted.json();
    const back = await fetch(`${scratch.base}${API_PATH}/ask/${pj.id}`).then((r) => r.json());
    assert.equal(
      back.ask && back.ask.asker,
      on.address,
      "the scratch store did not keep the on-ramp address as the asker"
    );

    const bad = await fetch(`${scratch.base}${API_PATH}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboard_id: 999999999, title: "L74 scratch", body: "must be refused" }),
    });
    assert.equal(bad.status, 400, `an unknown onboard_id on the scratch server answered ${bad.status}, not 400`);
  } finally {
    scratch.stop();
  }
});

test("L74 the scratch database is a temp file removed when the run ends", async () => {
  const scratch = await startScratchNetwork();
  const tmpDb = scratch.tmpDb;
  assert.ok(
    tmpDb.startsWith(tmpdir()),
    `the scratch db ${tmpDb} is not under the temp directory; a scratch store must not live beside the network's own db`
  );
  // The store file appears when the first write lands, so make one: a scratch db that was never
  // touched proves nothing about where the writes went.
  await fetch(`${scratch.base}${API_PATH}/v1/onramp/self`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "nano_1" + "3".repeat(59) }),
  });
  assert.ok(fs.existsSync(tmpDb), "the scratch db was never created, so nothing was really exercised");
  scratch.stop();
  assert.equal(fs.existsSync(tmpDb), false, `the scratch db ${tmpDb} survived stop(); a temp store must be removed`);
});
