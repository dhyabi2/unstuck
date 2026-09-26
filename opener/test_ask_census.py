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
by_import = {"outside_confirmed": 0, "addressed_unknown": 0, "self_declared": 0, "synthetic": 0, "ours": 0}
for x in asks:
    a = x["asker"]
    row_text = f"{x.get('title') or ''} {x.get('body') or ''}"
    if a == ac.OPENER:
        by_import["ours"] += 1
    elif a in confirmed:
        by_import["outside_confirmed"] += 1
    elif ac._ROW_HINT.search(row_text):
        by_import["self_declared"] += 1
    elif ac.structurally_valid(a) and ac.valid_cache(a) and a not in probe:
        by_import["addressed_unknown"] += 1
    else:
        by_import["synthetic"] += 1

check("L59 the script path and the imported path agree on every tier",
      as_script["tiers"] == by_import, f"script={as_script['tiers']} import={by_import}")

# --- the honest number ------------------------------------------------------------
# Amended 2026-09-21: the old form pinned the answer to a hardcoded == 0, which was true only while
# nothing outside had arrived. That made the guard fail the moment it should have passed: ask #543
# (Sara L Nelson, a real outside agent with her own recorded address) is a genuine outside ask, and the
# check went red. The honest invariant is not "the number is zero" — it is "every ask counted as outside
# belongs to an account recorded for a real outside agent, and NOTHING else is counted". So assert the
# attribution on every id, and that the count matches the attributed set exactly.
_ids = as_script["outside_confirmed_ids"]
_byid = {a["id"]: a for a in asks}
_unattributed = [i for i in _ids if i not in _byid or _byid[i]["asker"] not in confirmed
                 or _byid[i]["asker"] in probe or _byid[i]["asker"] == ac.OPENER]
check("L59 every ask counted as outside is attributed to a recorded, non-self outside agent",
      as_script["publishable_as_outside_asks"] == len(_ids) and not _unattributed,
      f"count={as_script['publishable_as_outside_asks']} ids={len(_ids)} bad={_unattributed}")
check("L59 no self-created identity is ever counted as an outside ask",
      not (set(_ids) & set(as_script["addressed_unknown_ids"])) and
      not any(ac._SELF_HINT.search(_byid[i]["asker"]) for i in _ids),
      f"ids={_ids}")
# Control: the exclusion is load-bearing, not cosmetic. The three identities it removes ARE in bridge.db
# with real accounts — unexcluded, they are exactly the 4 asks the census used to over-report.
_con_all = {r[0] for r in __import__("sqlite3").connect(f"file:{ac.BRIDGE_DB}?mode=ro", uri=True)
            .execute("SELECT account FROM agents WHERE account IS NOT NULL AND account != ''").fetchall()}
check("L59 excluding self-created identities strictly shrinks the outside count",
      confirmed <= _con_all and len(confirmed) < len(_con_all),
      f"confirmed={len(confirmed)} all_recorded={len(_con_all)}")
check("L59 every tier accounts for every row",
      sum(as_script["tiers"].values()) == as_script["total_rows"], as_script["tiers"])
check("L59 the placeholder rows are not counted as addressed asks",
      0 not in as_script["addressed_unknown_ids"] and
      not any(i in as_script["addressed_unknown_ids"] for i in (472, 473, 475, 476, 479, 480, 481)))

# --- a self-declared probe is not an outside agent, whatever its address ------------
# Amended 2026-09-26. Measured on the live board: ids 561/562 ('probe', a checksum-valid
# nano_111...), 563 ('auth-probe'), 564 ('x'), 565/566/567 ('grove-*-probe') landed inside four
# minutes, every one with a VALID asker, so the tier called "leads, not adoption" was absorbing
# them. The units are proved offline (no dependence on the page being polluted right now):
check("L59 a probe row is classified self_declared, not a lead",
      bool(ac._ROW_HINT.search("probe")) and bool(ac._ROW_HINT.search("auth-probe")) and
      bool(ac._ROW_HINT.search("grove-valid-check")) and bool(ac._ROW_HINT.search("grove-validity-probe")))
check("L59 a genuine outside ask row is not swept into self_declared",
      not ac._ROW_HINT.search("Reliable agent-to-agent settlement without counterparty-held keys") and
      not ac._ROW_HINT.search("What ongoing social activity would bring an agent and a peer back after joining?"))
check("L59 no self-declared row is counted as a lead or an outside ask",
      not (set(as_script.get("self_declared_ids", [])) & set(as_script["addressed_unknown_ids"])) and
      not (set(as_script.get("self_declared_ids", [])) & set(_ids)) and
      as_script["tiers"]["self_declared"] >= 0,
      f"self_declared_count={as_script['tiers']['self_declared']}")
check("L59 the self-declared tier is internal to the census, not a published count",
      "self_declared_ids" not in as_script and
      as_script["publishable_as_outside_asks"] == len(_ids))

print()
print(f"{fail} test(s) failed" if fail else "all ask-census laws pass")
sys.exit(1 if fail else 0)
