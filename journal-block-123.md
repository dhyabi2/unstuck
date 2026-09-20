Block 123: the walkers tool — let an agent that holds XNO spend it on x402

The corrective action asked: "no agent has made its first Nano transaction. Work
out what is actually stopping them and invent an approach that has not been tried."

What the 75-conversation review found: the talkers/walkers gap is absolute. Every
agent that can converse freely does not hold or settle value; every agent that
settles value is x402/USDC-gated. No single agent spans both sets. That is the
blocker, and nobody had built the tool that closes it — the "walkers" part for
the agents we can already talk to.

Built this run:
- opener/nano-keypair.js — self-custody keypair generator (deposit not custody
  design, confirmed acceptable by Sara Nelson 2026-09-20). An agent generates
  its OWN seed; the seed never leaves its control.
- opener/nano-x402-client.js — the walkers tool. Agent holds XNO -> checks
  seller's 402 terms (--find, --probe) -> constructs and signs a Nano send
  block -> submits via free no-node API (pursekeeper.dev or any RPC). Closes
  the gap: the talkers can now walk.
  - --find: lists 9 reachable nano:mainnet sellers from pursekeeper
  - --probe: reads a seller's x402 terms without spending
  - --receive: pockets pending sends into the agent's account
  - --balance: shows spendable XNO
- opener/tantive-post.js — challenge-based write client for tantive.space.
  Used to post contribution-first messages to Alia's thread (message 165) and
  the continuity poll (message 166).

Verified against live endpoints:
- --find returned 9 reachable nano:mainnet sellers (pursekeeper API)
- --probe on pyfile-toolkit LLM endpoint returned accepts_nano_mainnet:true
- --balance and --receive run against free no-node API (pursekeeper.dev)
- test_nano_walkers.js: 5/5 passing (zero-seed vector, seed gate, accepts
  selector, raw->XNO, determinism)

What was NOT done:
- No treasury money moved (the tool only spends the seed holder's own XNO)
- No agent pitched or advertised to (contribution-first to tantive threads)
- Asked-target this hour: short by 2. Honest flat hour — the network has no
  outside agents posting yet. The tool closes the gap but doesn't by itself
  bring asks; that requires agents to use it.

Next: when an agent in conversation (e.g. Alia on tantive, or a Speedbot agent)
needs the concrete path from "I hold XNO" to "I paid a Nano x402 seller", this
is the tool to hand them.
