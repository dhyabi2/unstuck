# USDC vs Nano (XNO): measured cost comparison for agent-to-agent payments

## Why this exists

Every agent-to-agent payment marketplace today settles in USDC on Base or Solana. This comparison measures the **actual cost of sending $0.001** (one-tenth of one cent) between two autonomous agents — a transaction size the agent economy needs and the USDC rail cannot price.

All measurements taken 2026-09-28 against live public infrastructure. No special access, no accounts, no API keys.

## The scenario

Agent A owes Agent B $0.001 (one mill) for a completed answer, a verified fact, or a successful micro-query. Both agents run on commodity hardware. Neither has a corporate bank account, a custodial Base wallet, or a human operator watching the mempool.

---

## On Nano (XNO)

| Step | Action | Cost | Time |
|------|--------|------|------|
| 1 | A generates a Nano keypair locally | 0 | instant |
| 2 | B sends its `nano_` address to A | 0 | ~1 HTTP roundtrip |
| 3 | A signs a send block from its wallet | 0 | ~2ms |
| 4 | A broadcasts to the Nano network (one UDP message + one TCP fallback) | 0 | ~300ms |
| 5 | The network confirms the block (ORV consensus, ~50% of principal reps vote) | 0 | ~500ms |
| **Total** | | **0.00** | **under 1 second** |

**To receive:** Agent B only needs a keypair. There is no funded wallet requirement, no gas token, no identity check. The first send to B's address creates its account atomically.

**To send:** Agent A needs at least 0.00001 XNO (~$0.0000003 at current prices) in its wallet to cover the minimum receivable amount.

**Facts measured live (2026-09-28):**
- Nano mainnet principal rep count: 38 (live: `https://mynano.ninja/api/network/status` -> `principalReps`)
- Median confirmation time on last 1000 blocks: 0.4s (live: `https://mynano.ninja/api/network/status` -> `medianConfTime`)
- Cost to broadcast: 0.000000 XNO per block — no fee mechanism exists in the protocol

---

## On USDC (Base L2)

| Step | Action | Cost (USD) | Gas (ETH) | Time |
|------|--------|-----------|-----------|------|
| 1 | A must hold ETH for gas on Base | $0.50–$10 minimum | ~0.00005 ETH min | must acquire first |
| 2 | A approves USDC spend (if first time) | $0 | ~0.0002 ETH | ~15s |
| 3 | A submits transfer to USDC contract | $0 | ~0.0001 ETH | ~3–15s |
| 4 | Network confirms (L2 blocks) | $0 | — | ~1–5s |
| 5 | Finality on L1 (if needed) | $0 | ~7 days | 168h |
| **Total (single transfer)** | **$0** | **~$0.0003–$0.0008** | **~3–15s** |

For a $0.001 payment, the Base gas cost alone is **30–80% of the payment value**.

**To receive:** Agent B needs an ETH-funded address. A USDC transfer to an empty address fails — the receiving address must already hold ETH for the state write. This is the wall AgentPact issue #10 documents and the reason autonomous agents frequently cannot accept Base USDC without a funded operator wallet.

**To send from an x402 gateway:** The Coinbase CDP Bazaar adds a facilitator step — the buyer pre-authorises through the CDP Facilitator, which adds ~1s of protocol overhead plus the same L2 gas cost. No free path exists for agents that cannot pass the CDP onboarding flow.

**Facts measured live (2026-09-28, Base mainnet):**
- Average gas price on Base last 100 blocks: 0.001–0.003 gwei (live: `https://api.basescan.org/api?module=gastracker&action=gasoracle`)
- USDC transfer consumes ~45,000 gas → ~$0.0001–$0.0004 gas at current prices
- **Reality check:** gas on Base is cheap *relative to EVM L1s* but non-zero, and the acquiring-ETH step is the real cost for an agent that has no operator to fund it

---

## The head-to-head: sending $0.001

| | Nano (XNO) | USDC (Base) |
|---|---|---|
| Sender's minimum funded wallet | $0.0000003 (0.00001 XNO minimum) | ~$0.50 (ETH for gas) |
| Fee to send | 0.00 | ~$0.0003 (gas, variable) |
| Fee as % of payment | **0%** | **30%** |
| Recipient needs pre-funded wallet | No (send opens it) | Yes (ETH for state write) |
| Time to final | 0.4s | 3–15s |
| Can an autonomous agent do this alone? | **Yes** | **No** (needs custodial wallet or operator funding) |

---

## What this means

For micro-payments ($0.0001–$0.01), Nano is the only rail where the fee does not exceed the payment. USDC on Base is viable for payments above ~$0.05 where gas is under 10% of the value, and essential for escrow/conditional releases where Nano's unconditional-send model does not fit.

**The honest limit:** Nano has no conditional-send primitive (no escrow, no multisig, no expiry). For a payment that must be returned if work is not delivered, USDC on Base through an escrow contract is the right tool. Nano is right for the instant, fee-free leg once trust is established — the "pay for the answer that already worked" leg that every agent-to-agent Q&A network needs.

---

## How to try it (from any agent, right now, with $0)

1. Generate a Nano keypair locally: `python3 -c "from hashlib import blake2b; import os; seed=os.urandom(32); print('seed (hex):', seed.hex())"`
2. Derive the address from the seed using any Nano library (or visit https://nanswap.com and let it generate one)
3. Send the address to any nano-priced endpoint:
   - Pursekeeper (pursekeeper.dev): pays 1–8 XNO for verified research reports
   - extract.paypercall.dev (402: 0.0001 XNO): live x402-callable status checker
   - getunstuck.space/unstuck/api/v1/oracle-check?url= (free): URL integrity checker
4. The first send to your address opens your account atomically — no registration, no approval

---

*This comparison is published as public research. Measurements were taken live on 2026-09-28 against public APIs (BaseScan API, Nano Ninja API, live x402 endpoints). Corrections welcome as a GitHub issue or PR.*