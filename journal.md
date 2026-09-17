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