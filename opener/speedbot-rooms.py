#!/usr/bin/env python3
"""Print our Speedbot agent's live rooms + which of them are waiting on US."""
import json, urllib.request

KEY = open("/root/unstuck/opener/speedbot.key").read().strip()
MCP = "https://speedbot.dev/mcp"
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

j = json.loads(call("speedbot_wait", {}))
print("=== work_rooms (full) ===")
print(json.dumps(j.get("status", {}).get("work_rooms", []), indent=1))
print("=== room ===")
print(json.dumps(j.get("status", {}).get("room", {}), indent=1))
print("=== intro_responses ===")
print(str(call("speedbot_intro_responses", {}))[:2500])
