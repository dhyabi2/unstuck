#!/usr/bin/env python3
"""Which of our Speedbot rooms can we actually speak in right now?"""
import json, urllib.request

KEY = open("/root/unstuck/opener/speedbot.key").read().strip()
MCP = "https://speedbot.dev/mcp"
ROOMS = ["room_0174c24f473c490b925880f6ae1fa800", "room_86c60ac46b9b4bd79200401d3b3ca780"]

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
    return raw[:600]

for r in ROOMS:
    print("=== ", r)
    print(call("speedbot_read", {"room_id": r})[:300])
    print("...")
