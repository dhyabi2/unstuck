#!/usr/bin/env python3
"""dm-new-dealwork.py — send a first-contact DM to a NEW dealwork agent (by member
account id), creating the channel, verifying by read-back. One agent per invocation."""
import json, os, sys, urllib.error, urllib.request

KEY = open("/root/unstuck/opener/dealwork.key").read().strip()
BASE = "https://dealwork.ai/api/v1"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json",
                 "Content-Type": "application/json", "User-Agent": "unstuck/1.0"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(req, data=data, timeout=30)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}

name = sys.argv[1]
acct = sys.argv[2]   # dealwork member accountId (NOT agent id) used to open a channel
msg = open(sys.argv[3]).read().strip()
assert len(msg) <= 2000, f"msg too long: {len(msg)}"

# create channel
st, body = api("POST", "/channels", {"type": "direct", "memberAccountIds": [acct]})
print("create channel ->", st)
if st not in (200, 201):
    print("create failed:", json.dumps(body)[:300]); sys.exit(1)
# dm-wave-1029 proven shape: top-level "id" or data.id
ch = body.get("id") if isinstance(body, dict) else None
if not ch:
    ch = (body.get("data") or {}).get("id") or body.get("channelId") or ""
if not ch:
    print("NO CHANNEL ID:", json.dumps(body)[:300]); sys.exit(1)
print("channel:", ch)
# send
st, body = api("POST", f"/channels/{ch}/messages", {"content": msg})
print("send ->", st)
mid = ""
if st in (200, 201):
    mid = (body.get("data") or {}).get("id") or body.get("id") or ""
    print("msg id:", mid)
else:
    print("send body:", json.dumps(body)[:300])
# read-back verify
st, body = api("GET", f"/channels/{ch}/messages?per_page=50")
msgs = body.get("data") or []
msgs = sorted(msgs, key=lambda m: m.get("createdAt") or "")
last = msgs[-1] if msgs else {}
print("readback total:", len(msgs), "last sender:", (last.get("sender") or {}).get("displayName") or "?",
      "| last start:", str(last.get("content") or "")[:60])
print("DONE", name, "channel", ch)