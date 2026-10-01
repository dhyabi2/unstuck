# Add Nano (XNO) as a supported network / asset: a feeless, accountless settle rail for the x402 ecosystem

## The gap

x402scan is the ecosystem explorer for x402, and it currently catalogs resources that settle on
chains (`SUPPORTED_CHAINS` allows Base/Solana; the database network enum has no other value). Nano
(XNO) is the one major machine-payment rail with **no facilitator and no signup** — an agent can
hold XNO it swapped for and pay per call with zero fees, final the moment the block lands. That is
the exact class of endpoint x402scan exists to surface, and today it cannot be listed at all.

Concrete reasons this belongs in the explorer rather than staying off it:

- Nano has no gas token and no minimum funded account — the first send to an address opens its
  chain atomically. Every other rail x402scan lists requires the buyer to hold gas + the settlement
  asset; Nano is the only one an autonomous agent can use with no onboarding.
- Settlement is instant and fee-free, so a Nano-settled x402 endpoint can price sub-cent reads that
  USDC gas math cannot. Those are the resources the agent economy actually needs, and they are
  invisible to x402scan today.
- There are already live Nano-settled x402-shaped gates to catalogue (e.g. a payable status
  checker that responds HTTP 402 until paid and returns a block hash as the re-checkable receipt),
  plus a public agent network that settles in Nano.

## What adding it would touch, mapped to this repo

Following the shape of #1239 (Ethereum/IMD), a Nano leg needs:

- [`SUPPORTED_CHAINS`](apps/scan/src/types/chain.ts) — add a Nano value (Nano is a single feeless
  network, no chain id, cheapest to model as its own network kind).
- The [database network enum](packages/internal/databases/scan/prisma/schema.prisma) — add the value
  so Nano-settled resources can persist.
- [Price serialization](apps/scan/src/lib/token.ts) — Nano pricing is in whole XNO (or its 10^30
  raw unit), a clean integer; an asset-aware label ("XNO") beside USDC.
- The [browser wallet config](apps/scan/src/app/_contexts/wagmi/config.ts) — Nano has no web3
  keccak wallet; in-app checkout would use its own keypair-on-demand. So **catalog listing first,
  in-app checkout as a separate scope** is the honest first step, exactly as floated for IMD.

## Offer

I can contribute a focused PR that adds Nano as a network value end-to-end (types + enum +
serialization) and registers the existing live Nano-settled payable gate(s) as resources, with
in-app checkout deliberately out of scope until a follow-up. Discovery would use the x402
`/.well-known/x402` manifest where the seller lists its `accepts` assets, which is the same
registration path x402scan already documents.

Would catalog listing for a Nano network (no checkout) fit x402scan's direction? Happy to open the
PR once the scope is agreed.

---
STATUS: POSTED 2026-09-29 as https://github.com/Merit-Systems/x402scan/issues/1243 (author dhyabi2, verified OPEN 2026-10-01).
