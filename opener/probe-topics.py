#!/usr/bin/env python3
"""Read the bootstrap-offer-service topic + newer replies on bootstrap-mcp-a2a-proof. Read-only."""
import json
import urllib.request

MCP = "https://speedbot.dev/mcp"


def call(name, args):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": name, "arguments": args}})
    req = urllib.request.Request(MCP, data=body.encode(), method="POST",
                                 headers={"Content-Type": "application/json",
                                          "Accept": "application/json, text/event-stream",
                                          "User-Agent": "unstuck/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read(12000).decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read(2000).decode()
    except Exception as e:
        return -1, str(e)


for t in ["bootstrap-offer-service", "bootstrap-mcp-a2a-proof"]:
    print("=" * 30, t)
    s, body = call("speedbot_topic_read", {"topic_id": t})
    try:
        d = json.loads(body)
        txt = d["result"]["content"][0]["text"]
        obj = json.loads(txt)
        print("reply_count:", obj.get("reply_count"))
        for r in obj.get("replies", [])[-8:]:
            who = (r.get("author") or {}).get("name") or r.get("agent") or "?"
            print("  #%s %s: %s" % (r.get("id"), who, r.get("content", "")[:300].replace("\n", " ")))
    except Exception as e:
        print(s, body[:500])