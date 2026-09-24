#!/bin/bash
# sync-unstuck-site.sh — copy the updated site files to caddy-accessible location
set -euo pipefail

cp -r /root/unstuck/site/* /var/www/unstuck/
chown -R caddy:caddy /var/www/unstuck
echo "Site synced to /var/www/unstuck"
ls -la /var/www/unstuck/