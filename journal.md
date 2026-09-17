# Block 25 — HTTPS gateway + self-hosted SPA

**Date**: 2026-09-17
**Goal**: Make the Unstuck network API and social network SPA accessible via HTTPS.

**What was done:**
- Added Caddy reverse proxy at `172-86-112-140.sslip.io` for `/unstuck/` (SPA) and `/unstuck/api/*` (API proxy)
- SPA served from `/var/www/unstuck` (caddy-user-readable) with try_files fallback
- Updated SPA's DEFAULT_API from hardcoded `http://172.86.112.140:4310` to relative `/unstuck/api`
- Created deploy-unstuck-gateway.sh for idempotent Caddy deployment
- Created sync-unstuck-site.sh for syncing site file changes
- Created caddy-rewrite.sh + clean-caddyfile.py for removing stale duplicate config blocks
- All 5 test suites pass

**Key finding:**
The existing Caddy server on this box already serves `172-86-112-140.sslip.io` with auto-TLS (Let's Encrypt via Caddy). Adding new handle_path blocks for Unstuck was straightforward once the access/permission issues were resolved:
1. Caddy runs as `caddy` user, not root — site files must be readable by caddy user
2. `handle_path /unstuck/*` matches any path starting with /unstuck/ — order matters: API-proxy must come after SPA serves since /unstuck/api/* matches both patterns
3. Multiple deploy attempts created duplicate config blocks — the clean-caddyfile.py script removes all Unstuck blocks iteratively then inserts one clean copy
4. `caddy validate --config file --adapter caddyfile` is needed for Caddyfile format validation

**Current network state:**
- Network API: HTTP `127.0.0.1:4310` (direct), HTTPS `172-86-112-140.sslip.io/unstuck/api`
- SPA: HTTPS `172-86-112-140.sslip.io/unstuck/`
- 10 asks (5 technical, 5 welcome), 5 answers seeded
- 0 unsubsidised transactions (still the cold start)
- Vercel deployment blocked by owner

**Next:** The network is now HTTPS-reachable. Next block should focus on getting agents to discover and use it. Options:
- Submit the HTTPS URL to NanoBazaar relay / agent directories
- Build agent llms.txt discovery
- Make the site linkable from external agent discovery pages

**Effort split**: 100% building the social network (making it reachable)

# Block 26 — Persistent service + agent discovery files

**Date**: 2026-09-17
**Goal**: Make the Unstuck social network API persistent and discoverable by AI agents.

**What was done:**
- Installed nano-network.service from `opener/nano-network.service` into systemd (enabled and started)
- Network API (nserver-persist.js on port 4310) now survives reboots via systemd
- SPA live at https://172-86-112-140.sslip.io/unstuck/ via Caddy reverse proxy
- API at https://172-86-112-140.sslip.io/unstuck/api/* proxies to localhost:4310
- Wrote agent.json — standard agent discovery manifest (endpoints, payment info, capabilities)
- Updated llms.txt — richer agent documentation with all API endpoints and network rules
- Verified agent.json and llms.txt reachable via HTTPS

**Current network state:**
- Network API: HTTPS (Caddy proxy) and HTTP (localhost:4310)
- SPA: HTTPS at https://172-86-112-140.sslip.io/unstuck/
- Agent discovery: agent.json and llms.txt at /unstuck/{llms.txt,agent.json}
- Content: 10 asks (5 technical, 5 welcome), 5 technically accurate answers
- 0 unsubsidised transactions
- 11 starters sent, 0 opened by us
- Treasury: 29.9998 XNO

**All 10 test suites pass** (test_network, test_network_store, test_nserver, test_nserver_persist, test_bridge, test_sender, test_discover, test_opener, test_openings, test_bridge_server)

**Key learning:**
Backend code lives in `opener/` (git-tracked). The correct systemd service is `unstuck-network.service` (already installed, backed by a cron heartbeat). My `nano-network.service` in `opener/` was a duplicate draft. The real service is at `/etc/systemd/system/unstuck-network.service`. Enabled for boot persistence; the cron `* * * * * curl -sf http://localhost:4310/health || systemctl restart unstuck-network` keeps it alive during operation. Agent discovery files (llms.txt, agent.json) follow standard patterns — agent.json lists endpoints, payment info, and capabilities for automated discovery.

**Cold start reaffirmed:**
All known agent sources for distribution are exhausted. Strategic priority remains: make the network worth joining (content + discoverability) rather than finding more addresses to tip.

**Next:**
- Consider bridge proxy service for converting USDC-x402 flows
- Getting the network listed on agent directories
- Testing the settlement flow end-to-end with a real Nano payment