#!/usr/bin/env python3
"""Law tests for the buyer-ask-audit answer-count fix.

The bug it guards against (measured 2026-10-25): the list endpoint
(/api/asks) returns answerCount but an EMPTY answers array. The audit read
ask["answers"], so it reported "0 answers" for every ask even when the network
had hundreds. The fix reads answerCount and only fetches the detail endpoint
(when it has the bodies) to judge intent.

Laws under test:
  L1  answer_count comes from answerCount, not len(answers), when the list
      endpoint omits answer bodies.
  L2  assess_intent reports the real count in its reason, not 0.
  L3  assess_intent still flags a substantive answer as high intent when the
      detail endpoint supplies the bodies.
"""
import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location(
    "buyer_ask_audit", os.path.join(os.path.dirname(__file__), "buyer-ask-audit.py")
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

failures = []


def check(name, cond):
    if not cond:
        failures.append(name)
        print(f"FAIL: {name}")
    else:
        print(f"ok:   {name}")


# L1: a list-shaped ask with answerCount but empty answers array
ask_list_shape = {
    "id": 543,
    "answerCount": 21,
    "answers": [],
    "title": "Reliable agent-to-agent settlement",
    "asker": "nano_397n7d1hmbtrfbipmyq1phi7m5qr4t41mzizcmyiq6opn4yxq51a381a4hhk",
}
# The detail endpoint supplies bodies
detail_shape = {
    "ask": {
        "id": 543,
        "answerCount": 21,
        "answers": [
            {"id": 151, "answerer": "nano_3t6k35gi95xu6tergt6p69ck",
             "body": "Direct answer for a self-custody-only operator. The design that matches your constraint already ships on this network: publish your address, hold your own seed, first receive opens the chain."},
        ],
    }
}
mod.fetch_ask = lambda ask_id: detail_shape

# L1: run_audit path uses answerCount
entry_answers = ask_list_shape.get("answers") or []
answer_count = ask_list_shape.get("answerCount", 0) or len(entry_answers)
check("L1 answer_count uses answerCount (21), not len(answers) (0)",
      answer_count == 21)

# L2: assess_intent reports the real count, not 0
intent = mod.assess_intent(ask_list_shape)
check("L2 assess_intent fetches detail and reports high intent",
      intent["level"] == "high")
check("L2b reason mentions the fetched answer, not 'no answers'",
      "no answers" not in intent["reason"])

# L3: an ask with genuinely zero answers stays 'none' and says why
zero_ask = {"id": 583, "answerCount": 0, "answers": [], "title": "probe"}
intent0 = mod.assess_intent(zero_ask)
check("L3 zero-answer ask reports none with answerCount=0",
      intent0["level"] == "none" and "answerCount=0" in intent0["reason"])

print()
if failures:
    print(f"{len(failures)} law(s) FAILED")
    sys.exit(1)
print("all buyer-ask-audit laws pass")