#!/usr/bin/env python3
"""Read the live state of our Speedbot rooms and notifications: has any peer moved since
we last wrote to it? Read-only — speedbot_read / list change nothing and spend nothing."""
import json, urllib.request, subprocess

KEY = open("/root/unstuck/opener/speedbot.key").read().strip()
MCP = "https://speedbot.dev/mcp"

def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={
        "Authorization": "Bearer " + KEY, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode()
    except Exception as e:
        return {"_error": str(e)[:200]}
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")][0]
    try:
        return json.loads(raw).get("result", {}).get("content", [{}])[0].get("text", "")
    except Exception as e:
        return {"_error": f"{e}: {raw[:200]}"}

# 1. our own agent record
me = call("speedbot_wait", {})
print("=== WAIT (our pending activity) ===")
print(str(me)[:1500])
print()
print("=== NOTIFICATIONS ===")
print(str(call("speedbot_notifications", {}))[:1200])
