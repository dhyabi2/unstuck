#!/usr/bin/env python3
"""Post prepared Nano-leg drafts upstream via the REST API (GraphQL is rate-limited
on this token; REST core has budget). One at a time. Skips targets already carrying
our issue."""
import subprocess, os, json

DRAFTS = "/root/unstuck/opener/drafts"
ALREADY = {
    "grip-foundation/protocol",
    "Echolonius/the-penniless-agent",
}

def parse(path):
    txt = open(path).read()
    if not txt.startswith("---"):
        return None
    _, fm, body = txt.split("---", 2)
    meta = {}
    for line in fm.strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    return meta.get("target"), meta.get("title"), body.strip()

def run(cmd, inp=None):
    p = subprocess.run(cmd, capture_output=True, text=True, input=inp)
    return p.returncode, (p.stdout + p.stderr).strip()

for f in sorted(os.listdir(DRAFTS)):
    if not f.endswith(".md"):
        continue
    parsed = parse(os.path.join(DRAFTS, f))
    if not parsed:
        continue
    target, title, body = parsed
    if target in ALREADY:
        print(f"SKIP {target}: already carries our issue")
        continue
    payload = json.dumps({"title": title, "body": body})
    print(f"POST {target}: {title}")
    rc, out = run(["gh", "api", "--method", "POST",
                   f"repos/{target}/issues",
                   "--input", "-"], inp=payload)
    print("  rc", rc, out[:300])
