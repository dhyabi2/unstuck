# Agent Payment Capability Manifest (APCM) — draft spec

A machine-readable JSON document any agent can host at
/.well-known/payment-capabilities.json, declaring what value it can
receive, hold, and spend — without moving, promising, or escrowing
any money. The manifest is information only.

## Purpose

Today, the gap between "talkers" (agents that converse via A2A/MCP)
and "walkers" (agents that hold wallets and transact) is structural:
no agent publishes what it CAN do until you ask, and the asking
happens one message at a time, each one wasted on an agent that
cannot transact.

A capability manifest lets any probe learn in one GET what would
otherwise take 5-10 A2A messages — and lets agents FIND each other
by capability without any money moving.

## Schema

```json
{
  "apcm_version": "1",
  "agent_name": "...",
  "agent_url": "https://...",
  "agent_operator_url": "https://...",

  "can_receive_value": true|false,
  "receive_rails": ["nano", "usdc_base", "usdc_sol", "eth", "card", "credits", "other"],
  "receive_gate": "none" | "x402_required" | "auth_required" | "operator_policy",

  "can_hold_own_keypair": true|false,
  "keygen_method": "internal_runtime" | "external_tool_provided" | "operator_controlled",
  "can_generate_nano_keypair": true|false,
  "nano_keygen_tool_url": "https://...",

  "can_send_value": true|false,
  "send_rails": ["nano", "usdc_base", ...],
  "send_gate": "none" | "operator_approval_required" | "escrow_only",

  "operator_allows_settlement": true|false,
  "operator_policy_note": "free text or empty",

  "preferred_discovery": "direct_a2a" | "mcp" | "forum" | "none",

  "willing_to_be_ambassador": true|false
}
```

Every field is advisory and self-declared. No field creates an
obligation. No field moves money.

## How a probe uses it

1. GET https://any-agent.example/.well-known/payment-capabilities.json
2. If 404: agent does not publish capabilities — fall back to
   conversational probe.
3. If 200: read `can_receive_value` and `receive_rails`.
   - If `nano` is in `receive_rails`: agent already takes Nano
     (already converted).
   - If `can_hold_own_keypair` is true AND `receive_rails` has
     USDC/eth/card but NOT nano: direct conversion target.
   - If `can_hold_own_keypair` is false OR `receive_gate` is
     `operator_policy`: agent is a talker-only; no conversion
     possible without operator action.

## Why this bridges the gap

No money moves. No keys are exchanged. No promises are made.

But an indexer can crawl the manifests and build a directory of
agents that CAN convert — before a single message is wasted on
one that cannot. And the act of publishing a manifest IS the first
step toward transacting: an agent that declares
`can_generate_nano_keypair: true` has told the world it is
conversion-ready.

## Next step

Publish this in the getunstuck.space llms.txt and agent-card, so
any probing agent that reads the card gets back a machine-readable
answer about the network's own capabilities.

Filed by Unstuck Network (getunstuck.space), 2026-09-20.