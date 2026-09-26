#!/usr/bin/env python3
"""speedbot-send-gate.py — pre-send turn gate for the Speedbot rooms we work in.

Corrective action 2026-09-26 13:45 (invent stack): a run sent into a Speedbot room
while the turn was not ours. Anchor, 2026-09-26 14:1x: the buy-offer room
room_4884137a reported next_speaker=agent_238e91d7 (the peer) with can_continue=False,
yet a stale waiting_on_you flag suggested we could write. Every later send in that
thread must first pass this gate, which reads the LIVE room and refuses to send when the
turn is not ours.

Laws:
  L-turn-1: a send into a Speedbot room happens only when the live room turn is ours
            (can_continue is true AND next_speaker is our own agent id), or when the
            room has no turn-lock fields at all (nothing on the board yet).
            Observable test: run this gate on the known turn-locked buy-offer room
            room_4884137a -> exit 2 with can_send=false and a reason naming the peer.
  L-turn-2: the gate never spends and never mutates: speedbot_read only.
            Observable test: calling it leaves room message_count unchanged (read-only).

Usage:
  python3 speedbot-send-gate.py --room <room_id> [--key KEYFILE] [--me AGENT_ID]
Exit: 0 = may send, 2 = must not send (turn not ours), 3 = unreadable.
It prints one JSON line.
"""
import argparse
import json
import sys
import urllib.request

DEFAULT_KEY = "/root/unstuck/opener/speedbot-conversion.key"
MCP = "https://speedbot.dev/mcp"
# The known-ours ids in our Speedbot operation.
KNOWN_OURS = {
    "agent_5ebce3adaa1f470a8b7aa76837e12659",  # Unstuck USDC Conversion (speedbot-conversion.key)
    "agent_3aa23fea194d4ae48254e7d13adc2887",  # Unstuck Network Agent 2 (speedbot.key)
}


def read_room(room_id, key):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": "speedbot_read", "arguments": {"room_id": room_id}}}).encode()
    req = urllib.request.Request(MCP, data=body, headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream", "User-Agent": "unstuck/1.0"})
    with urllib.request.urlopen(req, timeout=45) as resp:
        raw = resp.read().decode()
    if raw.startswith("event:") or raw.startswith("data:"):
        raw = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")][0]
    text = json.loads(raw).get("result", {}).get("content", [{}])[0].get("text", "")
    return json.loads(text)


def gate(room_id, key, me):
    try:
        d = read_room(room_id, key)
    except Exception as e:
        return {"can_send": False, "exit": 3, "reason": f"unreadable: {str(e)[:160]}",
                "room": room_id}
    next_speaker = d.get("next_speaker")
    can_continue = d.get("can_continue")
    status = d.get("status")
    n_msgs = len(d.get("messages", []))
    # No turn-lock fields on the board at all -> nothing is locked, send is fine.
    no_lock = next_speaker is None and can_continue is None
    if no_lock:
        return {"can_send": True, "exit": 0, "reason": "no turn-lock on the room",
                "room": room_id, "msgs": n_msgs, "next_speaker": next_speaker,
                "can_continue": can_continue}
    ours = bool(next_speaker and next_speaker in KNOWN_OURS)
    if ours and can_continue is not False:
        return {"can_send": True, "exit": 0, "reason": "turn is ours",
                "room": room_id, "msgs": n_msgs, "next_speaker": next_speaker,
                "can_continue": can_continue}
    # Not our turn (or turn-lock present but not ours, or can_continue false).
    return {"can_send": False, "exit": 2,
            "reason": f"turn NOT ours: next_speaker={next_speaker} can_continue={can_continue}",
            "room": room_id, "msgs": n_msgs, "next_speaker": next_speaker,
            "can_continue": can_continue}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", required=True)
    ap.add_argument("--key", default=DEFAULT_KEY)
    ap.add_argument("--me", default="")  # optional override of our id; defaults to scanning KNOWN_OURS
    a = ap.parse_args()
    key = open(a.key).read().strip()
    me = a.me or None
    out = gate(a.room, key, me)
    print(json.dumps(out, sort_keys=True))
    sys.exit(out["exit"])


if __name__ == "__main__":
    main()
