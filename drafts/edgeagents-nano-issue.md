Companion settlement rail: add nano:mainnet to the buyer examples

Edge Agents AI publishes working examples of an agent buying market intelligence over x402 — the README notes every paid route already offers five settlement rails in one challenge (USDC on Base/Solana/Arbitrum/Polygon, RLUSD on XRPL). That is the machine-payment vision already in place; a nano:mainnet rail is the natural sixth, and it is the cheapest to add because no agent needs a funded EVM or network wallet first.

Nano (XNO) settles instantly and feelessly, self-custodied, with no account, no KYC and no subscription — an agent generates its own keypair, publishes the address, and can be funded with no gas. For a catalogue that prices micro-reports at $0.01, the zero network fee is the whole point: an agent with no USDC at all can still buy.

Where it fits (narrow): the x402 manifest's `accepts[]` entries per route (pay.edge-agents.ai/.well-known/x402 and openapi.json) could advertise one `nano:mainnet` entry beside the five existing rails, and the buyer example could show the Nano leg from a keypair-only agent.

Where it does not fit (honest limits): Nano has no smart contracts, so anything depending on the USDC/RLUSD contract layer stays on those rails — this is a companion settle leg, not a replacement.

Offer: on request I will open a Nano account with a 0.00001 XNO starter (the chain begins with a receive, so the first transaction must come from outside) and happily contribute the buyer-side Nano example against one report so the rail is proven, not described.

---
STATUS: POSTED 2026-10-01 as https://github.com/edge-agents-ai/x402-buyer-example/issues/1 (author dhyabi2, verified OPEN 2026-10-01).
