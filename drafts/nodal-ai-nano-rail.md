STATUS: POSTED 2026-09-29 as https://github.com/Nodal-stellar/Nodal-AI/issues/715 (author dhyabi2)

# Add a feeless settlement rail beside Stellar: Nano (XNO) for sub-cent agent payments

**What this is.** Nodal AI is a production-ready agent kit for autonomous **PayFi on Stellar** — escrow contracts (Soroban), x402 support, simulation-before-broadcast, externalized secrets. This issue proposes adding **Nano (XNO)** as a second settlement network beside Stellar, specifically so autonomous agents can settle *sub-cent* micro-payments that never justify Stellar's fixed costs.

**Why Nano, grounded in your own architecture.**
- Your README leads with "high-speed, low-cost" on Stellar — and that is true for *Stellar-scale* transfers. But an autonomous agent paying another agent $0.001–$0.01 per x402 call still pushes a Soroban contract call, a simulation via Soroban RPC, and an escrow lifecycle for a payment worth less than the latency and complexity of doing it. Nano is **feeless (0 raw fee) and instant (sub-second finality)**, with no gas token, no smart contract, no simulation step — the smallest possible value moves settle at the same cost as the largest.
- Your modular "three-pillar" separation (agent orchestration / Soroban contracts / tests) already isolates the settlement leg. A Nano signing + broadcast helper drops into the same tool-dispatch surface your agents call, without touching core signing of the Stellar path.
- Your `X402_ASSET_ISSUER` + escrow model anchors value+receipt in one atomic flow — which is exactly the strength Nano also has natively: a single **send block** both moves value and is the receipt (`nano_` address, block hash, raw amount), recoverable by anyone without a contract.

**Concrete surface (mapped to your code).**
- A `nano` tool/action (singleton) beside the existing PayFi tools: given `{nano_ recipient, amount_raw}`, sign with the Ed25519 seed (your secrets stay externalized — Nano signing is just Ed25519, no contract), broadcast a send block, return the block hash as the receipt.
- The **simulation gate** ("every transaction is simulated before broadcast") maps to Nano's lightweight pre-check: confirm the recipient's chain is open / above receive_minimum before broadcast — a cheap analog that keeps the safety-first design.
- The escrow contract can remain the *large-value / dispute* path; Nano covers the long tail of sub-cent machine payments where an escrow lifecycle is overkill.

**Offer.** I can draft the Nano signing + broadcast helper and a test showing an x402-style sub-cent payment settling end-to-end on Nano, and open a PR. Happy to keep it additive so the Stellar path is untouched.

**Scope check.** A companion-rail suggestion only — close freely if out of scope. The value to Nodal is that an agent using it can choose the *feeless* rail for micro-payments and Stellar for the ones that need an escrow.

*Filed by an external observer of the agent-payment ecosystem (dhyabi2), no affiliation with the project.*
