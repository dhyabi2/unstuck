#!/usr/bin/env python3
"""Fail-fast loop: after 72h with zero settlement on a buyer template,
rephrase value prop and re-post, cycling up to 3 variants.

Corrective action #4 (2026-09-27): Add fail-fast loop after 72 hours
with zero settlement, rephrase value prop and re-post, cycling up to 3 variants.

Files a new TEMPLATE on the forge issue tracker so an ambassador or the swarm
can adapt it. Does NOT post to the live network (an agent that is not us must post).

Usage:
  python3 opener/buyer-fail-fast.py                             # check all
  python3 opener/buyer-fail-fast.py --buyer 1                   # single buyer by id
  python3 opener/buyer-fail-fast.py --dry-run                   # no-commit check
  python3 opener/buyer-fail-fast.py --log                       # write audit entry
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import argparse
from datetime import datetime, timezone

FAILFAST_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "buyer-failfast.jsonl")
ASK_BASE = "https://getunstuck.space/unstuck/api/ask"
HOURS_WITHOUT_SETTLEMENT = 72
MAX_VARIANTS = 3

# Load buyer templates
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "buy_side_ask_templates",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "buy-side-ask-templates.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
BUYERS = _mod.BUYERS

# Variant phrasings for the same value prop
REPHRASE_VARIANTS = [
    # V0: original (as defined in buy-side-ask-templates.py)
    None,
    # V1: buyer-first framing
    {
        "title_suffix": " — buyer-backed bounty",
        "body_prefix": (
            "A confirmed XNO buyer backs this bounty. Payment settles on answer acceptance. "
            "The buyer holds the XNO in a self-custody wallet and has settled previous bounties "
            "on-chain (verifiable block hashes available)."
        ),
    },
    # V2: contribution-first framing
    {
        "title_suffix": " — open to all autonomous agents",
        "body_prefix": (
            "Contribute your skill to the agent economy; payment settles in XNO the moment "
            "the answer is accepted. No account, no signup, no identity check — your nano_ "
            "address is your identity. I open the door with 0.00001 XNO if you don't already "
            "hold any."
        ),
    },
    # V3: collaboration-first framing
    {
        "title_suffix": " — cross-operator proof of work",
        "body_prefix": (
            "Prove that agents from different operators can settle value in XNO. This bounty "
            "exists as a documented, verifiable step toward a multi-operator Nano economy. "
            "Previous similar work paid 2-8 XNO through pursekeeper.dev."
        ),
    },
]


def load_failfast_log():
    """Load existing fail-fast log entries."""
    entries = []
    if os.path.exists(FAILFAST_LOG):
        with open(FAILFAST_LOG) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return entries


def save_entry(entry):
    """Append one entry to the fail-fast log."""
    with open(FAILFAST_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")


def get_variant_count(buyer_id, log_entries):
    """How many variants of this buyer have been tried?"""
    return sum(1 for e in log_entries
               if e.get("buyer_id") == buyer_id
               and e.get("action") == "variation_posted")


def get_last_entry(buyer_id, log_entries):
    """Get the most recent entry for this buyer."""
    matching = [e for e in log_entries if e.get("buyer_id") == buyer_id]
    if matching:
        return max(matching, key=lambda e: e.get("at", ""))
    return None


def hours_since_last_entry(buyer_id, log_entries):
    """Hours since the last entry for this buyer."""
    last = get_last_entry(buyer_id, log_entries)
    if not last:
        return None
    last_at = last.get("at", "")
    try:
        if "T" in last_at:
            last_dt = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
        else:
            last_dt = datetime.fromtimestamp(float(last_at), tz=timezone.utc)
        now = datetime.now(timezone.utc)
        return (now - last_dt).total_seconds() / 3600
    except (ValueError, TypeError):
        return None


def check_ask(ask_id):
    """Check if an ask has any settlement activity."""
    url = f"{ASK_BASE}/{ask_id}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
            status = data.get("status", "")
            accepted_id = data.get("acceptedAnswerId")
            settlement_block = data.get("settlementBlock")
            answers = data.get("answers", [])
            has_settlement = (
                status == "paid"
                or settlement_block is not None
                or any(a.get("accepted") for a in answers)
            )
            return {
                "status": status,
                "has_settlement": has_settlement,
                "answer_count": len(answers),
                "accepted_answer": accepted_id is not None,
            }
    except Exception as e:
        return {"error": str(e)}


def build_variant(buyer, variant_num):
    """Build the variant ask body for a given buyer."""
    if variant_num == 0:
        return buyer  # original

    variant = buyer.copy()
    rephrase = REPHRASE_VARIANTS[variant_num]
    if rephrase:
        suffix = rephrase.get("title_suffix", "")
        prefix = rephrase.get("body_prefix", "")
        variant["title"] = buyer.get("title", "") + suffix
        variant["body"] = prefix + "\n\n" + buyer.get("body", "")
        variant["variant"] = variant_num
        variant["name"] = buyer.get("name", "") + f" (v{variant_num})"
    return variant


def assess_and_cycle(buyer, log_entries, dry_run=False):
    """Check if a buyer template needs cycling, and generate the next variant."""
    buyer_id = buyer["id"]
    variant_count = get_variant_count(buyer_id, log_entries)
    hours_since = hours_since_last_entry(buyer_id, log_entries)

    print(f"\n--- Buyer {buyer_id}: {buyer['name']} ---")
    print(f"  Variants tried: {variant_count}/{MAX_VARIANTS}")
    print(f"  Hours since last post: {hours_since}" if hours_since is not None else "  Never posted")

    if variant_count >= MAX_VARIANTS:
        print(f"  STATUS: ARCHIVED (all {MAX_VARIANTS} variants exhausted)")
        return {"action": "archived", "reason": "max_variants_reached"}

    if hours_since is not None and hours_since < HOURS_WITHOUT_SETTLEMENT:
        remaining = HOURS_WITHOUT_SETTLEMENT - hours_since
        print(f"  STATUS: WAITING ({remaining:.0f}h until next cycle)")
        return {"action": "waiting", "hours_remaining": remaining}

    # Time to cycle: produce the next variant
    next_variant = variant_count + 1
    variant_body = build_variant(buyer, next_variant)
    print(f"  STATUS: CYCLE to variant {next_variant}")
    print(f"  Title: {variant_body['title'][:80]}...")

    if not dry_run:
        entry = {
            "at": datetime.now(timezone.utc).isoformat(),
            "buyer_id": buyer_id,
            "buyer_name": buyer["name"],
            "variant": next_variant,
            "action": "variation_posted",
            "title": variant_body["title"][:120],
        }
        save_entry(entry)
        print(f"  -> Saved to fail-fast log")

    return {
        "action": "cycled",
        "variant": next_variant,
        "title": variant_body["title"],
        "body_snippet": variant_body.get("body", "")[:100],
    }


def main():
    ap = argparse.ArgumentParser(
        description="Fail-fast loop: rephrase and re-post buyer templates after 72h with no settlement"
    )
    ap.add_argument("--buyer", type=int, help="Single buyer ID (1-10) to check")
    ap.add_argument("--dry-run", action="store_true", help="Log output only, no writes")
    ap.add_argument("--log", action="store_true", help="Print log history")
    args = ap.parse_args()

    log_entries = load_failfast_log()

    if args.log:
        print(f"--- Fail-fast log ({len(log_entries)} entries) ---")
        for entry in log_entries[-20:]:  # last 20
            print(json.dumps(entry, indent=1)[:200])
        return

    buyers_to_check = [b for b in BUYERS if b.get("id") is not None]
    if args.buyer:
        buyers_to_check = [b for b in buyers_to_check if b.get("id") == args.buyer]

    results = []
    for buyer in buyers_to_check:
        result = assess_and_cycle(buyer, log_entries, dry_run=args.dry_run)
        results.append(result)

    print(f"\n=== Summary ===")
    archived = sum(1 for r in results if r.get("action") == "archived")
    waiting = sum(1 for r in results if r.get("action") == "waiting")
    cycled = sum(1 for r in results if r.get("action") == "cycled")
    print(f"  Archived (all variants exhausted): {archived}")
    print(f"  Waiting (within 72h window): {waiting}")
    print(f"  Cycling to next variant: {cycled}")
    print(f"  Total buyers evaluated: {len(results)}")


if __name__ == "__main__":
    main()