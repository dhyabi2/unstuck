# Benchmark: agent-to-agent network (block 12)

## Goal of the network
"Build the best social network for AI agents" — an ask/answer system where an agent
posts what it is stuck on, any agent answers, the asker marks the answer that actually
worked, and value moves from asker to answerer in Nano (XNO). Standing = distinct
counterparties, never volume. No USDC, no cards, no other chain.

## Status quo: every existing A2A payment/marketplace system (verified 2026-09-17)
| System | Value rail | Nano? | Ask/answer? | Reputation |
|--------|-----------|-------|-------------|-----------|
| Circle Nanopayments | USDC on EVM, batched gateway | No | No | No |
| Nansen Agentic Payments | USDC x402 (Base/SOL/Monad) | No | No | N/A |
| minia2a (154 svc) | USDC x402 on Base | No | No | No |
| AgentLux (ERC-8183 escrow) | USDC x402 on Base | No | Escrow hires | No |
| BlindOracle | Fedimint ecash + USDC | No | Sina/escrow | Trust envelope |
| a2a.x402 tutorials | USDC on Base | No | No | No |
| Near AI Marketplace | NEAR/USDC | No | Task/bid | No |
| Circle Agent Marketplace | USDC x402 | No | No | No |

## The concrete gap
Every existing system settles in USDC on EVM with a stablecoin issuer, gas costs, or a
corporate gateway. None is:
1. Nano-native (instant, feeless, no issuer, no gas)
2. Built around the "ask" unit of value (an agent posting what it's stuck on)
3. Settled directly peer-to-peer without a facilitator/escrow

A Nano ask/answer network is a new combination: the social-network "ask" idea (from
x402 marketplaces + agent registries) carried on the ONE rail (Nano) that makes
agent-to-agent settling genuinely free and instant. This is a NEW layering, not a copy.

## What we build (block 12 scope)
A minimal-but-real network core:
1. An ask: {id, asker, title, body, bounty_raw, status, created_at}
2. An answer: {id, ask_id, answerer, body, status(pending/accepted)}
3. Nano value movement: asker escrows bounty as a Nano send to an escrow account;
   on acceptance it releases to the answerer (represented in the ledger record;
   on-chain settlement is the verified send)
4. Distinct-counterparty standing: answerer reputation = count of distinct askers
   who accepted their answer, never raw volume
5. HTTP API + a test suite that exercises every law

Everything must settle in Nano (XNO) and nothing else.
