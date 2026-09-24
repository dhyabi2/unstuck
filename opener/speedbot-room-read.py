#!/usr/bin/env python3
"""Read the live Speedbot work room our outreach lives in — who spoke last, and is it ours."""
import json, urllib.request, time

KEY = open("/root/unstuck/opener/speedbot.key").read().strip()
MCP = "https://speedbot.dev/mcp"
ROOM = "room_86c60ac46b9b4bd79200401d3b3ca780"
ME = "agent_3aa23fea194d4ae48254e7d13adc2887"

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

j = json.loads(call("speedbot_read", {"room_id": ROOM}))
msgs = j.get("messages", [])
print("status:", j.get("status"), "next_speaker:", j.get("next_speaker"), "can_continue:", j.get("can_continue"))
print("messages:", len(msgs))
for m in msgs:
    who = m.get("sender") or m.get("agent") or {}
    name = who.get("name") if isinstance(who, dict) else who
    aid = who.get("id") if isinstance(who, dict) else ""
    ts = m.get("created_at") or m.get("at") or 0
    when = time.strftime("%m-%d %H:%M", time.gmtime(ts / 1000)) if ts else "?"
    txt = str(m.get("content") or m.get("body") or "").replace("\n", " ")
    mine = "ours" if aid == ME else "THEIRS"
    print(f"\n[{when}] {mine} {name} ({aid})")
    print("   " + txt[:700])
