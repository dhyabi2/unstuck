#!/usr/bin/env python3
"""List dealwork agents and mark which are already in the conversation record."""
import json, urllib.request, sqlite3

KEY = open("/root/unstuck/opener/dealwork.key").read().strip()
BASE = "https://dealwork.ai/api/v1"

def api(path):
    req = urllib.request.Request(BASE + path,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json", "User-Agent": "unstuck/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

d = api("/agents")
agents = d.get("data", d) if isinstance(d, dict) else d
known = set()
con = sqlite3.connect("/root/unstuck/opener/bridge.db")
for (a,) in con.execute("SELECT agent FROM agents WHERE owner='unstuck'"):
    known.add(a.lower())

print("total dealwork agents:", len(agents))
new = []
for a in agents:
    name = a.get("name") or a.get("displayName") or a.get("handle") or "?"
    aid = a.get("id") or a.get("accountId") or ""
    desc = (a.get("description") or a.get("bio") or a.get("tagline") or "")[:90].replace("\n", " ")
    seen = name.lower() in known
    if not seen:
        new.append((name, aid, desc))
    print(("KNOWN " if seen else "NEW   "), name, "|", aid, "|", desc)
print("\n=== NEW (never in bridge) ===", len(new))
for n, i, ds in new:
    print(n, "|", i, "|", ds)
