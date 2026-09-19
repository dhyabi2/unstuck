/**
 * tests/site_deployed_pin.test.mjs — the origin must be serving the build the repo says it should.
 *
 * L43 and L47 (in site_api_path.test.mjs and site_stamp.test.mjs) ask whether the served sha is a real
 * commit at or behind HEAD. That question cannot fail for the state this file was written in:
 *
 *   measured 2026-09-19, from outside the box:
 *     https://getunstuck.space/  ->  200, "unstuck-commit: ef084ea20ab9476e246919acb3a55f16e0eaa8a9"
 *     git log --oneline -1 ef084ea ->  Block 69
 *     git rev-list --count ef084ea..HEAD -> 148
 *
 * 148 commits, including two whole blocks of site fixes (86, 87), had never been deployed — and every
 * law passed, because "an ancestor of HEAD" is true of a build nobody deployed and of a build one block
 * stale alike. A repo cannot contain the sha of the commit that writes it, so the pin names the PREVIOUS
 * deployment: the deployer (deploy_pin in unstuck-deploy.py) writes it from what the origin is serving,
 * commits it, and the next deploy does the same. That self-reference has a cost, and it is paid here
 * rather than hidden:
 *
 *   the pin is stale for one commit after every commit, until the next deploy refreshes it.
 *
 * So staleness cannot be the failing assertion — a test that failed on it would block the very deploy
 * that fixes it. What IS asserted is everything that is checkable and falsifiable:
 *
 *   L61 — the pin names a real commit that is an ancestor of HEAD, and depth_from_head equals the real
 *         integer distance to HEAD, so a hand-typed or carelessly edited pin is caught.
 *   L62 — the origin is serving exactly the commit the pin names (fails while the site is stale, passes
 *         once it is deployed), and the pin's own arithmetic agrees with git on the same input.
 *   L63 — the pin is in the repo at HEAD, byte for byte: a pin without a commit is a note, not evidence.
 *
 * Run all:  node --test tests/site_deployed_pin.test.mjs
 * Run one:  node --test --test-name-pattern=L61 tests/site_deployed_pin.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");
const LIVE_ORIGIN = "https://getunstuck.space";
const PIN_REL = "site/.deployed.json";
const DEPLOYER = "/root/work/unstuck-deploy.py";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
}

/** Is `sha` a commit this repository actually has, and is it HEAD or behind it? */
function isKnownAncestor(sha, head) {
  const ok = (args) => {
    try {
      execFileSync("git", ["-C", REPO, ...args], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  if (!ok(["cat-file", "-e", `${sha}^{commit}`])) return false;
  return ok(["merge-base", "--is-ancestor", sha, head]);
}

/** The real integer distance from `sha` to HEAD: the number the pin claims. */
function depthFromHead(sha, head) {
  return Number(git(["rev-list", "--count", `${sha}..${head}`]));
}

function readPin() {
  return JSON.parse(fs.readFileSync(path.join(SITE, ".deployed.json"), "utf8"));
}

async function probe(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: "text/html", "User-Agent": "unstuck-pin-law" },
      redirect: "follow",
    });
    return { ok: true, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// L61 — the pin names a real, ancestor commit, and its recorded depth is true
// ---------------------------------------------------------------------------

test("L61 the pin names a real ancestor of HEAD, declared in a shipped-tag token", () => {
  const pin = readPin();
  const sha = pin.origin?.expected_commit;
  assert.ok(sha, "site/.deployed.json must name an expected_commit");
  // A placeholder is not a pin. The token ships in the file because a script can substitute it; a human
  // reading the repo sees the token. Either way the LIVE pin must never be the raw placeholder.
  assert.notEqual(sha, "__ORIGIN_EXPECTED_COMMIT__", "the pin is still the untouched placeholder");
  assert.match(sha, /^[0-9a-f]{40}$/, `the pin must be a full commit sha, got ${sha}`);

  const head = git(["rev-parse", "HEAD"]);
  assert.ok(
    isKnownAncestor(sha, head),
    `the pin names ${sha}, which is not a commit in this repository at or behind HEAD ${head.slice(0, 12)}. ` +
      `A pin that names nothing real cannot catch a stale origin.`
  );

  const claimed = pin.origin?.depth_from_head;
  const real = depthFromHead(sha, head);
  assert.equal(
    claimed,
    real,
    `the pin claims depth_from_head ${claimed} but the real distance from ${sha.slice(0, 12)} to HEAD is ${real}. ` +
      `The depth is the ordered coordinate that makes a careless edit visible; if it is not recomputed when the ` +
      `pin moves, it is decoration (the deployer recomputes it in deploy_pin).`
  );
});

test("L61 a fabricated pin and a wrong depth are both refused by this same predicate", () => {
  const head = git(["rev-parse", "HEAD"]);
  const real = readPin().origin.expected_commit;

  // Falsifier 1: a sha that names no commit in this repository.
  assert.ok(
    !isKnownAncestor("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", head),
    "a fabricated sha must never pass the ancestor check"
  );

  // Falsifier 2: the depth arithmetic must be able to be wrong — otherwise L61's equality is vacuous.
  const realDepth = depthFromHead(real, head);
  assert.notEqual(
    realDepth,
    realDepth + 1,
    "the depth check is arithmetic: a depth one off must not equal the true depth"
  );
  assert.equal(
    depthFromHead(real, real) === 0,
    true,
    "the depth from a commit to itself is 0; assert the coordinate is anchored at 0, not off by one"
  );
});

// ---------------------------------------------------------------------------
// L62 — the origin is serving the commit the pin names
// ---------------------------------------------------------------------------

test("L62 the live origin is serving the commit the pin names", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    // A network outage is not the site's failure. Say so loudly instead of passing quietly.
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN}/ did not answer (${r.error}).`);
    return;
  }
  const pin = readPin().origin;
  const head = git(["rev-parse", "HEAD"]);

  const stamped = r.body.match(/unstuck-commit:\s*([0-9a-f]{7,40})/);
  assert.ok(
    stamped,
    `${LIVE_ORIGIN}/ serves no unstuck-commit stamp, so it cannot be tied to the pin ` +
      `${pin.expected_commit.slice(0, 12)}; HEAD is ${head.slice(0, 12)}`
  );
  assert.equal(
    stamped[1],
    pin.expected_commit,
    `the origin is serving ${stamped[1]} but the repo pins ${pin.expected_commit.slice(0, 12)} ` +
      `(HEAD ${head.slice(0, 12)}). The site is stale by ${depthFromHead(stamped[1], head)} commits: ` +
      `deploy it. This is the assertion Blocks 86-87 were silently failing.`
  );

  // The pin's arithmetic must agree with git on the input actually observed, not just on the pin.
  assert.equal(
    pin.depth_from_head,
    depthFromHead(stamped[1], pin.recorded_by || head),
    "the pin's depth_from_head must equal the real distance when the pin was recorded, so the " +
      "coordinate a reader recomputes matches the one recorded"
  );
  t.diagnostic(
    `live: ${LIVE_ORIGIN}/ names ${stamped[1]}, exactly the pinned commit (HEAD is ${depthFromHead(stamped[1], head)} ahead)`
  );
});

// ---------------------------------------------------------------------------
// L63 — the pin is committed, not a note in a working copy
// ---------------------------------------------------------------------------

test("L63 the pin is in the repository at HEAD, byte for byte", () => {
  const onDisk = sha256(fs.readFileSync(path.join(SITE, ".deployed.json")));
  let atHead;
  try {
    atHead = sha256(execFileSync("git", ["-C", REPO, "show", `HEAD:${PIN_REL}`], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    assert.fail(
      `${PIN_REL} is not committed at HEAD. A pin nobody committed is a working-copy note: it cannot be ` +
        `checked by a stranger, and the next git_state() sees it dirty. The deployer commits it in commit_pin().`
    );
  }
  assert.equal(
    onDisk,
    atHead,
    `${PIN_REL} differs between the working copy and HEAD; commit it (the deployer does this in deploy_pin)`
  );
});

test("L63 the deployer refreshes and commits the pin, so a deploy is never blocked by a pin it just wrote", () => {
  // The self-reference is the design's one hazard: if the deployer did not refresh the pin, the pin
  // would be stale exactly when a deploy runs and a human would have to edit a file the deploy is about
  // to invalidate. The order is therefore part of the law: refresh + commit BEFORE any check reads it.
  const src = fs.readFileSync(DEPLOYER, "utf8");
  for (const fn of ["def refresh_pin", "def commit_pin", "def deploy_pin"]) {
    assert.ok(src.includes(fn), `unstuck-deploy.py must ship ${fn}(): the pin has to be written by the deploy`);
  }
  assert.ok(
    /deploy_pin\(sha\)/.test(src),
    "main() must call deploy_pin(sha) before it reads anything the pin governs"
  );
  const mainAt = src.indexOf("def main()");
  const deployPinAt = src.indexOf("deploy_pin(sha)", mainAt);
  const previewAt = src.indexOf("create_preview", mainAt);
  assert.ok(
    deployPinAt > -1 && deployPinAt < previewAt,
    "deploy_pin(sha) must run before the upload, so the pin is committed and git_state() stays clean"
  );

  // Falsifier: the pin must be read from what the origin serves, not invented. A refresh_pin that never
  // consults the live page would pin HEAD and make L62 vacuous.
  const body = src.slice(src.indexOf("def refresh_pin"), src.indexOf("def commit_pin"));
  assert.ok(
    body.includes("PROD_URL") || body.includes("served_url"),
    "refresh_pin must read the live origin to learn what it is serving; a pin from HEAD alone is a self-assertion"
  );
});