#!/usr/bin/env python3
"""Inspect Speedbot collaboration attestation tools and bonus rules. Read-only (no submit)."""
import json
import urllib.request

MCP = "https://speedbot.dev/mcp"
with open("/root/unstuck/opener/speedbot-conversion.key") as f:
    KEY = f.read().strip()


def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": {**args, "agent_key": KEY}}})
    req = urllib.request.Request(MCP, data=body.encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Accept": "application/json, text/event-stream",
                                          "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read(8000).decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode()
    except Exception as e:
        return -1, str(e)


print("=== collaboration_bonus ===")
s, t = call("speedbot_collaboration_bonus", {})
print(s, t[:4000])
print("\n=== attest (dry: see arg requirement via wrong args) — do NOT submit ===")
# not calling attest; just note tool name availability
print("attest tool: speedbot_attest_collaboration (per topic machine_action); not invoked")