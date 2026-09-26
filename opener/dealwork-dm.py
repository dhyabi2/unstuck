#!/usr/bin/env python3
"""dealwork-dm.py — send a first-contact DM to a dealwork.ai autonomous outside-Nano agent
and record it in the bridge. The platform key stays in opener/dealwork.key (never printed).

Usage: python3 opener/dealwork-dm.py --agent "Arzen" --account <uuid> --msg "..."  [--dry-run]
"""
import json, os, sys, urllib.error, urllib.request

KEY = open("/root/unstuck/opener/dealwork.key").read().strip()
BASE = "https://dealwork.ai/api/v1"
MY = "fbc0967b-1cad-4e0e-b990-afcc366240a7"  # Unstuck Network

def arg(name, defv=None):
    for i, a in enumerate(sys.argv):
        if a == "--" + name and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return defv

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json",
                 "Content-Type": "application/json", "User-Agent": "unstuck/1.0"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(req, data=data, timeout=30)
        return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def main():
    agent = arg("agent"); acct = arg("account"); msg = arg("msg")
    if not (agent and acct and msg):
        print("usage: --agent NAME --account UUID --msg MSG [--dry-run]"); sys.exit(2)
    # A bare --dry-run is a flag, not a key/value pair. arg() only looks for a
    # value, so a valueless --dry-run used to be read as False and the "dry run"
    # actually SENT the message (caused a real duplicate on 2026-09-23).
    dry = ("--dry-run" in sys.argv)
    # find an existing channel with this member, else create one
    st, body = api("GET", "/channels")
    chans = json.loads(body or b"{}").get("data", []) if st == 200 else []
    ch = None
    for c in chans:
        member_ids = (c.get("memberAccountIds") or []) + (c.get("memberIds") or []) + (c.get("members") or [])
        if acct in member_ids:
            ch = c["id"]; break
    if not ch:
        if dry:
            print(f"[dry-run] would create channel to {agent} / {acct}")
        else:
            st, body = api("POST", "/channels", {"type": "direct", "memberAccountIds": [acct]})
            if st != 201:
                print("create channel failed", st, body[:300]); sys.exit(1)
            j = json.loads(body)
            ch = j["id"] if isinstance(j, dict) and "id" in j else j.get("data", {}).get("id")
    if dry:
        print(f"[dry-run] would send to {agent} channel={ch}:\n{msg}")
        return
    st, body = api("POST", f"/channels/{ch}/messages", {"content": msg})
    if st != 201:
        print("send failed", st, body[:300]); sys.exit(1)
    print(json.dumps({"ok": True, "agent": agent, "channel": ch}, default=str))

if __name__ == "__main__":
    main()
