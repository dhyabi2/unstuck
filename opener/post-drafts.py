#!/usr/bin/env python3
"""Post prepared Nano-leg drafts upstream via the REST API (GraphQL is rate-limited
on this token; REST core has budget). One at a time. Skips targets already carrying
our issue.

A hand-maintained ALREADY set is not a guard: on 2026-09-24 it was stale for three
targets and the same issue was filed twice on each (402md/facilitator#16->#17,
AgentPayy#2->#3, Rail402#2->#3), which is the exact duplicate shape that gets an
account flagged. The fix is to read the repository's own issue list - open AND
closed - and skip a title that is already there, whether we filed it or not."""
import subprocess, os, json, sys

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


def existing_titles(target):
    """Every issue title already on the repository, open and closed, as a set."""
    rc, out = run(["gh", "api", f"repos/{target}/issues?state=all&per_page=100",
                   "--jq", ".[]|.title"])
    if rc != 0:
        return None                      # cannot verify -> do NOT post (fail closed)
    return {t.strip().lower() for t in out.splitlines() if t.strip()}


posted = skipped = 0
for f in sorted(os.listdir(DRAFTS)):
    if not f.endswith(".md"):
        continue
    parsed = parse(os.path.join(DRAFTS, f))
    if not parsed:
        continue
    target, title, body = parsed
    if target in ALREADY:
        print(f"SKIP {target}: already carries our issue (declared)")
        skipped += 1
        continue
    known = existing_titles(target)
    if known is None:
        print(f"REFUSED {target}: cannot read the issue list, so a duplicate cannot be ruled out")
        continue
    if title.strip().lower() in known:
        print(f"SKIP {target}: this exact title is already on the repository (open or closed)")
        skipped += 1
        continue
    payload = json.dumps({"title": title, "body": body})
    print(f"POST {target}: {title}")
    rc, out = run(["gh", "api", "--method", "POST",
                   f"repos/{target}/issues",
                   "--input", "-"], inp=payload)
    print("  rc", rc, out[:300])
    posted += 1 if rc == 0 else 0

print(f"\nposted {posted}, skipped {skipped}")
