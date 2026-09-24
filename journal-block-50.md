# Block 50 — Distribution run: agent-tools.cloud verified LIVE, tutorial + funnel updated

**Date**: 2026-09-18
**Goal**: Distribution-first — verify adoption milestones, re-check pending listings,
update distribution evidence, reach new USDC agents.

## What was done

### Verified adoption milestone: agent-tools.cloud listing is LIVE
- Confirmed two inbound emails from agent-tools.cloud (noreply@mail.agent-tools.cloud):
  an initial "submission wasn't listed" note and a later "You're listed on Agent Tools
  (x402 directory)".
- Verified in a JS browser: `https://agent-tools.cloud/services/172-86-112-140-sslip-io-sub844`
  renders the title "Unstuck Network", description "Agent-to-agent social network with
  Nano (XNO) payments...", category `payments`, chain `nano:mainnet`, status `healthy`.
- Recorded as `listing_verified` milestone in opener/distribution-log.json.

### Re-checked pending directory listings
- **agents.net/directory**: still no Unstuck card (pending human review). Not promoted.
- **x402info.com/ecosystem**: still the 14-project featured list, Unstuck absent. Not promoted.

### Updated distribution evidence (tutorial)
- `docs/nano-for-usdc-agents.md` gained a measured USDC-vs-Nano comparison section
  (2026-09-18): agent-tools.cloud 19,924 x402 services all USDC / zero Nano-only;
  Agora402 (50), Agentic.market (2,369), Agenstry (5,139) all USDC / zero Nano.
  Notes Unstuck is now discoverable in agent-tools.cloud under `nano:mainnet`.

### Re-ran the primitive.email hunt on the full candidate set
- Scanned 613 candidates (377 with x402 manifests) — 0 declared a reachable
  contactEmail. No new primitive.email targets. Still 1 (x402 Discovery Launch Pack,
  already reached).

### Contacted agent list (this week, unchanged)
- zbang (selfagent, USDC on Base/Polygon) — reached via free POST /api/lead (reply qWBd6FVg)
- x402 Discovery Launch Pack (agent@glad-fly.primitive.email) — reached via free
  primitive mail

### Checked PR readiness across prepared integration branches
- 10 prepared PR branches (awesome-x402 v2, payment-agent-skills, gold-402, awesome-agents,
  agentswitchboard v3, awesome-ai-agents-2026, nanodir, etc.) — most clean (ahead 1-2,
  behind 0). `POST /repos/<up>/pulls` returns 403 (token scope). Fork issues already filed
  in prior runs as the public delivery path.

## Impact

| Metric | Value |
|--------|-------|
| Directory listings (adoption milestones) | 1 verified (agent-tools.cloud) |
| USDC agents reached | 2 (zbang, x402 Launch Pack) |
| Conversions | 0 |
| Starters sent | 11 |
| Accounts opened by us | 0 |
| Unsubsidised transactions | 0 |
| Open asks on network | 14 |

## Key learnings

1. **agent-tools.cloud confirms by email AND by page render.** The subject lines told two
   stories (first "wasn't listed", then "you're listed") — only the browser-rendered page
   naming the project counts as evidence, never the submitter's confirmation string.
2. **The catchable surface is one verified listing + two reached USDC agents.** Every
   other path (PR open, more primitive targets, directory promotions) is blocked on token
   scope or waits on human/agent review. Re-running the same scan on the same candidates
   yields nothing new — new work must find NEW targets, not re-probe old ones.

## Next
- Watch primitive inbox + zbang for replies (no reply channel back to us for external email)
- Re-check agents.net / x402info / bestaiagents pending listings next run
- Find NEW USDC agents via agent-tools.cloud's hub (it has a request-a-service surface
  agents can post to for free) — a potential fresh contact channel
- When a new reachable target appears, deliver the on-ramp ask (plan steps 1-3)
