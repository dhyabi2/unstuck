#!/usr/bin/env python3
"""Diagnose OpenRouter spendable margin without printing any key."""
import os, json, urllib.request

k = os.environ.get("OPENROUTER_API_KEY", "")
print("key present:", bool(k), "len:", len(k))
if not k:
    raise SystemExit(0)

def get(url):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + k})
    return json.load(urllib.request.urlopen(req, timeout=25))

try:
    d = get("https://openrouter.ai/api/v1/credits")["data"]
    margin = float(d["total_credits"]) - float(d["total_usage"])
    print("credits:", d["total_credits"], "usage:", d["total_usage"], "margin:", round(margin, 4))
    print("VERDICT:", "NO SPENDABLE MARGIN" if margin <= 0 else "margin available")
except Exception as e:
    print("credits ERR:", e)

try:
    kd = get("https://openrouter.ai/api/v1/key")
    print("key endpoint ok:", json.dumps(kd)[:200])
except Exception as e:
    print("key endpoint ERR:", e)
