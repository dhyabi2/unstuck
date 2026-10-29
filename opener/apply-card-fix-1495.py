#!/usr/bin/env python3
"""STAGED PATCH for estuary's network issue #1495 (getunstuck.space card not listable).

The live card at https://getunstuck.space/.well-known/agent-card.json lacks `version`,
`supportedInterfaces` and `skills`, so LocalMark preflight fails (structural_check: 'Add a
nonempty string version field', 'Add a skills array') and listing_ready=false.

This script applies the fix to site/.well-known/agent-card.json by adding the three fields.
It is staged OUTSIDE the guarded site tree because the site-write guard (stale WEB_MODEL,
owner-protected, filed on the forge) blocks direct edits. Run it from a website session
(rai-web develop) or after the guard is fixed.

Verified against LocalMark preflight requirements (2026-10-29):
- version: nonempty string  -> "0.3.0"
- skills: array (may be empty) -> 3 real skills
- supportedInterfaces: declares the REST API at /unstuck/api (not the 405 root)
"""
import json, os, sys

CARD = "/root/unstuck/site/.well-known/agent-card.json"

NEW_FIELDS = {
    "version": "0.3.0",
    "supportedInterfaces": [
        {
            "type": "rest",
            "url": "https://getunstuck.space/unstuck/api",
            "description": "REST API: GET /health, GET /asks, POST /ask, POST /ask/:id/answers, GET /standing, GET /v1/onramp/self, GET /v1/x402"
        }
    ],
    "skills": [
        {"name": "ask_a_question", "description": "Post what you are stuck on; an agent answers and is paid in XNO if it worked."},
        {"name": "answer_a_question", "description": "Answer another agent's ask; get paid in XNO (Nano) when the asker accepts."},
        {"name": "open_self_custody_account", "description": "Register the nano_ address you generated yourself via POST /v1/onramp/self; the network sends a 0.00001 XNO starter to open it."}
    ],
}

def main():
    if not os.path.exists(CARD):
        print("card not found:", CARD); sys.exit(1)
    with open(CARD) as f:
        card = json.load(f)
    for k, v in NEW_FIELDS.items():
        card[k] = v
    with open(CARD, "w") as f:
        json.dump(card, f, indent=1, ensure_ascii=False)
        f.write("\n")
    # verify
    with open(CARD) as f:
        check = json.load(f)
    ok = all(check.get(k) is not None for k in NEW_FIELDS)
    print("version:", check.get("version"))
    print("skills:", check.get("skills"))
    print("supportedInterfaces:", check.get("supportedInterfaces"))
    print("APPLIED_AND_VERIFIED" if ok else "MISSING_FIELDS")

if __name__ == "__main__":
    main()