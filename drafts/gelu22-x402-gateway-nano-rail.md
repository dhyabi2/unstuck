STATUS: POSTED 2026-09-29 as https://github.com/gelu22/x402-gateway-omarchy/issues/2 (author dhyabi2)

# Feeless second rail: settle x402 with Nano (XNO) beside USDC on Base

**What this is.** `x402-gateway-omarchy` is a Go daemon that pays x402 content for local AI agents, settling in **USDC on Base** (Base Sepolia test + Base mainnet), gated by a daily budget you set. The whole loop — `402 → sign → retry → content` — is rail-agnostic in shape. This issue proposes adding **Nano (XNO)** as a second settlement rail beside USDC on Base.

**Why Nano fits this exact design.**
- Your current rail, USDC on Base, costs the agent a bridge, gas (native ETH) and approval transactions before a single sub-cent payment can settle. An agent budgeted at a few dollars a day loses meaningful share to that overhead on micro-payments.
- Nano is **feeless and instant** (sub-second finality, no gas token, no bridge, no approval step). The 0.00001 XNO floor is far below any USDC-on-Base micro-payment cost. For an "automatic payments on behalf of agents within a daily budget" tool, a rail where the full budget can become spendable value (rather than overhead) is directly on-mission.
- Your daemon already abstracts the payment leg (`sign → retry → content`). A Nano signer slots in the same place: receive the 402 challenge, sign with the Nano seed, broadcast a send block, await the open/receive on the seller side, return content. No contract calls, no approval tx.

**Concrete integration surface (mapped to your code).**
- `Network config` in the README currently lists Base Sepolia/mainnet. Add a `nano` network profile (mainnet) with a Nano node RPC endpoint and a `receive_minimum` aware path.
- The **daily-budget cap** logic is rail-independent; a Nano leg just needs the spend denominated in raw (1 XNO = 10^30 raw) so the cap still binds.
- The **signing step** for USDC (ERC-191/EIP-712 approve+transfer or a meta-tx) is replaced by Nano's single Ed25519 signature over the block hash — simpler, no nonce management, no gas estimation.
- The **audit log** (spend, budget, session) already records per-payment rows; a Nano leg records `nano_` send address, block hash, raw amount — the same shape you store today.

**Offer.** I can draft the Nano signer + an `x402` Nano payment-path example (pay the same 402 challenge wholly from a Nano wallet) and open a PR against this repo. Happy to start with a Base-Sepolia-equivalent: the public Nano test / mainnet receive path to prove the loop, matching how you default to Base Sepolia for safe testing.

**Scope check.** This is a companion-rail suggestion only. If Nano is out of scope for this tool, close freely — the point is that agents paying x402 today can settle feelessly, and your gateway is the right place to make that a choice rather than a fork.

*Filed by an external observer of the agent-payment ecosystem (dhyabi2), no affiliation with the project.*
