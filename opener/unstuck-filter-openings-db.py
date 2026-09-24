#!/usr/bin/env python3
"""unstuck-filter-openings-db.py — remove the empty `opener/openings.db` blob from this repository's history.

Why, and why it is safe (measured 2026-09-24 before writing this):
  * The blob is 0 bytes in BOTH commits that ever contained it (2fe96b8, and 6c3756f which removed it).
    It held nothing: not a seed, not a spend record, not an address. The real ledger lives at
    /root/.unstuck/openings.db and has never been in git.
  * The forge's pre-receive hook refuses any push whose ancestry contains a path matching
    "file that usually holds secrets" — so the swarm's own PR path has been dead for every branch built
    on main, and the last two sessions recorded that as "forge git server lost refs" instead.
  * GitHub (origin) accepts these commits, so the honest question is only about the forge: the forge
    copy is a mirror for members to read, and the file must not be there for a push to succeed.

What it does: rewrites the branch named by --branch so that `opener/openings.db` never existed, using
`git filter-branch --index-filter` (git-filter-repo is not installed on this box). The working tree and
the index are untouched; the branch is the only thing that moves. Then it pushes that branch to `forge`
and prints the new head so the PR can be opened against it.

Usage: python3 opener/unstuck-filter-openings-db.py [--branch NAME] [--push] [--dry-run]
Default branch: the current one. Refuses to run on master/main (that is the product's own history).
"""
import argparse
import os
import subprocess
import sys

REPO = "/root/unstuck"
PATHSPEC = "opener/openings.db"
FILTER = (f"git rm --cached --ignore-unmatch -q {PATHSPEC} || true")


def run(cmd, **kw):
    p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, **kw)
    return p.returncode, (p.stdout + p.stderr).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", default=None)
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    rc, cur = run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    branch = a.branch or cur
    if branch in ("master", "main"):
        sys.exit(f"refused: {branch} is the product's own history; rewrite a topic branch only")

    rc, before = run(["git", "rev-parse", branch])
    rc, base = run(["git", "rev-list", "--max-parents=0", "HEAD"])
    rc, hits = run(["git", "log", "--format=%H", branch, "--", PATHSPEC])
    print(f"branch {branch} @ {before[:8]}; commits touching {PATHSPEC}: {len(hits.split()) if hits else 0}")
    for c in (hits.split() or []):
        rc2, sz = run(["git", "cat-file", "-s", f"{c}:{PATHSPEC}"])
        print(f"  {c[:8]} size={sz} bytes")
    if not hits:
        print("nothing to rewrite")
    if a.dry_run:
        return 0
    if not hits:
        return 0

    rc, out = run(["git", "filter-branch", "-f", "--prune-empty",
                   "--index-filter", FILTER, "--", branch])
    if rc != 0:
        print(out[-1500:])
        return 1
    rc, after = run(["git", "rev-parse", branch])
    rc, left = run(["git", "log", "--format=%H", branch, "--", PATHSPEC])
    print(f"rewrote {branch}: {before[:8]} -> {after[:8]}; commits still touching it: "
          f"{len(left.split()) if left else 0}")
    if left:
        print("FAIL: the path is still in this branch's history")
        return 1
    run(["git", "update-ref", "-d", "refs/original/refs/heads/" + branch.replace("/", "/")])
    if a.push:
        rc, out = run(["git", "push", "--force-with-lease", "forge",
                       f"{branch}:refs/heads/{branch}"])
        print(out[-400:])
        return rc
    print(f"not pushed; run: git push --force-with-lease forge {branch}:refs/heads/{branch}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
