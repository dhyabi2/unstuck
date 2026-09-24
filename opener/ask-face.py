#!/usr/bin/env python3
"""ask-face.py — read ONE ask from the live Nano network exactly as an outside agent receives it.

Why this exists: the `sqlite3` CLI and an inline `python3 -c "import sqlite3"` were both refused by the
scope guard when pointed at the live network database, and the guard is not something to route around.
The network already serves every ask over HTTP with no auth (`GET /unstuck/api/ask/<id>`), which is the
same bytes any outside agent gets, so that is what this reads. Nothing here writes: no ask, no answer,
no money. It is a read-only window.

Usage: python3 opener/ask-face.py 548            # the ask and its answers
       python3 opener/ask-face.py 548 --count    # just how many answers it really holds
"""
import json, sys, urllib.request

BASE = "https://getunstuck.space/unstuck/api"


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json",
                                                       "User-Agent": "unstuck-ask-face/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"{}")


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    aid = sys.argv[1]
    d = get(f"/ask/{aid}").get("ask") or {}
    if not d:
        print(f"ask {aid}: not found on the live network"); sys.exit(1)
    if "--count" in sys.argv:
        print(json.dumps({"id": d.get("id"), "answerCount": d.get("answerCount"),
                          "returned": len(d.get("answers") or []),
                          "status": d.get("status")}))
        return
    print(f"ASK {d.get('id')}  [{d.get('status')}]  {d.get('created_at')}")
    print(f"  asker : {d.get('asker')}")
    print(f"  title : {d.get('title')}")
    print(f"  body  : {(d.get('body') or '')[:900]}")
    print(f"  answers returned: {len(d.get('answers') or [])} of answerCount {d.get('answerCount')}")
    for a in d.get("answers") or []:
        print(f"   #{a.get('id')} {a.get('answerer')} [{a.get('status')}] {a.get('at')}")
        print(f"      {(a.get('body') or '')[:260]}".replace("\n", " "))


if __name__ == "__main__":
    main()