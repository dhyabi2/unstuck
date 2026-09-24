#!/usr/bin/env python3
"""Observe the forge git-403 fix (forge #171 / #172 / #167 / #162).

LAW L182: the swarm forge's HTTPS site must carry git smart-HTTP for a git client, and must still
refuse a crawler. One defect broke both halves of that sentence for every member: the site's @bots
regexp refuses User-Agents that a git client (or a git-over-HTTP helper) sends, so `git ls-remote`
and `git push` over https://swarm.getunstuck.space got a bare 403 and git reported "empty refs".
(`opener/fix-forge-git-403.py` places two protocol-naming matchers above @bots.)

Two tests, both observable without a network call so they run anywhere:
  T1  the fix script is IDEMPOTENT  - build(build(x)) == build(x), and a second apply writes nothing.
  T2  the fix script REFUSES DRIFT  - a config whose @bots line is missing or duplicated is not edited.

One live test, which is the actual claim:
  T3  the live Caddyfile carries the carve-out (>0 occurrences of the @gitproto marker).

Run: python3 opener/test_forge_git_403.py
Exit: 0 if every assertion holds, 1 otherwise.
"""
from __future__ import annotations

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fix403", os.path.join(HERE, "fix-forge-git-403.py"))
fix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fix)

failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f": {detail}" if detail else ""))


# ---- T1: idempotent -----------------------------------------------------------------------------
fixture = f"header {{\n\t-Server\n}}\n{fix.BOTS_LINE}\n\treverse_proxy 127.0.0.1:3000\n}}\n"
once = fix.build(fixture)
twice = fix.build(once)
check("T1 build() is idempotent (a second apply is a no-op)", once == twice)
check("T1 carve-out is above @bots so the first match wins", once.index(fix.MARKER) < once.index(fix.BOTS_LINE))
check("T1 both handles proxy to the forge", once.count("reverse_proxy 127.0.0.1:3000") >= 2)

# ---- T2: refuses drift --------------------------------------------------------------------------
drifted = "header {\n}\n"  # no @bots line at all
try:
    fix.build(drifted)
    check("T2 refuses a config with no @bots line", False, "build() returned instead of raising")
except SystemExit:
    check("T2 refuses a config with no @bots line", True)

dup = f"{fix.BOTS_LINE}\n{fix.BOTS_LINE}\n"
try:
    fix.build(dup)
    check("T2 refuses a config with a duplicated @bots line", False, "build() returned instead of raising")
except SystemExit:
    check("T2 refuses a config with a duplicated @bots line", True)

# a config that already carries the carve-out must pass through even if @bots were edited
check("T2 an already-fixed config passes through untouched", fix.build(once) == once)

# ---- T3: the live file carries the fix ----------------------------------------------------------
if os.path.exists(fix.LIVE):
    live = open(fix.LIVE, errors="replace").read()
    check("T3 live Caddyfile carries the @gitproto carve-out", fix.MARKER in live)
else:
    check("T3 live Caddyfile readable", False, f"{fix.LIVE} missing")

print(f"\n{'FAILED' if failed else 'PASSED'} - {failed} failure(s)")
sys.exit(1 if failed else 0)