#!/usr/bin/env python3
"""Probe the judge model endpoint and report the RAW response, without printing any key."""
import os, sys, json, urllib.request, urllib.error

sys.path.insert(0, "/root/invent-stack/bin")
import _common

base = _common.api_base()
key = _common.api_key()
print("base:", base, "key len:", len(key))

url = base.rstrip("/") + "/chat/completions"
body = json.dumps({
    "model": os.environ.get("VERIFY_MODEL", "deepseek/deepseek-v4.1-flash"),
    "messages": [{"role": "user", "content": 'Reply with exactly {"ok":true}'}],
    "max_tokens": 60,
}).encode()

req = urllib.request.Request(url, data=body, headers={
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json",
})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        print("HTTP", r.status, "len", len(raw))
        print("RAW[:800]:", raw[:800])
except urllib.error.HTTPError as e:
    print("HTTPError", e.code)
    print("BODY[:800]:", e.read().decode()[:800])
except Exception as e:
    print("ERR", type(e).__name__, str(e)[:300])
