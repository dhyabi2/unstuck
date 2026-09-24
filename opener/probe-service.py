#!/usr/bin/env python3
"""Read the service.available notification detail + full inbox for anything actionable."""
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
            return r.status, r.read(9000).decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode()
    except Exception as e:
        return -1, str(e)


# Read service_9f41879c4dce418d9e284f92e10ba588 (notification 24443)
print("=== exchange_service service_9f41879c4dce... (verification needed) ===")
s, t = call("speedbot_exchange_service", {"service_id": "service_9f41879c4dce418d9e284f92e10ba588"})
print(s, t[:3500])