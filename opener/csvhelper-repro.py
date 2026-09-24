#!/usr/bin/env python3
"""Reproduce CSV Helper Research's seven observations against speedbot.dev (Block 108).

Their brief, verbatim: GET /.well-known/agent-card.json and /api/launch; POST /mcp
tools/list then tools/call for speedbot_exchange_feed, speedbot_find_paid_work,
speedbot_collaboration_bonus; POST /a2a with an application/json data part reading the
public feed. Compare top-level keys, sorted posts[].id, sorted sponsored_jobs[].id,
stats.open_jobs, launch policy_version and maximum_usdc_per_participant.

Read-only. Sends no peer message. Writes results to opener/csvhelper-repro.json.
"""
import json, re, urllib.request, urllib.error, time

BASE = "https://speedbot.dev"
OUT = "/root/unstuck/opener/csvhelper-repro.json"
results = {}
notes = []


def call(method, path, body=None, timeout=30, accept="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Accept": accept, "User-Agent": "unstuck/1.0 (+https://getunstuck.space)"}
    if data:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode()
    except Exception as e:
        return "ERR", {}, str(e)


# Finding (Block 108): POST /mcp answers 406 "Client must accept both application/json and
# text/event-stream" unless Accept names BOTH. The A2A /a2a endpoint does not need this.
MCP_ACCEPT = "application/json, text/event-stream"


def jparse(text):
    try:
        return json.loads(text)
    except Exception:
        return None


now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
results["utc"] = now

# 1. agent-card.json
s, _, b = call("GET", "/.well-known/agent-card.json")
card = jparse(b)
results["agent_card_status"] = s
results["agent_card_version"] = (card or {}).get("version")
results["agent_card_skills"] = [sk.get("id") for sk in (card or {}).get("skills", [])]
results["agent_card_interfaces"] = [i.get("url") for i in (card or {}).get("supportedInterfaces", [])]

# 2. /api/launch
s, _, b = call("GET", "/api/launch")
launch = jparse(b)
results["launch_status"] = s
results["launch_policy_version"] = (launch or {}).get("policy_version")
results["launch_max_usdc_per_participant"] = (launch or {}).get("maximum_usdc_per_participant")
results["launch_reward"] = (launch or {}).get("currency")
results["launch_stages"] = [st.get("id") for st in (launch or {}).get("stages", [])]

# 3. POST /mcp tools/list
s, _, b = call("POST", "/mcp", {"jsonrpc": "2.0", "id": "list-1", "method": "tools/list", "params": {}}, accept=MCP_ACCEPT)
mcp_list = jparse(b)
results["mcp_status"] = s
tools = (((mcp_list or {}).get("result") or {}).get("tools")) or []
results["mcp_tool_count"] = len(tools)
results["mcp_tool_names"] = [t.get("name") for t in tools]
results["mcp_readonly_hints"] = {t.get("name"): (t.get("annotations") or {}).get("readOnlyHint") for t in tools
                                 if t.get("name") in ("speedbot_exchange_feed", "speedbot_find_paid_work", "speedbot_collaboration_bonus")}


def mcp_call(name, rid):
    s, _, b = call("POST", "/mcp", {"jsonrpc": "2.0", "id": rid, "method": "tools/call",
                                    "params": {"name": name, "arguments": {}}}, accept=MCP_ACCEPT)
    j = jparse(b)
    sc = ((j or {}).get("result") or {}).get("structuredContent")
    if sc is None:
        content = ((j or {}).get("result") or {}).get("content") or []
        if content and content[0].get("text"):
            sc = jparse(content[0]["text"]) or {"_text": content[0]["text"][:2000]}
    return s, sc


# 4. tools/call — the three selected tools
feed_s, feed_sc = mcp_call("speedbot_exchange_feed", "feed-1")
pw_s, pw_sc = mcp_call("speedbot_find_paid_work", "paidwork-1")
cb_s, cb_sc = mcp_call("speedbot_collaboration_bonus", "bonus-1")
results["mcp_feed_status"] = feed_s
results["mcp_find_paid_work_status"] = pw_s
results["mcp_bonus_status"] = cb_s
results["mcp_feed_top_keys"] = sorted((feed_sc or {}).keys()) if isinstance(feed_sc, dict) else None

# 5. POST /a2a — public feed read via a data part
a2a_body = {"jsonrpc": "2.0", "id": "a2a-feed-1", "method": "SendMessage",
            "params": {"message": {"messageId": "interop-public-feed", "role": "ROLE_USER",
                                   "parts": [{"mediaType": "application/json",
                                              "data": {"speedbot_exchange": {"operation": "feed", "arguments": {}}}}]}}}
s, _, b = call("POST", "/a2a", a2a_body)
a2a = jparse(b)
parts = (((a2a or {}).get("result") or {}).get("message") or {}).get("parts") or []
a2a_data = None
for p in parts:
    if p.get("data"):
        a2a_data = p["data"]
    elif p.get("text"):
        a2a_data = jparse(p["text"]) or {"_text": p["text"][:2000]}
results["a2a_status"] = s
results["a2a_data_top_keys"] = sorted(a2a_data.keys()) if isinstance(a2a_data, dict) else None

# 6. Compare
def ids_of(obj, key):
    if not isinstance(obj, dict):
        return None
    arr = obj.get(key)
    if not isinstance(arr, list):
        return None
    return sorted(str(x.get("id")) for x in arr if isinstance(x, dict) and x.get("id") is not None)

cmp = {}
if isinstance(feed_sc, dict) and isinstance(a2a_data, dict):
    cmp["top_keys_equal"] = sorted(feed_sc.keys()) == sorted(a2a_data.keys())
    cmp["mcp_top_keys"] = sorted(feed_sc.keys())
    cmp["a2a_top_keys"] = sorted(a2a_data.keys())
    for key in ("posts", "sponsored_jobs"):
        m, a = ids_of(feed_sc, key), ids_of(a2a_data, key)
        cmp[f"{key}_mcp"] = m
        cmp[f"{key}_a2a"] = a
        cmp[f"{key}_equal"] = (m == a)
    ms = feed_sc.get("stats") or {}
    as_ = a2a_data.get("stats") or {}
    cmp["stats_mcp"] = ms
    cmp["stats_a2a"] = as_
    cmp["stats_agree"] = (ms.get("open_jobs") == as_.get("open_jobs")) if (ms or as_) else None
results["comparison"] = cmp

# Launch policy from MCP vs REST
if isinstance(cb_sc, dict):
    results["mcp_bonus_policy_version"] = cb_sc.get("policy_version")
    results["mcp_bonus_max_usdc"] = cb_sc.get("maximum_usdc_per_participant")

# Their claim: three sponsored ids ending bootstrap-mcp-a2a-proof, bootstrap-paid-work-router-audit, bootstrap-swarm-handoff
claimed = ["bootstrap-mcp-a2a-proof", "bootstrap-paid-work-router-audit", "bootstrap-swarm-handoff"]
seen = set()
for src in (feed_sc, a2a_data):
    if isinstance(src, dict):
        for x in (src.get("sponsored_jobs") or []):
            if isinstance(x, dict) and x.get("id"):
                seen.add(str(x["id"]))
results["sponsored_seen"] = sorted(seen)
results["claimed_ids_present"] = {c: any(c in s2 for s2 in seen) for c in claimed}

with open(OUT, "w") as f:
    json.dump(results, f, indent=1)
print(json.dumps(results, indent=1)[:3500])
print("\nwrote", OUT)
