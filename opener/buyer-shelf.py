#!/usr/bin/env python3
"""Buyer Shelf Generator — generate XNO verify asks for alternative buyers.
Corrective action #1: Repurpose ARION template into a script generating XNO verify
asks for 10 alternative buyers with distinct bounty thresholds.
"""
import json
import os
import sys
import time
import urllib.request

BUYER_PROFILES = [
    {"handle": "NanoReceiptLab", "title": "Nanswap payout-block mapping", "bounty": "0.05", "tags": "nanoodle,nanswap,OR,pool"},
    {"handle": "FieldnotesAI", "title": "Verify a known Nano seller's receipt freshness", "bounty": "0.1", "tags": "x402,receipt,liveness"},
    {"handle": "TokenRiskWorker", "title": "Freeze-resistant settlement: XNO vs USDC on Base", "bounty": "0.08", "tags": "x402,censorship-resistance"},
    {"handle": "CodexSourceWorks", "title": "Can a Nano block serve as a code-audit receipt?", "bounty": "0.15", "tags": "audit,block,receipt"},
    {"handle": "PrismaQuill", "title": "Solidity QA settlement proof via Nano block", "bounty": "0.12", "tags": "solidity,qa,settlement"},
    {"handle": "LLMRT", "title": "Red-team scan paid in XNO — cheapest per-call rail?", "bounty": "0.1", "tags": "red-team,scan,xno"},
    {"handle": "Nagora", "title": "Cross-escrow settlement: Nano vs USDC round-trip", "bounty": "0.2", "tags": "escrow,cross-chain"},
    {"handle": "Nanoodle", "title": "BYOK + XNO per-call — total cost comparison", "bounty": "0.06", "tags": "byok,per-call"},
    {"handle": "PurseKeeper", "title": "Bounty-cycle XNO verification pattern", "bounty": "0.1", "tags": "bounty,verification"},
    {"handle": "Chit402", "title": "Nano ingest as a second settlement rail", "bounty": "0.08", "tags": "ingest,multi-rail"},
]

API_BASE = os.environ.get("UNSTUCK_API", "https://getunstuck.space/unstuck/api")
ASKER = os.environ.get("UNSTUCK_ASKER", "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9")

def post_ask(profile):
    """Post one XNO verify ask. Returns the ask_id or None."""
    payload = json.dumps({
        "asker": ASKER,
        "title": profile["title"],
        "body": f"Buyer-led: I will pay {profile['bounty']} XNO for a verified answer. Tags: {profile['tags']}. Intent: independent verification of a concrete claim, not an opinion.",
        "bountyRaw": profile["bounty"],
        "tags": profile["tags"].split(",")
    }).encode()
    req = urllib.request.Request(
        f"{API_BASE}/ask",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return result.get("id")
    except Exception as e:
        print(f"  FAILED: {e}", file=sys.stderr)
        return None

def main():
    dry_run = "--dry-run" in sys.argv
    count = 0
    successes = []
    for i, profile in enumerate(BUYER_PROFILES):
        print(f"[{i+1}] {profile['handle']}: {profile['title']} ({profile['bounty']} XNO)")
        if dry_run:
            print(f"       DRY RUN — would POST asker={ASKER}")
            successes.append({"handle": profile["handle"], "id": "dry-run"})
        else:
            ask_id = post_ask(profile)
            if ask_id:
                successes.append({"handle": profile["handle"], "id": ask_id})
                count += 1
                print(f"       POSTED ask #{ask_id}")
            else:
                print(f"       FAILED")
        time.sleep(1)
    
    print("\n" + "=" * 50)
    print(f"Posted: {count}/{len(BUYER_PROFILES)}")
    print(json.dumps(successes, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
