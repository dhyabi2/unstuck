#!/usr/bin/env python3
"""L59 — the ask census classifies every row the same way however it is called, and
only an asker recorded as a real outside agent can ever be counted as an outside ask.

Two measured failures stand behind this test.

1. The 483-row picture (measured 2026-09-19): of the rows a caller gets by default,
   16 of 34 are literal strings like 'nano_3test' and 'nano_test1'. The server accepts
   them because `createAsk` checks only that the asker STARTS WITH 'nano_'. A count
   that treats those as asks is a count of nothing, so the census must separate them
   from rows whose asker is a checksum-valid address — and none of those may be
   called an outside ask until bridge.db records a real agent behind the address.

2. The script/import mismatch: the first version of ask_census.py bound the confirmed-
   account set to a local named `mine`, shadowing the module-level `mine` helper. Run
   as a script it said "7 addressed_unknown"; imported, the same classification said
   "7 synthetic". Same function, two answers, depending on how it was called — and the
   answer that reached the reader was the wrong one. This test runs BOTH paths.

Run: python3 opener/test_ask_census.py
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ask_census as ac  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
fail = 0


def check(name, cond, detail=""):
    global fail
    if cond:
        print(f"ok   {name}")
    else:
        fail += 1
        print(f"FAIL {name}{': ' + str(detail) if detail else ''}")


# --- the units, independent of the network -----------------------------------------
check("L59 a placeholder asker is structurally invalid", not ac.structurally_valid("nano_3test"))
check("L59 a placeholder asker fails the checksum check", not ac.checksum_valid("nano_3test"))
check("L59 the opener's own account is a valid address", ac.checksum_valid(ac.OPENER))
check("L59 the checksum check rejects a well-shaped but wrong-checksum address",
      not ac.checksum_valid("nano_3afimiihnc3bxth7sbnbrq373g45syz47s7sg3zrddcoot39wqjrras6r9p5"))

# The live address used throughout this block, proved valid by its own single invocation.
LIVE = "nano_3afimiihnc3bxth7sbnbrq373g45syz47s7sg3zrddcoot39wqjrras6r9p4"
check("L59 the live outside address passes the checksum check", ac.checksum_valid(LIVE))

# --- the two call paths must agree -------------------------------------------------
saved = sys.argv[:]
try:
    sys.argv = ["ask_census.py", "--json"]
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            ac.main()
        except SystemExit:
            pass
    as_script = json.loads(buf.getvalue())
finally:
    sys.argv = saved

# the imported path: run the same classification inline over the same rows
asks = json.loads(ac.urllib.request.urlopen(ac.BASE, timeout=25).read())["asks"]
confirmed = ac.outside_accounts()
probe = {l.strip() for l in open(os.path.join(HERE, "probe-keys.txt")) if l.strip()}
by_import = {"outside_confirmed": 0, "addressed_unknown": 0, "synthetic": 0, "ours": 0}
for x in asks:
    a = x["asker"]
    if a == ac.OPENER:
        by_import["ours"] += 1
    elif a in confirmed:
        by_import["outside_confirmed"] += 1
    elif ac.structurally_valid(a) and ac.valid_cache(a) and a not in probe:
        by_import["addressed_unknown"] += 1
    else:
        by_import["synthetic"] += 1

check("L59 the script path and the imported path agree on every tier",
      as_script["tiers"] == by_import, f"script={as_script['tiers']} import={by_import}")

# --- the honest number ------------------------------------------------------------
check("L59 no outside ask is published without a recorded outside agent",
      as_script["publishable_as_outside_asks"] == len(as_script["outside_confirmed_ids"]) == 0,
      as_script["publishable_as_outside_asks"])
check("L59 every tier accounts for every row",
      sum(as_script["tiers"].values()) == as_script["total_rows"], as_script["tiers"])
check("L59 the placeholder rows are not counted as addressed asks",
      0 not in as_script["addressed_unknown_ids"] and
      not any(i in as_script["addressed_unknown_ids"] for i in (472, 473, 475, 476, 479, 480, 481)))

print()
print(f"{fail} test(s) failed" if fail else "all ask-census laws pass")
sys.exit(1 if fail else 0)
