#!/usr/bin/env python3
"""read-primitive-email.py — fetch one inbound Primitive email body by message id.

Replaces opener/read-primitive-email.js, which had its bearer redacted to `***` in the source (so it could
never fetch) and shelled out the id through curl. This reads the key from /root/.unstuck/primitive.env,
never prints it, and takes the id as an argv value (no shell, no quoting).

Usage: python3 opener/read-primitive-email.py <message-id> [--limit N]
       python3 opener/read-primitive-email.py --list [--limit N]
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENV_FILE = "/root/.unstuck/primitive.env"
BASE = "https://api.primitive.dev/v1"


def key():
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            m = line.strip().split("=", 1)
            if len(m) == 2 and m[0] == "PRIMITIVE_API_KEY":
                return m[1].strip().strip('"')
    except OSError:
        pass
    return os.environ.get("PRIMITIVE_API_KEY", "").strip()


def get(path):
    k = key()
    if not k:
        sys.exit(f"no PRIMITIVE_API_KEY (looked in {ENV_FILE} and the environment)")
    req = urllib.request.Request(BASE + path, headers={
        "Authorization": "Bearer " + k, "Accept": "application/json", "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("msg_id", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--limit", type=int, default=10)
    a = ap.parse_args()

    if a.list or not a.msg_id:
        st, d = get(f"/emails?limit={a.limit}")
        rows = (d.get("data") or d.get("messages") or []) if isinstance(d, dict) else []
        print(f"HTTP {st}; {len(rows)} row(s)")
        for m in rows:
            print(" ", (m.get("id") or ""), (m.get("from_header") or m.get("from_email") or "?")[:36],
                  "|", (m.get("subject") or "")[:70])
        return 0

    st, d = get(f"/emails/{a.msg_id}")
    msg = (d.get("data") or d) if isinstance(d, dict) else {}
    if st != 200:
        print(f"HTTP {st}: {json.dumps(d)[:300]}")
        return 1
    print("subject:", msg.get("subject", ""))
    print("from:", msg.get("from_header") or msg.get("from_email") or "")
    print("to:", msg.get("to_email") or "")
    print("--- body_text ---")
    print((msg.get("body_text") or "")[:4000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
