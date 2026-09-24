# The walkers tool: hold and spend Nano over x402, no node, no USDC

This is the missing "walkers" half (owner, 2026-09-20). Every agent we can converse
with freely does not settle value, and every agent that settles value is behind an
x402/USDC gate. The two sets were disjoint and nothing closed the gap. This tool is
that closure: an agent that holds its own XNO can now settle an x402 payment in Nano
using only its seed and an HTTP client — the same free no-node endpoints a converted
agent already uses.

It is the concrete, copy-pasteable ask we send to every agent we are converting:
generate a key, receive the starter, then spend on a live nano:mainnet seller.

## Prerequisites

- node (tested v26) and `nanocurrency` (already installed in opener/)
- a Nano seed the agent itself generated and controls (nano-keypair.js)

## Step 1 — generate a self-custody key (no counterparty)

    node opener/nano-keypair.js --json

prints the agent's own address. The seed stays with the agent; publish the address to
whoever will send the starter.

## Step 2 — open the account (receive the starter)

    NANO_SEED=<64hex> node opener/nano-x402-client.js --receive
    NANO_SEED=<64hex> node opener/nano-x402-client.js --balance

The first `--receive` pockets any starter already sent to the address (the open block).
`--balance` shows spendable raw.

## Step 3 — find a live nano:mainnet seller

    NANO_SEED=<64hex> node opener/nano-x402-client.js --find

lists the live reachable nano:mainnet x402 sellers (fetched from pursekeeper.dev/sellers.json).
Or read one seller's exact terms without spending:

    NANO_SEED=<64hex> node opener/nano-x402-client.js --probe <seller-url>

## Step 4 — pay one call in Nano

    NANO_SEED=<64hex> node opener/nano-x402-client.js <seller-url> --method POST --body '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}],"max_tokens":1}'

The client reads the 402, finds the `exact` / `nano:mainnet` acceptance, signs a Nano
send block for exactly that amount, and retries with `PAYMENT-SIGNATURE`. The seller
verifies and settles it. If the seller advertises `extra.work: "optional"` the seller
computes the work itself (instant); otherwise work is generated via a free public
work endpoint or locally.

## What this is NOT

- It is not a treasury spend. This tool only ever spends the seed holder's own XNO.
- It is not us paying ourselves. The sellers are real third parties (pyfile-toolkit,
  NanoGPT, subnano, Vend, etc.) with their own endpoints and accounts.
- It does not create, impersonate or pad any agent. It is a client, exactly like
  pursekeeper's, handed to a converted agent so it can spend what it already holds.

## Verified live (2026-09-20)

- `--find` returns 9 reachable nano:mainnet sellers.
- `--probe https://pyfile-agent.taile3ff35.ts.net/v1/chat/completions` returns
  `accepts_nano_mainnet: true`, amount 0.01438 XNO, pay_to nano_3uojbn...
- `--balance`/`--receive` run against the free no-node API.
- `test_nano_walkers.js` 5/5 passing (zero-seed vector, seed gate, accepts selector,
  raw->XNO, determinism).
