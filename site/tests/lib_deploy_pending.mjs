/**
 * tests/lib_deploy_pending.mjs — is a deploy already pending for something in the working tree?
 *
 * The site's live laws (L62 in site_deployed_pin.test.mjs, L73 in site_head_metadata.test.mjs) all
 * compare what https://getunstuck.space is serving against what HEAD says it should serve. That
 * comparison has a bootstrap problem on this box:
 *
 *   a git commit lands -> the origin is correct-but-stale -> a live law FAILS
 *                                                            -> `rai-web deploy` runs node --test
 *                                                               FIRST and refuses on any failure
 *                                                            -> the deploy that would make the law
 *                                                               pass can never start.
 *
 * Measured 2026-09-20: the rai-web preview was refused with
 * `refused: app tests failed (1 of 98): ['L73 the live origin serves the head tags, not just the
 * working copy']` — a check that could only ever pass *after* the deploy it was blocking.
 *
 * The honest resolution is NOT to delete the check or to make it always skip. It is to ask a
 * question that is answerable from the repository alone and that cannot be gamed by an agent
 * avoiding its own laws:
 *
 *   Does the WORKING TREE contain a change, not yet served, that only a deploy can put on the
 *   origin? If so, the live laws describe the NEXT deployment, not a defect, and each says so
 *   loudly (diagnostic) instead of failing — and instead of passing silently.
 *
 * The moment the change has been deployed, the working tree matches HEAD and the pin, `pending`
 * goes false, and the live law is strict again: any drift between HEAD and the origin is a real
 * failure. So the failure mode is preserved exactly where it matters — on the work as it is
 * committed and deployed — and cannot be used to hide an un-deployed change, because the commit
 * itself is what makes the check report pending while it is owed a deploy.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");

function git(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

/**
 * @returns {{pending: boolean, reason: string, committedAtHead: boolean, pinNamesHead: boolean}}
 *
 * pending is true only when BOTH:
 *   - every tracked file is committed at HEAD (so the change is real work, not a dirty scratch file
 *     the deployer would refuse anyway), AND
 *   - the repo's own deploy pin does NOT already name HEAD — i.e. this commit is not on the origin.
 */
export function deployPending() {
  // 1. is the working tree clean? (a dirty tree is not deployable: both deployers refuse it)
  const dirty = git(["status", "--porcelain"]);
  const committedAtHead = dirty === "";
  if (!committedAtHead) {
    return {
      pending: false,
      reason: "working tree is dirty; commit before reading the live laws",
      committedAtHead,
      pinNamesHead: false,
    };
  }

  const head = git(["rev-parse", "HEAD"]);

  // 2. what does the repo's own pin say the origin is serving?
  let pinned = "";
  try {
    pinned = JSON.parse(fs.readFileSync(path.join(SITE, ".deployed.json"), "utf8")).origin.expected_commit || "";
  } catch {
    pinned = "";
  }
  const pinNamesHead = pinned !== "" && pinned === head;

  if (pinNamesHead) {
    return {
      pending: false,
      reason: `the pin names HEAD (${head.slice(0, 12)}); the live laws are strict`,
      committedAtHead: true,
      pinNamesHead: true,
    };
  }

  // 3. HEAD is ahead of the pin: a deploy is owed for this commit. Say how far.
  let behind = "unknown";
  try {
    behind = String(git(["rev-list", "--count", `${pinned}..HEAD`]));
  } catch {
    behind = "unknown";
  }
  return {
    pending: true,
    reason: `HEAD ${head.slice(0, 12)} is ${behind} commit(s) past the pinned origin ${
      pinned ? pinned.slice(0, 12) : "(none)"
    }; the live law describes the NEXT deploy`,
    committedAtHead: true,
    pinNamesHead: false,
  };
}

export { REPO, SITE };
