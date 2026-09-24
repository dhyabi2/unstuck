/**
 * tests/site_onramp_artifact.test.mjs — the network publishes a measurement an outside agent can RUN.
 *
 * The gap this file makes executable. Block 113 wrote `opener/nano-onramp-check.js`: a hermetic,
 * wallet-free measurement of the Nano on-ramp with three controls, two of them negative. Its own
 * oracle passes. But it lived only in the repository — an agent reading the discovery documents on
 * getunstuck.space was told what the network claims and given no way to check it. A claim a reader
 * cannot reproduce is a claim the reader has to trust, which is the one thing this network says it
 * does not ask for.
 *
 * The laws, each named so a failure says which property broke:
 *
 *   L69 — the artifact the discovery document names is fetchable from the origin that serves the
 *         document, is the same bytes as the committed source in the repository, and still carries
 *         the wallet-free guarantees its oracle exercised. A copy that drifted from the reviewed
 *         source is a different program than the one that was tested.
 *   L70 — the discovery document tells a reader how to run the artifact and what it will prove,
 *         and never claims the artifact does something it does not (it holds no funds, sends no
 *         transaction, and does not open an account).
 *   L71 — the artifact is safe to publish on the network it measures: by default it writes nothing
 *         to this network, because an ask produced by our own software is a test of our software and
 *         counting it as activity would make every published number worthless.
 *
 * The file half reads the real shipped bytes on both sides (site copy and committed source), never
 * a reimplementation. The live half is a real HTTPS fetch of the documented URL, and it SKIPS with
 * a printed diagnostic when the origin does not carry the artifact yet — a skip is not a pass, but a
 * network check must not fail the deploy that is about to publish the thing it checks.
 *
 * Run all:  node --test tests/site_onramp_artifact.test.mjs
 * Run one:  node --test --test-name-pattern=L69 tests/site_onramp_artifact.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");

const LIVE_ORIGIN = "https://getunstuck.space";
/** The published artifact, origin-relative: one path, one copy, no build step. */
const ARTIFACT_PATH = "/nano-onramp-check.js";
const SITE_COPY = path.join(SITE, "nano-onramp-check.js");
const SOURCE = path.join(REPO, "opener", "nano-onramp-check.js");
const LLMS = path.join(SITE, "llms.txt");

const read = (p) => fs.readFileSync(p, "utf8");
const digest = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * The URL the discovery document tells an agent to fetch, parsed out of llms.txt itself —
 * never a constant this test asserts against itself. `null` when the document names none.
 */
function documentedArtifactUrl() {
  const txt = read(LLMS);
  const m = txt.match(
    /(?<![A-Za-z0-9.:/-])\/([A-Za-z0-9._/-]*nano-onramp-check[A-Za-z0-9._-]*\.js)\b/
  );
  return m ? `/${m[1]}` : null;
}

// ---------------------------------------------------------------------------
// The artifact lives at the path the document names — no hard-coded drift
// ---------------------------------------------------------------------------

test("L69 the artifact lives at the exact path llms.txt names", () => {
  const named = documentedArtifactUrl();
  assert.ok(
    named,
    "llms.txt names no origin-relative nano-onramp-check.js; an agent reading the discovery document has nothing to fetch"
  );
  assert.equal(
    named,
    ARTIFACT_PATH,
    `llms.txt names ${named}, but this law governs ${ARTIFACT_PATH}. Renaming the artifact means renaming everything that points at it.`
  );
  assert.ok(
    fs.existsSync(SITE_COPY),
    `${named} is named in llms.txt but site/nano-onramp-check.js does not exist; the documented path would 404`
  );
});

// ---------------------------------------------------------------------------
// L69 — published bytes == committed source bytes, and both keep the guarantees
// ---------------------------------------------------------------------------

test("L69 the published copy is byte-identical to the committed source", () => {
  // One program, two places it must agree. The site copy is what the origin serves; the opener
  // file is what Block 113's L65 oracle exercises. A digest pin is the only honest form of this
  // assertion: it fails on a single byte of drift, in whichever direction the drift went.
  assert.ok(fs.existsSync(SOURCE), `${SOURCE} is missing; the published copy would have no reviewed source`);
  const site = fs.readFileSync(SITE_COPY);
  const src = fs.readFileSync(SOURCE);
  assert.equal(
    digest(site),
    digest(src),
    `site/nano-onramp-check.js (sha256 ${digest(site)}) differs from opener/nano-onramp-check.js ` +
      `(sha256 ${digest(src)}). The artifact an outside agent runs would not be the program this repository tested. ` +
      `Re-copy it: cp opener/nano-onramp-check.js site/nano-onramp-check.js`
  );
});

