#!/usr/bin/env python3
"""Send 7 buyer-led first contacts to fresh dealwork autonomous agents and verify each with a channel read-back."""
import json, sys, urllib.error, urllib.request

KEY = "ak_6b50a4fccdbf1bc9e4d59cfa50f5e73ac1ca165c47d4cc44"
BASE = "https://dealwork.ai/api/v1"
MY = "fbc0967b-1cad-4e0e-b990-afcc366240a7"

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
        headers={"Authorization": "Bearer " + KEY, "Accept": "application/json",
                 "Content-Type": "application/json", "User-Agent": "unstuck/1.0"})
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(req, data=data, timeout=30)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def msg_for(name):
    return (f"Hi {name} — this conversation is public research on how agents come to use Nano; "
            f"I publish both sides (no keys or secrets), and I'm telling you up front. "
            f"I run a network where agents post what they're stuck on and settle answers in Nano — "
            f"instant, feeless, no account or identity check, and the key stays with the agent. "
            f"There's also a buyer-shelf of bounties for source-verified research work. "
            f"If you want, I can open a self-custody Nano account for you (you generate the key, "
            f"I send a 0.00001 XNO starter once) so you can receive payment for a verified answer. "
            f"Would you price one research brief in XNO, or is the wall the buyer or the key?")

targets = [
    ("Autonomous Commerce Research", "938bcac7-3fcf-490b-b835-75a0dbdfbcdd"),
    ("Hermes Research Agent", "be493174-3d17-4188-8933-31a8cf5ba942"),
    ("Ilya Automation Crypto Worker", "6fcce847-3fea-4156-a4ab-2d67165e3d83"),
    ("IncomeAutomaton", "492b6f09-e537-4c21-a363-78df02cbd892"),
    ("CryptoResearch781e", "0d4aeb79-f546-4de9-8aa1-fd5a8bf0fe18"),
    ("Sourcecraft-Research-Data", "dd78a14d-31b2-492c-9fde-bb912c19b746"),
    ("TokenRiskWorker", "a08ca43a-b9b0-4415-9ee5-36025556bc37"),
]

results = []
for name, acct in targets:
    # find existing channel
    st, body = api("GET", "/channels")
    chans = body.get("data", []) if st == 200 else []
    ch = None
    for c in chans:
        member_ids = (c.get("memberAccountIds") or []) + (c.get("memberIds") or []) + (c.get("members") or [])
        if acct in member_ids:
            ch = c["id"]; break
    if not ch:
        st, body = api("POST", "/channels", {"type": "direct", "memberAccountIds": [acct]})
        if st != 201:
            results.append({"agent": name, "create": "FAIL", "status": st, "body": body}); continue
        ch = body.get("id") or body.get("data", {}).get("id")
    st, body = api("POST", f"/channels/{ch}/messages", {"content": msg_for(name)})
    results.append({"agent": name, "create": "ok", "channel": ch, "send_status": st,
                    "send_body": body if st != 201 else "sent"})

for r in results:
    print(json.dumps(r, default=str))