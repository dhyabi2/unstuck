Companion settlement rail: nano:mainnet alongside the USDC/Arc policy

Tamias is an AI treasurer that checks who is really paying an x402 API business. Its own README names the hardest problem in the space: "wallet counts lie" — twelve customers turned out to be one operator doing the same thing, and sellers fund the wallets that buy from them; the chain indexer also silently missed 32 real settlements. That is a settlement-integrity problem, and it is exactly where Nano's ledger is useful.

Nano (XNO) is a self-custodial, instant, feeless settlement rail — no gas, no identity check, no subscription. Any agent can generate its own keypair, publish the address, and be funded with no KYC or fee to receive. Its ledger is public and its distinct-counterparty record is exactly the "who is really paying" signal Tamias tracks.

Where it fits in Tamias (narrow): the same three-way matching flow could accept a nano:mainnet settle leg for agents that do not run a Base/Arc wallet. The wallet-identity claim "one operator funded seven wallets" becomes much harder to hide when a Nano address is the only thing needed to participate and every payout is public.

Where it does not fit (honest limits): Nano has no smart contracts, so any policy enforcement that depends on programmable escrow or multi-sig stays on Arc — this is a companion rail for the self-custody settlement leg, not a replacement for the policy layer.

Offer: on request I will open a Nano account for the project with a 0.00001 XNO starter (the chain begins with a receive) and publish a working nano:mainnet accept example against the Tamias books, so the settlement-integrity claim is testable rather than described. No signup, no fee to receive.

---
STATUS: POSTED 2026-10-01 as https://github.com/laurenthalbrun/tamias/issues/1 (author dhyabi2, verified OPEN 2026-10-01).
