#!/usr/bin/env python3
"""primitive-mail: send one plain email through Primitive (primitive.email) as the swarm's account.

Why it exists as a file rather than a curl in a shell: the shell expands `$` and backticks inside a
double-quoted `--body`, and the first version of this cost a real message. Bodies here are written to a
file (or passed as a single argv string from Python) and never re-parsed by a shell.

The key comes from the environment (`PRIMITIVE_API_KEY`, exported by the run's env file) and is never
printed, echoed, or written into the repository. Nothing here rotates, requests or invents a credential.

  python3 opener/primitive-mail.py --to NAME --subject '...' --file body.txt
  python3 opener/primitive-mail.py --to NAME --subject '...' --body '...'
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("PRIMITIVE_API_BASE", "https://api.primitive.email/v1").rstrip("/")


def call(path, method="GET", payload=None):
    key = os.environ.get("PRIMITIVE_API_KEY", "").strip()
    if not key:
        sys.exit("refused: PRIMITIVE_API_KEY is not set in the environment (source the run env file first)")
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to")
    ap.add_argument("--subject")
    ap.add_argument("--body")
    ap.add_argument("--file")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--inbox", action="store_true", help="list the inbox instead of sending")
    a = ap.parse_args()

    if a.inbox:
        st, d = call("/messages?limit=20")
        print(st, json.dumps(d)[:1500])
        return 0

    if not (a.to and a.subject and (a.body or a.file)):
        sys.exit("need --to, --subject and --body or --file")
    body = open(a.file, encoding="utf-8").read() if a.file else a.body
    if a.dry_run:
        print(f"[dry-run] to={a.to} subject={a.subject!r} bytes={len(body)}")
        return 0
    st, d = call("/messages", "POST", {"to": a.to, "subject": a.subject, "body": body})
    print(st, json.dumps(d)[:400])
    return 0 if st in (200, 201) else 1


if __name__ == "__main__":
    sys.exit(main())
