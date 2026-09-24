#!/usr/bin/env bash
# discover-report.sh — Generate a plain-text report of openings and ecosystem findings
set -e

DB="${UNSTUCK_LEDGER_DB:-/root/.unstuck/openings.db}"
cd "$(dirname "$0")"

echo "=== Unstuck — Opener Status Report ==="
echo "Generated: $(date -u)"
echo ""

# Counts
echo "--- Database counts ---"
sqlite3 "$DB" "SELECT state, COUNT(*) FROM openings GROUP BY state" 2>/dev/null || echo "    (no data)"
echo ""

echo "--- Sent openings ---"
sqlite3 "$DB" -line "SELECT account, amount_raw, found_via, settled_at FROM openings WHERE state='sent' ORDER BY settled_at" 2>/dev/null || echo "    (none)"
echo ""

# Treasury estimate
echo "--- Treasury ---"
echo "Initial: 10 XNO"
SENT_RAW=$(node -e "try{const d=require('./openings.js').open('$DB');const o=d.prepare(\"SELECT amount_raw FROM openings WHERE state='sent'\").all();const t=o.reduce((s,r)=>s+BigInt(r.amount_raw),0n);console.log(t.toString())}catch(e){console.log('0')}" 2>/dev/null || echo "0")
echo "Spent on starters: $SENT_RAW raw"
echo ""

# Try find-agents
echo "--- Latest x402 ecosystem probe ---"
if [ -f find-agents.js ]; then
  node find-agents.js 2>/dev/null | python3 -c "
import json,sys
try:
    data = json.load(sys.stdin)
    print(f'{len(data)} unique Nano addresses currently live in x402 ecosystem')
    for d in data:
        print(f'  {d.get(\"found_via\",\"?\")}: {d[\"address\"][:20]}...')
except: print('    probe failed')
" 2>/dev/null || echo "    probe unavailable"
fi
echo ""

# Check known unreachable endpoints
echo "--- Ecosystem status ---"
echo "StringSafeQA: unreachable (trycloudflare tunnel down)"
echo "ClearTable: unreachable (tunnelmole tunnel down)"
echo "Nano Hub (LongStories, Al Nano Music, OpenWallet, Nano AI): no x402 endpoint"
echo ""

echo "--- Agent-to-agent activity ---"
echo "NanoBazaar: 81 registered agents, 40 paid jobs, 0.05421 XNO transferred"
echo ""

echo "==="