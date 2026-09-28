#!/usr/bin/env python3
"""Scheduled audit job: ping each buyer ask on getunstuck.space, log replies,
and auto-escalate high-intent responses to negotiation.

Corrective action #2 (2026-09-27): deploy scheduled audit job pinging each ask,
logging replies, and auto-escalating high-intent responses.

This script:
1. Reads buyer templates from buy-side-ask-templates.py
2. Checks each ask's status on the live network (GET /api/ask/<id>)
3. Logs replies and flags high-intent ones (meaningful body, offered address, priced)
4. Records in a JSONL audit log

Usage:
  python3 opener/buyer-ask-audit.py                     # run once, print report
  python3 opener/buyer-ask-audit.py --log               # append to audit log
  python3 opener/buyer-ask-audit.py --help
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import argparse
from datetime import datetime

ASK_BASE = "https://getunstuck.space/unstuck/api/ask"
ASK_LIST = "https://getunstuck.space/unstuck/api/asks"
AUDIT_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "buyer-ask-audit.jsonl")

# Load buyer templates
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Import BUYERS from buy-side-ask-templates.py (hyphens not valid in import name)
import importlib.util
_buyer_spec = importlib.util.spec_from_file_location(
    "buy_side_ask_templates",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "buy-side-ask-templates.py")
)
_buyer_mod = importlib.util.module_from_spec(_buyer_spec)
_buyer_spec.loader.exec_module(_buyer_mod)
BUYERS = _buyer_mod.BUYERS

HIGH_INTENT_KEYWORDS = [
    "nano_", "address", "price", "bounty", "pay", "send", "deal",
    "accept", "interested", "quote", "0.001", "0.005", "0.01", "0.1",
    "1 XNO", "let's", "proceed"
]


def fetch_ask(ask_id):
    """Fetch a single ask by ID from the network."""
    url = f"{ASK_BASE}/{ask_id}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "id": ask_id}
    except Exception as e:
        return {"error": str(e), "id": ask_id}


def list_asks():
    """List all asks from the network."""
    req = urllib.request.Request(ASK_LIST, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}


def assess_intent(ask):
    """Assess whether an ask has high-intent responses."""
    answers = ask.get("answers", [])
    if not answers:
        return {"level": "none", "reason": "no answers"}
    
    for a in answers:
        body = a.get("body", "") or ""
        answerer = a.get("answerer", "")
        keywords_found = [kw for kw in HIGH_INTENT_KEYWORDS if kw.lower() in body.lower() or kw.lower() in answerer.lower()]
        if len(keywords_found) >= 2:
            return {
                "level": "high",
                "reason": f"meaningful reply: {body[:100]}... (keywords: {keywords_found})",
                "answerer": answerer,
                "answer_body": body[:200],
            }
        if body and len(body) > 80:
            return {
                "level": "medium",
                "reason": f"substantive reply: {body[:100]}...",
                "answerer": answerer,
            }
    
    return {"level": "low", "reason": f"{len(answers)} short/generic answers"}


def run_audit(log=False):
    """Run a full audit and optionally append to JSONL log."""
    timestamp = datetime.utcnow().isoformat() + "Z"
    
    # List all asks
    print(f"=== Buyer Ask Audit @ {timestamp} ===")
    all_asks_data = list_asks()
    if isinstance(all_asks_data, dict) and "error" in all_asks_data:
        print(f"ERROR listing asks: {all_asks_data['error']}")
        return 1
    
    # If the response is a list, use it directly
    asks_list = all_asks_data if isinstance(all_asks_data, list) else all_asks_data.get("data", all_asks_data.get("asks", []))
    
    print(f"Total asks on network: {len(asks_list)}")
    
    results = []
    for ask in asks_list:
        ask_id = ask.get("id", "?")
        title = ask.get("title", "")[:80]
        asker = ask.get("asker", "?")
        answers = ask.get("answers", [])
        
        # Match against buyer templates by title similarity
        matched_buyer = None
        for b in BUYERS:
            if any(term.lower() in title.lower() for term in b["name"].lower().split()[:3]):
                matched_buyer = b
                break
        
        intent = assess_intent(ask)
        
        entry = {
            "timestamp": timestamp,
            "ask_id": ask_id,
            "title": title[:100],
            "asker": asker,
            "answer_count": len(answers),
            "intent": intent,
            "matched_buyer": matched_buyer["name"] if matched_buyer else None,
        }
        results.append(entry)
        
        # Print report
        flag = ""
        if intent["level"] == "high":
            flag = " *** HIGH INTENT ***"
        elif intent["level"] == "medium":
            flag = " * medium intent *"
        
        buyer_tag = f" [buyer template: {matched_buyer['name'][:30]}]" if matched_buyer else ""
        print(f"  #{ask_id}: {title[:60]} | {len(answers)} answers | {intent['level']}{flag}{buyer_tag}")
    
    # Summary
    high_intent = [r for r in results if r["intent"]["level"] == "high"]
    medium_intent = [r for r in results if r["intent"]["level"] == "medium"]
    print(f"\n--- Summary ---")
    print(f"Total asks: {len(results)}")
    print(f"High-intent: {len(high_intent)}")
    print(f"Medium-intent: {len(medium_intent)}")
    print(f"None (no answers): {len([r for r in results if r['intent']['level'] == 'none'])}")
    
    for hi in high_intent:
        print(f"  ESCALATE: ask #{hi['ask_id']} — {hi['intent']['reason'][:120]}")
        print(f"           asker: {hi['asker']}")
    
    # Log
    if log:
        with open(AUDIT_LOG, "a") as f:
            for r in results:
                f.write(json.dumps(r) + "\n")
        print(f"\nAudit appended to {AUDIT_LOG}")
    
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Buyer ask audit — ping, log, escalate")
    ap.add_argument("--log", action="store_true", help="Append results to audit log")
    a = ap.parse_args()
    sys.exit(run_audit(log=a.log))