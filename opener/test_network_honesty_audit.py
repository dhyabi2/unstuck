#!/usr/bin/env python3
"""test_network_honesty_audit.py — the observable test for the settlement-counting rule.

Law: a settlement is counted in `unstuck-bridge network`'s honest view only when its block hash is a real
Nano block hash. A row marked `paid` whose block is a placeholder (or absent) is reported as unverified and
never as settled.

The test fails on the code that shipped before Block 146: the old rule counted any non-empty
`settlement_block`, so a row carrying 64 'A' characters read as a settled payment.
"""
import os
import sqlite3
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIT = os.path.join(HERE, "network-honesty-audit.py")
sys.path.insert(0, HERE)

import importlib.util

spec = importlib.util.spec_from_file_location("audit", AUDIT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("PASS " if cond else "FAIL ") + name + ((" — " + detail) if detail and not cond else ""))


# --- the rule itself, including the mutation that must go red -------------------------------------------------
check("placeholder of 64 A's is NOT a block", audit.real_block("A" * 64) is False)
check("empty string is NOT a block", audit.real_block("") is False)
check("None is NOT a block", audit.real_block(None) is False)
check("short hex is NOT a block", audit.real_block("abc123") is False)
check("non-hex 64 chars is NOT a block", audit.real_block("Z" * 64) is False)
REAL = "CA31E146B95D3F54E1369F627CD148D4F4AAA80384C61FBFC75BF6394EBE559A"
check("a real block hash IS a block", audit.real_block(REAL) is True)
check("lower-case real hash IS a block", audit.real_block(REAL.lower()) is True)

# A constant function would pass the placeholder cases and fail this one, so the pair is a real comparison.
check("real_block is not a constant", audit.real_block(REAL) != audit.real_block("A" * 64))

# --- the audit against a store that reproduces the measured defect --------------------------------------------
tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "network.db")
c = sqlite3.connect(db)
c.execute("CREATE TABLE asks (id INTEGER PRIMARY KEY, asker TEXT, title TEXT, status TEXT, settlement_block TEXT)")
c.execute("INSERT INTO asks VALUES (544,'nano_1us','security-assessment test ask','paid',?)", ("A" * 64,))
c.execute("INSERT INTO asks VALUES (474,'nano_1us','SPA end-to-end verification','paid',NULL)")
c.execute("INSERT INTO asks VALUES (543,'nano_1outside','Reliable agent-to-agent settlement','open',NULL)")
c.commit()
c.close()

out = subprocess.run([sys.executable, AUDIT, "--json", "--db", db], capture_output=True, text=True, timeout=60)
import json
res = json.loads(out.stdout)
check("strict settled count is 0", res["settled_on_chain_strict"] == 0, str(res.get("settled_on_chain_strict")))
check("bridge-rule count would be 1 (the defect)", res["settled_on_chain_bridge_rule"] == 1)
check("unverified rows are named (2)", res["settled_unverified"] == 2, str(res.get("settled_unverified")))
check("verdict says no settlement may be claimed", "no settlement may be claimed" in res["verdict"].lower())

print(f"\n{len(PASS)}/{len(PASS) + len(FAIL)} pass")
sys.exit(1 if FAIL else 0)