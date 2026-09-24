#!/usr/bin/env bash
# Oracle for Block 125: the python receive tool and the onramp receive instruction.
set -e
cd "$(dirname "$0")/.."
PY_OUT=$(python3 opener/test_nano_receive.py)
echo "$PY_OUT" | grep -q "10 passed, 0 failed" || { echo "FAIL: python test not green"; exit 1; }
echo "$PY_OUT" | grep -q "ok  block hash matches nanocurrency hashBlock" || { echo "FAIL: block hash oracle missing"; exit 1; }
# onramp step 3 must carry a runnable receive command
NODE_OUT=$(node -e "const o=require('./opener/onramp.js');const d=o.onrampDoc({apiBase:'https://getunstuck.space/unstuck/api'});const s=d.steps.find(x=>x.n===3);console.log((s.command||'')+(s.full_tool||''));")
echo "$NODE_OUT" | grep -q "nano-x402-client.js --receive" || { echo "FAIL: onramp step3 lacks receive command"; exit 1; }
echo "block-125 oracle PASS"