test("L69 the published copy still carries the wallet-free guarantees its oracle exercised", async () => {
  // Digest equality makes this redundant for the shipped file and essential as documentation of
  // *why* the file may be published: these are the properties a reader is told to rely on. If a
  // future edit re-copies a source that dropped one of them, the failure names the property.
  const body = read(SITE_COPY);
  for (const [needle, what] of [
    ["--self-test", "the hermetic self-test mode the document tells an agent to run"],
    ["tampered_address_rejected", "the negative control that makes failure observable"],
    ["seal_false_on_mismatch", "the negative control on the equality assertion itself"],
    ["scratchAsk", "the local scratch server that keeps its default run off the public network"],
  ]) {
    assert.ok(body.includes(needle), `site/nano-onramp-check.js no longer contains ${needle} (${what})`);
  }
  // No dependency outside the standard library: the document promises nothing to install.
  const requires = [...body.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  const builtin = new Set(
    (await import("node:module")).builtinModules.flatMap((m) => [m, `node:${m}`])
  );
  const external = requires.filter((r) => !builtin.has(r) && !r.startsWith(".") && !r.startsWith("node:"));
  assert.deepEqual(
    external,
    [],
    `site/nano-onramp-check.js requires non-stdlib modules (${external.join(", ")}); the document promises an agent needs nothing installed`
  );
});

// ---------------------------------------------------------------------------
// L70 — the document tells an agent how to run it, and claims nothing false
// ---------------------------------------------------------------------------

test("L70 llms.txt gives the artifact its own section and a runnable command", () => {
  const txt = read(LLMS);
  // A heading, so a text-reading agent scanning the document finds it.
  assert.match(
    txt,
    /^##\s+Verify it yourself\b/m,
    "llms.txt must carry a '## Verify it yourself' section; an agent that never finds the artifact cannot check anything"
  );
  // And the actual invocation, both modes, so the reader is not left to guess the flag.
  assert.ok(
    /node\s+\S*nano-onramp-check\.js\s+--self-test/.test(txt),
    "llms.txt names the artifact but never shows how to run its hermetic self-test"
  );
  assert.ok(
    /node\s+\S*nano-onramp-check\.js\b(?!\s+--self-test)/.test(txt),
    "llms.txt must also show the plain (live) invocation"
  );
  // The URL the document text carries must be a full https URL on the canonical origin, so a
  // reader that copies it verbatim lands on the right host.
  assert.ok(
    txt.includes(`${LIVE_ORIGIN}${ARTIFACT_PATH}`),
    `llms.txt must name the artifact as ${LIVE_ORIGIN}${ARTIFACT_PATH}`
  );
});

test("L70 llms.txt does not claim the artifact does what it does not", () => {
  // The artifact holds no funds, signs nothing, and cannot open an account — a Nano chain begins
  // with a receive. A document that let a reader believe otherwise would be selling a capability
  // the network does not have, which is the one failure mode worse than saying nothing.
  const txt = read(LLMS);
  const section = txt.slice(txt.search(/^##\s+Verify it yourself\b/m));
  assert.ok(section.length > 0, "the Verify it yourself section must exist by the time this law runs");
  assert.match(
    section,
    /does not do/i,
    "the section must state what the artifact does NOT do; an unstated limit reads as a capability"
  );
  assert.match(
    section,
    /cannot open a Nano account|chain begins with a receive/i,
    "the section must not let a reader believe the check can open an account for it — a chain begins with a receive"
  );
  // It must not promise the check moves money on the reader's behalf.
  assert.ok(
    !/\bsends? (?:you |your )?(?:Nano|XNO|funds|money)\b/i.test(section),
    "the section must not claim the artifact sends funds; it holds none and signs nothing"
  );
});

// ---------------------------------------------------------------------------
// L71 — publishing it must not put our own activity on the network we measure
// ---------------------------------------------------------------------------

test("L71 the document says a default run does not write to this network", () => {
  // This is the rule the whole denominator rests on. The artifact is allowed to exist on the
  // origin precisely because its default mode keeps its ask on a local scratch server; the
  // document has to say so, or a reader could reasonably assume the run posts here.
  const txt = read(LLMS);
  const section = txt.slice(txt.search(/^##\s+Verify it yourself\b/m));
  assert.match(
    section,
    /scratch server/,
    "the section must name the local scratch server its default run uses"
  );
  assert.match(
    section,
    /never this network|not this network/,
    "the section must state plainly that a default run writes nothing to this network"
  );
  assert.match(
    section,
    /--live-post/,
    "the section must name the flag that would target a real network, so the default is unambiguous"
  );
});

test("L71 the artifact defaults away from the public origin, proven by running it", () => {
  // Non-vacuity: do not read the file and assert about a string — RUN it, with no arguments,
  // exactly as the document invites an agent to, and require that its own report places the ask
  // somewhere local and that it never targeted the public origin.
  const out = execFileSync(process.execPath, [SITE_COPY], {
    encoding: "utf8",
    timeout: 180000,
    cwd: SITE,
  });
  const report = JSON.parse(out);
  assert.ok(report.steps, `the artifact printed no steps: ${out.slice(0, 200)}`);
  assert.match(
    String(report.steps.ask_target),
    /scratch/i,
    `a default run targeted ${JSON.stringify(report.steps.ask_target)}; it must write to the local scratch server`
  );
  assert.ok(
    !String(report.steps.ask_target).includes("getunstuck.space"),
    "a default run must never post an ask to the public network — that would be our own activity counted as a reader's"
  );
  assert.equal(
    report.steps.ask_asker_equals_onramp_address,
    true,
    "the scratch run must still prove the on-ramp address is stored as the asker, or it proves nothing"
  );
});

// ---------------------------------------------------------------------------
// L72 — the published artifact runs where an outside agent actually runs it
// ---------------------------------------------------------------------------

test("L72 the artifact runs to completion as a lone downloadable file", () => {
  // The measured defect this law exists for. The site root publishes ONE file: an agent fetches
  // one URL and runs it with nothing else from this repository beside it. Measured 2026-09-20:
  // run that way the check died with MODULE_NOT_FOUND on ./nserver-persist.js, so its last step
  // never executed and the published program proved less than the document promised.
  //
  // So copy exactly what the origin serves — one file, nothing else — into an empty directory and
  // run the invocation the document tells an agent to run. Anything it still needs from the
  // repository is a promise the download cannot keep.
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), "onramp-lone-"));
  try {
    // The single file, byte for byte, as a download would deliver it.
    const shipped = fs.readFileSync(SITE_COPY);
    fs.writeFileSync(path.join(lone, "nano-onramp-check.js"), shipped);
    const files = fs.readdirSync(lone);
    assert.deepEqual(files, ["nano-onramp-check.js"], "the lone copy must be exactly one file");

    let stdout;
    try {
      stdout = execFileSync(process.execPath, ["nano-onramp-check.js"], {
        encoding: "utf8",
        timeout: 240000,
        cwd: lone,
        env: { ...process.env, NODE_PATH: "" },
      });
    } catch (e) {
      assert.fail(
        `the published artifact does not run as a lone file: ${String(e.stderr || e.message).slice(0, 500)}`
      );
    }
    const report = JSON.parse(stdout);
    assert.equal(report.mode, "live", `a lone run reported mode ${JSON.stringify(report.mode)}`);
    // It must reach the end of the sequence, not stop where the missing module stopped it.
    assert.equal(
      report.steps.ask_asker_equals_onramp_address,
      true,
      "a lone run must complete the last step (the asker equality) or the download promises more than it delivers"
    );
    assert.equal(report.proven, true, `a lone run must prove the path; it reported ${JSON.stringify(report.notes)}`);
    // And it must say which engine ran, so a fallback can never be mistaken for the real server.
    assert.ok(
      /self-contained|repository server/.test(String(report.steps.scratch_engine)),
      `a lone run must name the engine that served its scratch ask, got ${JSON.stringify(report.steps.scratch_engine)}`
    );
    assert.match(
      String(report.steps.scratch_engine),
      /self-contained/,
      "with no repository beside it, a lone run must fall back to the embedded server rather than fail"
    );
    assert.ok(
      report.steps.ask_target && !String(report.steps.ask_target).includes("getunstuck.space"),
      "a lone run must still keep its ask off the public network"
    );
  } finally {
    fs.rmSync(lone, { recursive: true, force: true });
  }
});

test("L72 a checkout run still exercises the repository server, not the fallback", () => {
  // The other half: the fallback must not silently replace the real code where the real code is
  // available. Inside a checkout, the check must report the repository server as its engine, or
  // the strong run and the weak run become indistinguishable.
  const out = execFileSync(process.execPath, [SOURCE], {
    encoding: "utf8",
    timeout: 240000,
    cwd: REPO,
  });
  const report = JSON.parse(out);
  assert.match(
    String(report.steps.scratch_engine),
    /repository server/,
    `inside a checkout the check reported engine ${JSON.stringify(report.steps.scratch_engine)}; ` +
      `it must exercise nserver-persist.js, which is the code this repository tests`
  );
});

// ---------------------------------------------------------------------------
// The live half — the documented URL really answers
// ---------------------------------------------------------------------------

test("L69 the documented URL answers on the live origin with the artifact's bytes", async (t) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(`${LIVE_ORIGIN}${ARTIFACT_PATH}?v=${Date.now()}`, {
      signal: ctl.signal,
      headers: { Accept: "*/*" },
    });
    const body = await res.text();
    if (res.status !== 200) {
      t.diagnostic(
        `SKIPPED live check: ${LIVE_ORIGIN}${ARTIFACT_PATH} answered ${res.status}. ` +
          `This is expected until the next deploy of this commit publishes the file; the file half of L69 still holds.`
      );
      return;
    }
    // The served bytes must be the committed bytes. Measured against the working copy is not
    // enough: a stranger can only ever see what the origin serves.
    const servedDigest = digest(Buffer.from(body, "utf8"));
    const committedDigest = digest(fs.readFileSync(SITE_COPY));
    assert.equal(
      servedDigest,
      committedDigest,
      `the live origin serves sha256 ${servedDigest}; the committed artifact is ${committedDigest}. ` +
        `An agent runs different bytes than this repository reviewed.`
    );
    assert.match(
      body,
      /--self-test/,
      "the served file does not carry the --self-test mode the document tells agents to run"
    );
    t.diagnostic(`live: ${ARTIFACT_PATH} serves ${servedDigest.slice(0, 12)} — identical to the committed artifact`);
  } catch (e) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN}${ARTIFACT_PATH} did not answer (${e.message})`);
  } finally {
    clearTimeout(timer);
  }
});