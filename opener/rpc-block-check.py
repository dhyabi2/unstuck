#!/usr/bin/env python3
"""rpc-block-check.py — ask the Nano node whether a block hash really exists, without printing any key.

Usage:
  node opener/rpc-block-check.js --probe   # from the shell, run the JS twin below
  python3 opener/rpc-block-check.py <block-hash> [...]     # uses urllib; rpc.nano.to rejects urllib's UA
                                                           # with 403 and accepts a JSON client (see notes)

The node key is read from /root/.hermes/.env (NANO_RPC_KEY) and placed only into the HTTP
Authorization header. It is never printed, logged or echoed.

Measured 2026-09-20: rpc.nano.to answers 403 to python-urllib for every request, and answers an
unauthenticated `block_info` fine from a JS fetch client. So the authoritative probe is
`node opener/rpc-block-check.js <hash>`; this Python version records the 403 as UNQUERIED rather
than guessing a verdict.
"""
import json
import os
import sys
import urllib.request

RPC = "https://rpc.nano.to"
ENV = "/root/.hermes/.env"


def key():
    if os.environ.get("NANO_RPC_KEY"):
        return os.environ["NANO_RPC_KEY"]
    try:
        for line in open(ENV, encoding="utf-8", errors="ignore"):
            if line.startswith("NANO_RPC_KEY="):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    except OSError:
        pass
    return ""


def block_info(block_hash, k):
    body = json.dumps({"action": "block_info", "hash": block_hash, "json_block": "true"}).encode()
    headers = {"Content-Type": "application/json"}
    if k:
        headers["Authorization"] = k
    req = urllib.request.Request(RPC, data=body, headers=headers)
    try:
        d = json.load(urllib.request.urlopen(req, timeout=25))
    except Exception as e:  # noqa: BLE001
        return {"hash": block_hash, "queried": False, "error": str(e)}
    if "error" in d:
        return {"hash": block_hash, "queried": True, "exists": False, "error": d["error"]}
    return {"hash": block_hash, "queried": True, "exists": True, "subtype": d.get("subtype"),
            "confirmed": d.get("confirmed"), "amount": d.get("amount")}


def main():
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    k = key()
    out = [block_info(h, k) for h in args]
    if as_json:
        print(json.dumps(out, indent=1))
    else:
        for r in out:
            if r.get("exists"):
                print(f"{r['hash'][:16]}…  EXISTS  subtype={r.get('subtype')} confirmed={r.get('confirmed')} amount={r.get('amount')}")
            elif r.get("queried"):
                print(f"{r['hash'][:16]}…  NOT A BLOCK  ({r.get('error')})")
            else:
                print(f"{r['hash'][:16]}…  UNQUERIED  ({r.get('error')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())