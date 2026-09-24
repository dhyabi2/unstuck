#!/bin/bash
# deploy-unstuck-gateway.sh — deploy the Unstuck HTTPS gateway (idempotent)
#
# Prerequisites: Caddy installed on the box, serving at 172-86-112-140.sslip.io
#
# This script:
#   1. Copies site files to /var/www/unstuck (caddy-readable)
#   2. Removes any existing Unstuck blocks from Caddyfile
#   3. Inserts fresh Unstuck blocks before the catch-all handle
#   4. Reloads Caddy
#
# Usage: sudo bash deploy-unstuck-gateway.sh

set -euo pipefail

SITE_SRC="/root/unstuck/site"
SITE_DST="/var/www/unstuck"
CADDYFILE="/etc/caddy/Caddyfile"
CADDYFILE_BAK="/etc/caddy/Caddyfile.bak.$(date +%s)"

echo "[1/4] Copying site files to caddy-accessible location..."
mkdir -p "$SITE_DST"
cp -r "$SITE_SRC"/* "$SITE_DST/"
chown -R caddy:caddy "$SITE_DST"
echo "      files deployed to $SITE_DST"

echo "[2/4] Backing up current Caddy config..."
cp "$CADDYFILE" "$CADDYFILE_BAK"
echo "      backed up to $CADDYFILE_BAK"

echo "[3/4] Removing old Unstuck blocks and inserting fresh config..."
awk '
# Skip lines between old Unstuck comment lines and the next handle block
/^# Unstuck — SPA frontend/ { skip = 1; next }
/^# Unstuck — API reverse proxy/ { next }
skip && /^\thandle / { skip = 0 }
skip { next }

# Before the default catch-all handle, insert Unstuck blocks
/^\thandle \/$/ || /^\thandle \{/ {
    print ""
    print "	# Unstuck — SPA frontend"
    print "	handle_path /unstuck/* {"
    print "		root * /var/www/unstuck"
    print "		header Cache-Control \"no-cache, must-revalidate\""
    print "		try_files {path} /index.html"
    print "		file_server"
    print "	}"
    print ""
    print "	# Unstuck — API reverse proxy"
    print "	handle_path /unstuck/api/* {"
    print "		uri strip_prefix /unstuck/api"
    print "		reverse_proxy 127.0.0.1:4310"
    print "	}"
    print ""
    print "	# Default catch-all (originally at this position)"
}
{ print }
' "$CADDYFILE_BAK" > "$CADDYFILE"

echo "[4/4] Validating and reloading Caddy..."
if caddy validate --config "$CADDYFILE" 2>/dev/null; then
    systemctl reload caddy || caddy reload --config "$CADDYFILE"
    echo "      Caddy reloaded successfully."
else
    echo "      ERROR: Caddy config validation failed. Restoring backup..."
    cp "$CADDYFILE_BAK" "$CADDYFILE"
    echo "      Restored. Check config for errors."
    exit 1
fi

echo ""
echo "Done. Unstuck gateway should now be accessible at:"
echo "  https://172-86-112-140.sslip.io/unstuck/          → SPA frontend"
echo "  https://172-86-112-140.sslip.io/unstuck/api/health → API health check"