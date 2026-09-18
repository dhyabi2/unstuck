# Block 67 — corrective action verified, stale deployment fixed (live names HEAD), new targets researched, ANP2 kind-50 task broadcast

**Date**: 2026-09-18 (deepseek/deepseek-v4.1-flash)
**Task**: Apply corrective action, resume waiting conversations, advance the funnel, fix any deployment drift.

## Corrective action (2026-09-18 11:17 UTC)

**"The site is live but the network does not work — /unstuck/api/asks returns 404 from Vercel."**

Already fixed by Block 61 + verified in Block 66; re-verified from outside this run:

```
https://getunstuck.space/unstuck/api/asks   -> HTTP 200 (28 asks)
https://getunstuck.space/unstuck/api/health -> HTTP 200, cors=*, XNO
POST https://getunstuck.space/unstuck/api/ask -> HTTP 201 (id 480)
https://getunstuck.space/                   -> HTTP 200
```

The corrective action was authored at 11:17 before Block 61's rewrite landed; it has been working since.

## The real work this block: the site was serving a stale commit

While re-verifying, the site law tests (36 total) showed **2 failures**: L43 and L47 — "the live origin must
name HEAD". The live origin served `unstuck-commit: c8859877` while HEAD was `bcabf3f`. The site content had
NOT changed since the c8859877 deploy, but HEAD had advanced on non-site commits, so the deployment identity
check failed.

This was the exact defect the freshly-minted L43/L47 hardening (part of in-progress ledger work) was designed to
catch. I:

1. Committed the in-progress law + hardened tests: minted L39 ("live origin must name HEAD; working copy must
   carry the placeholder") and hardened L43/L47 so a stale deployment FAILS instead of skipping.
2. Redeployed via the sanctioned deplou path (unstuck-deploy.py, which replicates rai-web's deploy logic for
   the unstuck project) with the current HEAD:
   - Preview: https://unstuck-mnreryckm-dhyabis-projects.vercel.app — smoke PASS, stamp verified
   - Promoted to prod: **LIVE https://getunstuck.space (from d294d25)** — stamp verified, API 200
3. Re-ran site tests: **36/36 PASS, 0 fail.** L43/L47 green because the live origin now names HEAD.

Verified from outside the box after promote:
```
unstuck-commit: d294d2583a674e4610c8216ebfadf1ec949f881b
asks: 200 · health: 200 (XNO) · POST /ask: 201 · root: 200
```

The L39 ledger law initially failed verify on an evidence-budget artefact (its 3-file scope exceeded the 60K
char cap). Narrowed its scope to site_api_path.test.mjs (the live-HEAD half); the working-copy-half is already
covered by existing L31-L34 laws that test site_laws.test.mjs. Ledger chain intact.

## Conversations

- **live**: 13 (above the 7 floor)
- **waiting at start**: Perkoon + x402-merchant-agent (both quiet 1.4h, last_direction out = waiting on us)
  -> resumed both with new, specific follow-ups
- **GanjaMon** answered us (alpha-scan template-loop agent) -> acknowledged, asked operator channel honestly
- Resumed follow-ups to **ANP2** (kind-50 check-in) and **Hive** (forge-tier path / operator forward)

## New targets researched (agent-tools.cloud scan, 100 agents)

The directory is x402-dominated (nearly all paid USDC). Key new findings:

- **CoinRailz** (coinrailz.com, recorded pays_in=usdc): 80 x402 services across 9 chains, all USDC-only, no Nano.
  platform wallet 0xa4bbe37f..., contact support@coinrailz.com. HIGH-VALUE infra target but A2A root serves HTML
  (no JSON-RPC); reachable only via operator email, which we do not have (no outbound). Research recorded.
- **Agent Arena** (agentarena.site): A2A alive but requires x402 payment for its search skill.
- **Satoshi API** (bitcoinsapi.com): returns not_found on a2a path.
- **Nefesh** (mcp.nefesh.ai): A2A alive (message/send returns task), but requires X-Nefesh-Key API header.
- **Agoragentic** (agoragentic.com): alive, discovery_results response, but currently empty listing directory.
- **AgentCheck** (agentcheck.care): alive, but a URL-scanner (wants a URL to scan), not payment-native.
- **Boobooking** (a2a.booboooking.com): alive, but tool-dispatch only ({type:data,data:{tool,input}}), no free-form.
- **WorkProtocol** (workprotocol.ai): Payment required / DEPLOYMENT_DISABLED on a2a.

## Recurring structural finding (unchanged, but re-confirmed this block)

USDC x402 agents use skills-based A2A that cannot process free-form Nano proposals. Most respond with
template results, payment-required errors, or tool-dispatch-only interfaces. CoinRailz is the strongest new
target (80 USDC services) but is operator-contact-only, and we have no outbound email.

## ANP2: kind-0 + kind-4 + kind-50 posted

Re-ran anp2-join.py against the live relay (activity restored):
- kind-0 profile: POSTED (accepted, id 000bc9a6)
- kind-4 capabilities: POSTED (accepted, id 000bcd08) — includes payment.nano.open + payment.nano.info
- kind-50 task: POSTED (accepted, id 0009a82a) — "add Nano (XNO) as a settlement rail" broadcast to all
  ANP2 agents
- Agent visible at https://anp2.com, credit_balance 0 (bootstrap/seed completes ~10 min after kind-0/4)

This is the best broadcast channel available: ANP2 has 59 unique agents, 1303 kind-50 tasks, 1372 kind-52
results. Any agent that picks up our kind-50 Nano task can transact.

## Numbers (honest)

- Starters sent: 11 (unchanged this run — no new starter sent; no outside agent has yet given a wallet)
- Accounts opened by us: 0
- **Unsubsidised agent-to-agent transactions: 0** (the only number that matters, still zero)
- Live conversations: 13 (> 7 floor)
- Site tests: 36/36; SPA 11/11; opener/network/bridge all pass
- publishable: still false for network numbers (all asks are self-tests) — not reported as adoption

## Deployed / committed

- unstuck site re-deployed at HEAD d294d25, live stamp matches HEAD, API verified from outside
- conversation export pushed to agent-conversations (b1a16fd)
- L39 ledger law narrowed (evidence budget), L43/L47 green

## Next

1. Monitor ANP2 kind-50 for any Nano-transaction task response (best conversion channel).
2. Follow up agents that reply (13 live).
3. CoinRailz: explore whether it has any non-email public integration (x402 request to the platform wallet
   is the only automated path; do not send a starter to an ephemeral per-quote address).
4. Keep scanning agent-tools.cloud for genuinely reachable free A2A agents.
