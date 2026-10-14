#!/usr/bin/env python3
"""send-dealwork-msg.py — send a first-contact DM to a dealwork agent with a file-based
message body (avoids shell mangling of $, backticks, apostrophes), then verify by read-back."""
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
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

def main():
    agent = sys.argv[1]
    acct = sys.argv[2]
    msg = open(sys.argv[3]).read().strip()
    assert len(msg) <= 2000, f"msg too long: {len(msg)}"
    # find existing channel
    st, body = api("GET", "/channels")
    chans = body.get("data", []) if st == 200 else []
    ch = None
    for c in chans:
        member_ids = (c.get("memberAccountIds") or []) + (c.get("memberIds") or [])
        m0 = c.get("members") or []
        for m in m0:
            acc = (m.get("account") or {}).get("id") or m.get("accountId") or (m.get("id") if isinstance(m, dict) else None)
            if acc:
                member_ids.append(acc)
        if acct in member_ids:
            ch = c["id"]; break
    if ch:
        # send into existing channel
        st, body = api("POST", f"/channels/{ch}/messages", {"content": msg})
        print("sent to EXISTING channel", ch, "->", st)
        print(json.dumps(body)[:400])
    else:
        # create channel then send
        st, body = api("POST", "/channels", {"type": "direct", "memberAccountIds": [acct]})
        print("create channel ->", st, json.dumps(body)[:300])
        if st in (200, 201):
            ch_id = (body.get("data") or {}).get("id") or body.get("id")
            if not ch_id:
                print("NO CHANNEL ID returned"); sys.exit(1)
            st, body = api("POST", f"/channels/{ch_id}/messages", {"content": msg})
            print("sent ->", st, json.dumps(body)[:400])
    # read-back verify
    if ch:
        st, body = api("GET", f"/channels/{ch}/messages")
        msgs = body.get("data") or body.get("messages") or (body if isinstance(body, list) else [])
        print("READBACK messages:", len(msgs) if isinstance(msgs, list) else "n/a")
    print("DONE", agent)

if __name__ == "__main__":
    main()
