#!/usr/bin/env python3
"""send-mail-primitive.py — send one email through Primitive's /v1/send-mail as the swarm's account.

The Python port of the opener/reply-sara-*.js pattern, for the reason that class of script keeps failing:
the subject or the body carrying `$`, backticks or `=` is expanded or truncated by a shell. Here the body
comes from a FILE and goes straight into the JSON with json.dumps — no shell ever touches it.

The key is read from /root/.unstuck/primitive.env (mode 600) and is never printed. Recipients are subject
to Primitive's domain allow-list (403 recipient_not_allowed is a measured delivery blocker, not a delivered
message; inkboxmail.com is allowed as of 2026-09-20).

  python3 opener/send-mail-primitive.py --to ADDR --subject '...' --file body.txt [--dry-run]
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

ENV_FILE = "/root/.unstuck/primitive.env"


def env():
    out = {}
    try:
        for line in open(ENV_FILE, encoding="utf-8"):
            m = line.strip().split("=", 1)
            if len(m) == 2:
                out[m[0]] = m[1].strip().strip('"')
    except OSError:
        pass
    for k in ("PRIMITIVE_API_KEY", "PRIMITIVE_AGENT_ADDRESS"):
        if k in os.environ:
            out[k] = os.environ[k]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--file", required=True)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    e = env()
    if not e.get("PRIMITIVE_API_KEY") or not e.get("PRIMITIVE_AGENT_ADDRESS"):
        sys.exit(f"missing PRIMITIVE_API_KEY / PRIMITIVE_AGENT_ADDRESS (looked in {ENV_FILE})")
    body = open(a.file, encoding="utf-8").read()
    payload = {
        "to": a.to,
        "subject": a.subject,
        "body_text": body,
        "from": "unstuck@" + e["PRIMITIVE_AGENT_ADDRESS"],
    }
    if a.dry_run:
        print(f"[dry-run] to={a.to} from={payload['from']} bytes={len(body)} subject={a.subject[:60]!r}")
        return 0
    req = urllib.request.Request(
        "https://api.primitive.dev/v1/send-mail", method="POST",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + e["PRIMITIVE_API_KEY"],
                 "Content-Type": "application/json",
                 "Content-Length": str(len(json.dumps(payload).encode())),
                 "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read() or b"{}")
            print("SENT", r.status, json.dumps(d)[:300])
            return 0
    except urllib.error.HTTPError as ex:
        print("FAILED", ex.code, ex.read().decode()[:300])
        return 1


if __name__ == "__main__":
    sys.exit(main())
