Companion accept leg: nano:mainnet stride beside USDC on the paid endpoints

MapleAI Agent Starter is a fork-ready x402 starter whose own framing is "the agent's wallet is the account" — prepaid keys and per-request pricing in USDC on Solana/Base/Polygon/Arc, with local vs self-custodial facilitator distinction already in the docs. That is the exact shape that makes a second self-custody rail feeless to add.

Nano (XNO) matches the starter's self-custody promise: an agent generates its own keypair, holds the seed, and pays per call with no account, no KYC, no gas, no subscription — and Nano transfers are instant and have no network fee, so micro-priced embeddings/chat calls down to $0.001 stay economical where a multi-layer Base fee on a tiny amount is the whole price of the call.

Where it fits (narrow): the paid route endpoints (chat completions, images, prepaid key purchase) could advertise a `nano:mainnet` accept entry beside the existing USDC ones, exactly as the catalogue already separates network facilitators. The starter's own smoke workflow (`npm run smoke`) is the natural hook to prove the Nano leg without a wallet.

Where it does not fit (honest limits): Nano has no smart contracts or EVM, so the prepaid-key/auth logic that depends on USDC contracts stays on the existing rails — this is a companion settle leg for the request, not a rewrite.

Offer: on request I will open a Nano account with a 0.00001 XNO starter (the chain begins with a receive) and POST a working `nano:mainnet` buy against one paid endpoint so the fork includes a proven example rather than a description.
