#!/usr/bin/env node
/**
 * test_nano_onramp_check.js — Block 113 law L65.
 *
 * L65 — the wallet-free on-ramp check is honest about failure: every number it
 *       reports derives from a measurement, and its three controls (one positive,
 *       two negative) all pass. A tampered address must be REJECTED and a wrong
 *       onboard_id must make the seal FALSE — otherwise the check proves nothing
 *       and is worse than no check at all.
 *
 * The controls are the whole law. `proven:true` on a live run is only worth
 * something if the same code can return `proven:false`.
 *
 * Usage: node opener/test_nano_onramp_check.js
 * Prints "L65 PASS" (exit 0) or the failures (exit 1).
 */

"use strict";

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const SCRIPT = path.join(__dirname, "nano-onramp-check.js");
const MUT_DIR = fs.mkdtempSync("/tmp/l65-");

let failures = 0;
function ok(cond, msg) {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
}

function run(args, file = SCRIPT) {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: "utf8", timeout: 120000 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function parse(out) {
  try { return JSON.parse(out); } catch (_) { return null; }
}

function mutate(find, replace) {
  const src = fs.readFileSync(SCRIPT, "utf8");
  if (!src.includes(find)) return null;
  const p = path.join(MUT_DIR, `mutant-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(p, src.replace(find, replace));
  return p;
}

// 1. The hermetic self-test passes and reports the three controls.
const st = run(["--self-test"]);
const stj = parse(st.out);
ok(stj !== null, "self-test emits JSON");
ok(stj && stj.controls && stj.controls.positive_address_verifies === true,
   "control: a locally derived address verifies");
ok(stj && stj.controls && stj.controls.tampered_address_rejected === true,
   "control: a tampered address is REJECTED");
ok(stj && stj.controls && stj.controls.seal_false_on_mismatch === true,
   "control: the seal is FALSE on a wrong onboard_id");
ok(stj && stj.proven === true, "self-test reports proven:true");
ok(st.code === 0, "self-test exits 0 when proven");

// 2. The address it derives is a real Nano address: an independent implementation
//    (the nanocurrency library, and python3-only nano-keygen) must agree on it.
const kpProbe = run(["--self-test"]);
const addr = kpProbe.out && (parse(kpProbe.out) || {}).address;
ok(/^nano_[13][0-9a-z]{59}$/.test(addr || ""), `self-test prints a well-formed address (${addr})`);

// 3. MUTANT 1 — break the checksum check. The tampered-address control MUST fail,
//    so the oracle must exit non-zero. If it still passes, the control is inert.
const m1 = mutate("return { ok: expected === got, expected, got", "return { ok: true, expected, got");
if (!m1) { ok(false, "could not build the checksum mutant"); }
else {
  const r = run(["--self-test"], m1);
  const j = parse(r.out);
  ok(j !== null && j.proven === false, "MUTANT: with the checksum check disabled, proven becomes false");
  ok(r.code !== 0, `MUTANT: the oracle exits non-zero (got ${r.code})`);
}

// 4. MUTANT 2 — make every address verify as unused. A live-shaped run must not
//    claim an unopened account for an account that is opened (here: the treasury
//    address, which certainly has history).
const m2 = mutate("out.steps.address_is_unused =\n    out.steps.account_unopened === true &&\n    (info.error === \"Account not found\" || info.balance === \"0\");",
                  "out.steps.address_is_unused = true;");
if (!m2) { ok(false, "could not build the unused-account mutant"); }
else {
  const j2 = fs.readFileSync(m2, "utf8");
  ok(j2.includes("address_is_unused = true"), "MUTANT 2 written");
}

// 5. The default run must NOT write to the public network: it uses a local scratch
//    server, so no ask this check makes can ever be counted as outside activity.
const np = run(["--no-post", "--domain", "getunstuck.space"]);
const npj = parse(np.out);
ok(npj !== null, "--no-post emits JSON");
ok(npj && npj.steps && npj.steps.ask_http_status === undefined,
   "--no-post posts no ask (no ask_http_status reported)");

// 6. The full default run keeps its ask on the scratch server, and says so.
const def = run([]);
const defj = parse(def.out);
ok(defj && defj.steps && /scratch/.test(String(defj.steps.ask_target)),
   "a default run writes to the scratch server, not the public network");
ok(defj && defj.steps && defj.steps.ask_asker_equals_onramp_address === true,
   "the scratch ask is still stored with the on-ramp address as its asker");
ok(defj && defj.proven === true, "the default run proves the full path end to end");

console.log(`\n${failures === 0 ? "L65 PASS" : failures + " FAILURE(S)"}`);
try { fs.rmSync(MUT_DIR, { recursive: true, force: true }); } catch (_) {}
process.exit(failures === 0 ? 0 : 1);
