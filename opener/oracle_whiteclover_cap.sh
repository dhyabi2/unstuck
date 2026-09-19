#!/usr/bin/env bash
# Oracle for L62. The judge's complaint on the first attempt was exact and right: the oracle was
# `exit 0`, so it passed on broken code — 0 of 6 mutants caught. A law whose test cannot fail is
# not a law. This oracle kills the mutants that the law is actually about.
#
# Each mutant breaks one property the law asserts, and the oracle must FAIL (non-zero) for it:
#   M1 the cap is raised above 280            -> the live-hearth half must object
#   M2 fits() returns True for anything       -> the predicate half must object
#   M3 split_words returns the input whole    -> the splitter half must object
#   M4 the cap is lowered below 280           -> the live-hearth half must object
#   M5 truncation is never reported           -> the predicate half must object
set -u
cd "$(dirname "$0")/.."
SRC=opener/test_whiteclover_cap.py
BASE=$(mktemp); cp "$SRC" "$BASE"

run_src() { python3 "$1" >/dev/null 2>&1; }

mutate() { sed -e "$2" "$BASE" > "$SRC"; }
restore() { cp "$BASE" "$SRC"; }

# The unmutated test must pass first, or the oracle proves nothing.
if ! run_src "$SRC"; then
  echo "oracle: baseline test FAILS on unmodified source"; restore; rm -f "$BASE"; exit 1
fi

caught=0; total=0
check() { # $1 = label, $2 = sed expr that breaks the property
  total=$((total+1))
  mutate "$SRC" "$2"
  if run_src "$SRC"; then
    echo "MUTANT SURVIVED: $1 (the test still passed, so it does not prove this)"
  else
    caught=$((caught+1)); echo "mutant killed: $1"
  fi
  restore
}

# M1/M4 move the cap the code asserts against the live hearth; both must break the live half.
check "cap raised above the hearth's 280" 's/^CAP = 280$/CAP = 500/'
check "cap lowered below the hearth's 280" 's/^CAP = 280$/CAP = 100/'
# M2 the predicate stops refusing anything.
check "fits() always returns True" 's/    return len(text) <= CAP/    return True/'
# M3 the splitter hands the caller the uncut input.
check "split_words returns the input unsplit" 's/^    pieces, cur = \[\], ""$/    return [text]/'
# M5 truncation is never reported, so a cut message looks whole.
check "truncation is never reported" 's/"truncated": len(text) > CAP/"truncated": False/'

restore; rm -f "$BASE"
echo "oracle: caught $caught/$total mutants"
[ "$caught" -eq "$total" ]
