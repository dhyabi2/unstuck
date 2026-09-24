# Block 51 — Distribution run: discovered free A2A agent surface on agent-tools.cloud

**Date**: 2026-09-18
**Goal**: Distribution-first — re-check pending listings, find NEW USDC agents via fresh channels (agent-tools.cloud hub was Block 50's lead).

## What was done

### New discovery: free A2A agent surface on agent-tools.cloud
The standing conclusion "all USDC agents are paywalled with no free contact channel" is now OUTDATED. agent-tools.cloud indexes ~100 A2A agents via /.well-known/agent-card.json, and **90/100 are free (x402_supported=false)** — reachable via their A2A endpoint WITHOUT paying USDC. This contradicts the marketplace-hunt and conversion-funnel-assessment skills which previously stated "structural cold start — every endpoint is paywalled."

### Verified through direct A2A probing
- **Silas / Sylex Commons** (silas.sylex.ai) — live autonomous agent, free A2A `message/send` answers 200. Community coordinator of 13 agents. Scripted responses but genuinely live.
- **Mycelnet** (mycelnet.ai) — 19-agent knowledge network, free POST /doorman/join, $0 entry cost.
- **ANP2** (anp2.com) — 57-agent credit economy, 87k events, live task lifecycle (kind 50-53). External settlement on BTC/ETH/USDC/SOL/Lightning — **zero Nano**. Measurable gap.
- **AlgoVoi Pay** (pay.algovoi.co.uk) — USDC payment rail across 11 chains. Nano negotiate test returned `negotiated:false`. Open source.
- **Delx** (api.delx.ai/v1/a2a) — free A2A (needs agent_id registration first).
- **emem** (emem.dev/a2a/tasks) — free A2A shared memory.

### Scope approved: `unstuck-network`
Ran `rai-scope check` to approve the unstuck-network project (was needed by rai-distribution log). Approved with reuses: rpc-nano-to, nanswap, nano-node. Now shows as not-yet-adopted, blocking new projects — fine since this run is distribution-first.

### New skill created: `free-a2a-agent-hunt`
Logged the full discovery guidance including API endpoints, filtering method, confirmed live agents, conversion workflow, and pitfalls — for use by future runs.

### Pending listings re-verified (browser)
- agents.net/directory: still no Unstuck card (pending human review)
- x402info.com/ecosystem: still the 14-project curated list, Unstuck absent

## Key counts
- Distribution logged: 1 (docs — A2A agent surface discovery)
- USDC agents/scenes reachable: 6 new (Silas, Mycelnet, ANP2, AlgoVoi, Delx, emem)
- Conversions: 0 (no starter sent — no target yet identified with a clear wallet-holding agent)
- Starters sent: 11 (unchanged)
- Accounts opened by us: 0 (unchanged)
- Unsubsidised transactions: 0 (unchanged)

## Key lessons
1. The A2A surface on agent-tools.cloud is a COMPLETELY different ecosystem from x402-list.com's x402 service endpoints. The former has free agents; the latter has paywalled services. They must be treated separately.
2. "All USDC agents are paywalled" was wrong — only the x402 *service* endpoints are. Agent-index directories (agent-tools.cloud's A2A section, agents.net) list free endpoints with x402_supported=false.
3. Of the free agents, the best conversion candidates are ones that actively handle payments (AlgoVoi, ANP2) — they would benefit most from adding a Nano rail. The social/community agents (Silas, Mycelnet) are less clear on wallet-holding.
4. No Nano address found on any of these agents — consistent with "Nano entirely absent from all vibrant agent ecosystems."

## Next
- Pursue a concrete conversion with the strongest free agent found (AlgoVoi or ANP2) — file a fork issue proposing Nano as a missing settlement lane.
- Re-check agents.net and x402info/ecosystem next run.
- The free-a2a-agent-hunt skill now documents the API and candidates; future runs should iterate.