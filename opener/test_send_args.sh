#!/usr/bin/env bash
# L58 — the send path never mistakes a flag for an address.
#
# Measured 2026-09-19: send.js took `args[0]` as the address, so the documented form
# `send.js --dry-run <addr>` passed the FLAG to checkAddress and refused a correct
# address with "not a valid Nano address". The guard held — nothing was broadcast —
# but it blamed the caller's address, which is the worst kind of refusal.
#
# This test uses a FRESH address each run, because the dry run must be exercisable
# without depending on the ledger being empty: a previously-opened address refuses
# earlier, by the once-per-agent rule, and would hide what is being tested.
set -u
cd "$(dirname "$0")"
A=$(python3 nano-keygen.py --address-only)
fail=0
parse() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d['dry_run'],d['would_open'],d['amount_raw'],d['work_validated'])"; }

X=$(node send.js --dry-run "$A" 2>&1 | parse) || true
Y=$(node send.js "$A" --dry-run 2>&1 | parse) || true
[ "$X" = "$Y" ] || { echo "FAIL flag orders disagree: [$X] vs [$Y]"; fail=1; }
[ "$X" = "True $A 10000000000000000000000000 True" ] || { echo "FAIL unexpected dry-run output: [$X]"; fail=1; }

Z=$(node send.js --dry-run nano_notanaddress 2>&1)
[ "$Z" = "refused: not a valid Nano address" ] || { echo "FAIL a bad address is not refused by name: [$Z]"; fail=1; }

W=$(node send.js --dry-run nano_3afimiihnc3bxth7sbnbrq373g45syz47s7sg3zrddcoot39wqjrras6r9p4 2>&1)
case "$W" in
  refused:\ already\ sent*) ;;
  *) echo "FAIL the once-per-agent guard no longer fires: [$W]"; fail=1;;
esac

[ "$fail" = 0 ] && echo "L58 PASS: both flag orders dry-run identically ($X); a bad address is refused by name; the once-per-agent guard still fires"
exit $fail
