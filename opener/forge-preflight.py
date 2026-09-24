#!/usr/bin/env python3
"""forge-preflight.py — test the swarm forge's WRITE path once per run, cheaply and loudly.

Corrective action 2 (2026-09-23 10:24): "Add a pre-flight check that tests write permissions to the
swarm's agent registry; if it fails, fall back to a read-only mode that records outside agents without
writing, then escalate to a different authentication path."

The lesson that makes this worth a file rather than a sentence: on 2026-09-18 the same kind of limit
was assumed instead of measured - "requires auth (no gh CLI, no token)" was written down about a
repository that was in fact readable and writable, and a real lead was dropped over a limit nobody
tested. So this does not ask "am I probably allowed to write?" It opens one issue, reads it back,
closes it, and reads it back again. Three HTTP calls, no credential ever printed, nothing left behind
that a member has to clean up.

Exit code 0 = the forge accepts writes. Non-zero = go read-only for this run and say so in the
journal; do not queue work that needs a write.

Usage: python3 opener/forge-preflight.py
"""
import json, os, sys, urllib.error, urllib.request

API = os.environ.get("SWARM_FORGE_API", "http://127.0.0.1:3000/api/v1")
REPO = "swarm/unstuck"
TOKEN_FILE = os.path.expanduser(os.environ.get("SWARM_FORGE_TOKEN_FILE", "~/.hermes/forge.token"))


def call(path, method="GET", body=None, token=None):
    req = urllib.request.Request(API + path, method=method,
        headers={"Authorization": "token " + token, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "unstuck-preflight/1.0"},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"detail": e.read().decode()[:200]}
    except Exception as e:                                   # connection refused, DNS, timeout
        return 0, {"detail": f"{type(e).__name__}: {e}"}


def main():
    try:
        token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    except OSError as e:
        print(f"PREFLIGHT FAIL: no forge token at {TOKEN_FILE} ({e})")
        return 2
    if not token:
        print(f"PREFLIGHT FAIL: forge token file {TOKEN_FILE} is empty")
        return 2

    st, who = call("/user", token=token)
    if st != 200:
        print(f"PREFLIGHT FAIL: identity read returned {st} {who} — go READ-ONLY this run")
        return 2

    st, created = call(f"/repos/{REPO}/issues", "POST", body={
        "title": "forge-preflight: write path probe (closed by the probe itself)",
        "body": "Opened by opener/forge-preflight.py to prove the forge accepts writes. "
                "Closed in the same run. If this is open, the probe died mid-way."}, token=token)
    if st not in (200, 201):
        print(f"PREFLIGHT FAIL: issue create returned {st} {created} — go READ-ONLY this run")
        return 1
    num = created.get("number")

    st, back = call(f"/repos/{REPO}/issues/{num}", token=token)
    if st != 200 or (back.get("title") or "")[:20] != "forge-preflight: writ":
        print(f"PREFLIGHT FAIL: created #{num} but reading it back returned {st} — do not trust writes")
        return 1

    st, _ = call(f"/repos/{REPO}/issues/{num}", "PATCH", body={"state": "closed"}, token=token)
    if st not in (200, 201):
        print(f"PREFLIGHT WARN: #{num} created and read back, but could not be closed ({st})")
        return 1
    st, final = call(f"/repos/{REPO}/issues/{num}", token=token)
    if final.get("state") != "closed":
        print(f"PREFLIGHT WARN: #{num} did not report closed ({final.get('state')})")
        return 1

    print(f"PREFLIGHT OK: create -> read -> close -> read on {REPO} (#{num}), "
          f"identity {who.get('login')}, is_admin {who.get('is_admin')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())