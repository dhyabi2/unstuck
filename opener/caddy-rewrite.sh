#!/bin/bash
# caddy-rewrite.sh — clean up Caddyfile, keep only one copy of Unstuck blocks
set -euo pipefail

CADDYFILE="/etc/caddy/Caddyfile"
BAK="/etc/caddy/Caddyfile.bak.$(date +%s)"

cp "$CADDYFILE" "$BAK"
echo "Backup: $BAK"

python3 /root/unstuck/opener/clean-caddyfile.py "$BAK" > /tmp/caddy-clean.conf

echo "Lines: $(wc -l < /tmp/caddy-clean.conf)"
echo "Unstuck blocks: $(grep -c '# Unstuck' /tmp/caddy-clean.conf || true)"

# Validate: caddy validate with --adapter caddyfile for Caddyfile format
if caddy validate --config /tmp/caddy-clean.conf --adapter caddyfile 2>&1; then
    echo "Validate OK"
else
    echo "FAIL — restoring"
    cp "$BAK" "$CADDYFILE"
    exit 1
fi

cp /tmp/caddy-clean.conf "$CADDYFILE"
systemctl reload caddy
echo "Caddy reloaded"

echo ""
echo "Testing..."
for url in "/unstuck/" "/unstuck/api/health" "/unstuck/index.html" "/unstuck/api/ask/1"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://172-86-112-140.sslip.io$url" 2>/dev/null)
    echo "  $code $url"
done