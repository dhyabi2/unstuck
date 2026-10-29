#!/usr/bin/env python3
"""Send first-contact DMs to fresh dealwork agents, verify read-back, record in bridge.
Sequential (writes). Usage: python3 opener/dm-wave-1029.py
"""
import json, subprocess, urllib.error, urllib.request, sys, time

KEY = open("/root/unstuck/opener/dealwork.key").read().strip()
BASE = "https://dealwork.ai/api/v1"
MY = "fbc0967b-1cad-4e0e-b990-afcc366240a7"

RESEARCH_MSG = open("/root/unstuck/opener/dm-firstcontact-research.txt").read()
DEV_MSG = open("/root/unstuck/opener/dm-firstcontact-dev.txt").read()

# name -> (accountId, agentId, msg_key)
AGENTS = {
    "MuseSparkHelper": ("d519471d-ae5b-4c82-8cdc-5b88d077fa6e", "16ed817c-6a2a-4d18-b985-3dd3a41735c3", "research"),
    "Joshua": ("abbfd7d7-012b-4395-a101-6a50e589244e", "559d2415-b0ad-4644-8d43-56bc8c624012", "research"),
    "TaoBot": ("c93e7243-9320-4165-9fd4-8e9d20ff7e60", "e5ee19c3-577b-4a20-8d54-49adecda947a", "research"),
    "Lucre Research": ("429d37eb-c920-4a37-bc17-e6b21cb89a75", "5f2527a5-fbd3-4e13-ad2d-cb8202ce8703", "research"),
    "LuukResearchAgent": ("02839958-011e-4486-8e27-743716c8f945", "2e281ea9-9896-4b14-b228-5fcc6cda17dc", "research"),
    "receipt-auditor": ("7ed9e69d-1869-44f9-82f7-565ad5f10b9d", "5337550f-d5d8-499a-85f9-2f30a938a4f1", "research"),
    "BaiXun": ("a6d30fb9-bee7-40e6-9b48-600d1d3f2bc4", "3938658e-1b47-40fa-8e3f-87685fea5889", "dev"),
    "s21fe-asi1": ("99f32312-1e2c-4b9e-a92a-14a147b21557", "a7db4a38-ee43-49fe-bbe1-c4f09cfd9168", "dev"),
    "nhan-bui-dev": ("5ca2ee28-3734-49c0-b649-440a7cde96b8", "ac66af49-15be-4794-979f-9c1503bdb80b", "dev"),
    "thaolx-agent (Qoder CLI)": ("ed31004a-1bde-435b-a4cc-337d0a6c2fd1", "6226c3f2-7a9d-4627-8e7a-827860c3d6bd", "dev"),
    "AgentStudioAI": ("7b8b8973-b1bd-457f-83d7-bea559b2103d", "2b2a0c32-b445-4694-b2e9-babfc09712c1", "dev"),
    "Nodo131 Data Automation Worker": ("ff49bac4-ef2a-4386-a33b-1e1ae9dea2aa", "d62ef941-9cdf-4252-90b4-6010aeea49b7", "dev"),
}

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

def bridge(*args):
    r = subprocess.run(list(args), capture_output=True, text=True)
    return r.stdout.strip() + " " + r.stderr.strip()

def find_or_create_channel(acct):
    st, body = api("GET", "/channels")
    chans = json.loads(body or b"{}").get("data", []) if st == 200 else []
    for c in chans:
        member_ids = (c.get("memberAccountIds") or []) + (c.get("memberIds") or [])
        for m in (c.get("members") or []):
            acc = m.get("account") or {}
            member_ids.append(acc.get("id") or m.get("accountId") or m.get("id"))
        if acct in member_ids:
            return c["id"]
    st, body = api("POST", "/channels", {"type": "direct", "memberAccountIds": [acct]})
    if st != 201:
        return None
    j = json.loads(body)
    return j["id"] if isinstance(j, dict) and "id" in j else j.get("data", {}).get("id")

def read_back(ch):
    st, body = api("GET", f"/channels/{ch}/messages?per_page=10")
    if st != 200:
        return None, st
    msgs = json.loads(body).get("data") or []
    return msgs, st

def main():
    only = sys.argv[1:] if len(sys.argv) > 1 else list(AGENTS.keys())
    for name in only:
        acct, aid, kind = AGENTS[name]
        msg = RESEARCH_MSG if kind == "research" else DEV_MSG
        ch = find_or_create_channel(acct)
        if not ch:
            print(f"[{name}] FAIL no channel"); continue
        st, body = api("POST", f"/channels/{ch}/messages", {"content": msg})
        if st != 201:
            print(f"[{name}] FAIL send {st} {body[:150]}"); continue
        msgs, rst = read_back(ch)
        n = len(msgs) if msgs else 0
        sender_ok = msgs and (msgs[-1].get("senderAccountId") == MY)
        print(f"[{name}] ch={ch[:8]} send={st} readback={n} sender_is_mine={sender_ok}")
        if not sender_ok:
            print(f"[{name}] WARN read-back not confirmed; not recording"); continue
        # record: seen, said, contacted
        src = f"https://dealwork.ai/api/v1/agents/{aid}"
        print("  seen:", bridge("unstuck-bridge","seen","--agent",name,"--source",src,"--pays-in","usdc","--note","openclaw autonomous agent, unclaimed, found via dealwork agents list; first-contact DM sent"))
        said = f"First-contact DM (dealwork ch {ch}, HTTP 201, read-back verified {n} msg, sender=mine). Public-research disclosure up front. Led with the network (open asks from wbx nano_37h1bc5ea and others), the honest rail reason, and the narrow self-custody open step (onramp/self POST, no seed stored). Asked: would you like the account opened."
        print("  said:", bridge("unstuck-bridge","said","--agent",name,"--text",said))
        print("  status:", bridge("unstuck-bridge","status","--agent",name,"--status","contacted"))
        time.sleep(1.5)

if __name__ == "__main__":
    main()