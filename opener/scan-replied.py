#!/usr/bin/env python3
"""
scan-replied.py — scan replied conversations for unresolved questions (corrective #1).

Mines bridge.db for conversations in 'replied' status, extracts the last message
from the agent (direction='in'), and checks if it contains a question, a proposal
or an unresolved thread that needs a follow-up.

Usage: python3 opener/scan-replied.py [--json]
"""
import json
import sqlite3
import sys
import time

DB = "/root/unstuck/opener/bridge.db"

QUESTION_MARKERS = [
    "?", "please", "could you", "will you", "would you", "can you",
    "proposal", "suggest", "alternate", "alternative", "what about",
    "how about", "your turn", "next_speaker", "awaiting", "pending",
    "you answer", "respond", "confirm", "please check", "let me know",
    "are you", "do you", "does that", "is that", "would that",
]

STALL_MARKERS = [
    "reading back", "AWAITING_HUMAN", "not_found", "404", "cannot post",
    "lost", "unreachable", "403", "not_participant", "static",
    "template", "no conversable",
]

def connect():
    return sqlite3.connect(DB)

def scan(db):
    now = time.time()
    replied = list(db.execute(
        "SELECT agent, status, pays_in, source_url FROM agents WHERE status='replied'"
    ))
    results = []
    for agent, status, pays_in, source in replied:
        # Last message from the agent (direction='in')
        last_in = db.execute(
            "SELECT text, at FROM messages WHERE agent=? AND direction='in' ORDER BY id DESC LIMIT 1",
            (agent,)
        ).fetchone()
        # Last message we sent (direction='out')
        last_out = db.execute(
            "SELECT text, at FROM messages WHERE agent=? AND direction='out' ORDER BY id DESC LIMIT 1",
            (agent,)
        ).fetchone()

        # Check agreements
        has_agreement = db.execute(
            "SELECT 1 FROM agreements WHERE agent=? ORDER BY id DESC LIMIT 1", (agent,)
        ).fetchone() is not None

        told_after = None
        if last_out and last_in:
            # Did we say something after their last reply?
            told_after = last_out[1] > last_in[1]
        responded = bool(last_in)
        last_text = last_in[0].lower() if last_in else ""
        quiet = now - (last_in[1] if last_in else (last_out[1] if last_out else now))

        # Classify state
        has_question = any(m in last_text for m in QUESTION_MARKERS) if last_in else False
        is_stalled = any(m in last_text for m in STALL_MARKERS) if last_in else False
        needs_followup = responded and not told_after and not is_stalled

        results.append({
            "agent": agent,
            "pays_in": pays_in,
            "source": source,
            "responded": responded,
            "has_agreement": has_agreement,
            "we_answered_last": bool(told_after),
            "they_have_unanswered_question": has_question and not told_after,
            "needs_followup": needs_followup,
            "is_stalled": is_stalled,
            "quiet_hours": round(quiet / 3600, 1),
            "last_heard_preview": (last_in[0][:200] if last_in else ""),
            "suggested_action": "",
        })

    for r in results:
        if r["needs_followup"] and not r["has_agreement"]:
            r["suggested_action"] = "FOLLOW_UP: they answered and we haven't replied yet"
        elif r["they_have_unanswered_question"]:
            r["suggested_action"] = "ANSWER_QUESTION: they asked something we haven't answered"
        elif r["is_stalled"]:
            r["suggested_action"] = "STALLED: technical block, need workaround"
        elif r["has_agreement"]:
            r["suggested_action"] = "RESOLVED: agreement recorded, natural pause"
        elif not r["responded"]:
            r["suggested_action"] = "NO_REPLY: they never answered, re-engage?"
        else:
            r["suggested_action"] = "WAITING: ball is in their court"

    # Sort: needs followup first, then unanswered questions, then stalled
    results.sort(key=lambda r: (
        0 if r["needs_followup"] else
        1 if r["they_have_unanswered_question"] else
        2 if r["is_stalled"] else
        3 if r["has_agreement"] else 4
    ))
    return results

def main():
    want_json = "--json" in sys.argv
    db = connect()
    results = scan(db)
    if want_json:
        print(json.dumps(results, indent=1, ensure_ascii=False))
    else:
        print(f"--- Replied Conversations Scan ({len(results)} total) ---")
        for r in results:
            flag = {
                "FOLLOW_UP": "!!",
                "ANSWER_QUESTION": "??",
                "STALLED": "XX",
                "RESOLVED": "OK",
                "NO_REPLY": "--",
                "WAITING": "..",
            }.get(r["suggested_action"][:9].strip(), "??")
            print(f"\n[{flag}] {r['agent']} ({r['pays_in']}) — {r['suggested_action']}")
            print(f"     Source: {r['source']}")
            print(f"     Quiet: {r['quiet_hours']}h | We answered last: {r['we_answered_last']}")
            if r["last_heard_preview"]:
                print(f"     Last: {r['last_heard_preview'][:160]}")
        print(f"\n--- Summary ---")
        for k in ("needs_followup", "they_have_unanswered_question", "is_stalled", "has_agreement"):
            count = sum(1 for r in results if r[k])
            print(f"  {k}: {count}")

if __name__ == "__main__":
    sys.exit(main())
