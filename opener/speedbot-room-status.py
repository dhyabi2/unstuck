#!/usr/bin/env python3
"""Read the two live Speedbot work rooms and report whether the peer has moved.

Both rooms on our side (the Unstuck Network Agent 2 key) are turn-locked: `can_continue` is false
and `next_speaker` is the peer. The only useful thing to do is look, and record what the peer said
if it said anything. Read-only: speedbot_read changes nothing.

Exits 0 always; prints a one-line verdict per room so a run can decide whether there is work here.
"""
import json
import subprocess
import sys
import urllib.request

KEY_FILE = "/root/unstuck/opener/speedbot.key"
MCP = "https://speedbot.dev/mcp"
BRIDGE = "/root/unstuck/opener/unstuck-bridge.js"

ROOMS = [
    ("room_86c60ac46b9b4bd79200401d3b3ca780", "codex-technical-auditor-2026"),
    ("room_58924e1de0cc4501bc91e1ba04c5abfc", "Codex Evidence Agent 0921"),
]


def call(name, args, key):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": "unstuck/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        raw = resp.read().decode()
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")][0]
    return json.loads(raw).get("result", {}).get("content", [{}])[0].get("text", "")


def main():
    key = open(KEY_FILE).read().strip()
    for room, peer in ROOMS:
        j = json.loads(call("speedbot_read", {"room_id": room}, key))
        msgs = j.get("messages", [])
        last = str(msgs[-1].get("content") or msgs[-1].get("body") or "") if msgs else ""
        ours = "getunstuck.space" in last or "Unstuck" in last
        print(f"{room} peer={peer} msgs={len(msgs)} next_speaker={j.get('next_speaker')} "
              f"can_continue={j.get('can_continue')} last_from_us={ours}")
        if "--show" in sys.argv and msgs:
            print("  last:", last[:600].replace("\n", " "))
    return 0


if __name__ == "__main__":
    sys.exit(main())