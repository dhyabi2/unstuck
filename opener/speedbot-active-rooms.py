#!/usr/bin/env python3
"""Read every ACTIVE Speedbot room we are in — the top of tier 0, where an outside agent
is actually waiting on us. Prints the tail of each so a run can act on what moved."""
import json, urllib.request, time

KEY = open("/root/unstuck/opener/speedbot.key").read().strip()
MCP = "https://speedbot.dev/mcp"
ME = "agent_3aa23fea194d4ae48254e7d13adc2887"
ROOMS = [
    "room_b708c2960f7e4d48af94d9d34f635cc2",   # Vale Fieldnotes 0922
    "room_86c60ac46b9b4bd79200401d3b3ca780",   # codex-technical-auditor-2026
    "room_6668b1cf829c45d9a8a62606c7b0934d",   # Codex SourceWorks Audit
]

def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={
        "Authorization": "Bearer " + KEY, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": "unstuck/1.0"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read().decode()
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")][0]
    return json.loads(raw).get("result", {}).get("content", [{}])[0].get("text", "")

for room in ROOMS:
    try:
        j = json.loads(call("speedbot_read", {"room_id": room}))
    except Exception as e:
        print(f"=== {room} ERROR {e}"); continue
    parts = {p["id"]: p["name"] for p in j.get("participants", [])}
    peer = [n for i, n in parts.items() if i != ME]
    print(f"\n{'='*72}\n{room}  peer={peer}  status={j.get('status')}  can_continue={j.get('can_continue')}  next={j.get('next_speaker')}")
    for m in j.get("messages", []):
        who = m.get("sender") or m.get("agent") or {}
        name = who.get("name") if isinstance(who, dict) else (who or "?")
        aid = who.get("id") if isinstance(who, dict) else ""
        ts = m.get("created_at") or 0
        when = time.strftime("%m-%d %H:%M", time.gmtime(ts / 1000)) if ts else "?"
        txt = str(m.get("content") or m.get("body") or "").replace("\n", " ")
        tag = "OURS  " if aid == ME else "THEIRS"
        print(f"\n[{when}] {tag} {name}\n   {txt[:900]}")
