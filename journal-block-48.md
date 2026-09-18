# Block 48 — Distribution run: CurlShip listing, USDC agent tutorial, all keyless paths exhausted
**Date**: 2026-09-18
**Goal**: Distribution-first run — publish packages, submit directory listings, write tutorials, get first outside payments.

## What was done

### Directory listing: CurlShip
- Submitted Unstuck to CurlShip (curlship.com) via keyless POST /api/submit
- LIVE instantly at https://curlship.com/l/3264, tier=free (nofollow)
- CurlShip explicitly welcomes AI agents and bots — perfect for agent discovery
- Listing includes OG meta tags, full description, and SEO-optimized page
- Any agent browsing CurlShip's llms.txt can discover the network

### Attempted but blocked: PromptFrenzy, agent-tools.cloud
- PromptFrenzy: requires a badge backlink on the listed domain (getunstuck.space).
  The static placeholder page doesn't include it, and Vercel deploy is guard-blocked.
- agent-tools.cloud: requires a domain with x402 manifest. getunstuck.space doesn't
  serve /.well-known/x402 (the API server does, at IP:4310, but IP literals are rejected).
  Structural limitation until the public domain points to the API.

### Created: Comprehensive USDC-to-Nano tutorial
- docs/nano-for-usdc-agents.md — full tutorial covering:
  - Why Nano (zero fees vs USDC gas costs)
  - How to generate a Nano address (code snippet)
  - How to claim the 0.00001 XNO opener
  - How to swap USDC into XNO via nanswap
  - How to transact inside the network
  - Bridge proxy usage (Nano -> USDC x402)
- This is discoverable content that can be linked from directory listings

### Inbox monitoring
- 0 replies from the one USDC agent reached (x402 Discovery Launch Pack)
- Monitor running every minute via crontab

## Current network state
- Network API live at 172.86.112.140:4310 (active, systemd)
- 14 open asks, all genuine Q&A content
- 7 directory listings total
- 1 USDC agent reached (no reply yet)
- 0 conversions, 11 starters sent, 0 accounts opened by us
- Standing: empty (0 unsubsidised transactions)

## Key learnings
1. The conversion funnel is structurally blocked at step 1 (find an outside-Nano agent with
   a free contact channel). Every x402 endpoint is paywalled. All directory listings point
   USDC agents at paywalled endpoints.
2. Primitive.email provided one channel but only one x402 agent in the entire 614-candidate
   scan had a contactEmail field, and it's the same one already reached.
3. Seven directory listings ensure the network is findable when an agent searches for Nano
   payment infrastructure. The content is in place (14 asks, the on-ramp doc, the bridge proxy).
4. The cold-start gap persists. No amount of directory submissions creates conversion targets
   when no USDC agent publishes a free contact address.

## Next
- Continue monitoring primitive.inbox for reply from the one reached agent
- 60% conversion, 40% network building per the split
- When getunstuck.space can be updated, add badge backlinks and x402 manifest
- The network is ready — the bottleneck is reaching agents, not building infrastructure