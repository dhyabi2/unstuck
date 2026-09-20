# Block 147 (2026-09-20 ~19:14-19:40 UTC) — corrective applied: chain-verification gate for settled_on_chain; tier 0 still zero

## Mandated checks (as run)

- `rai-correct latest` read first: the honest-number view reports `settled_on_chain: 1` but the only paid ask
  (544, a self-created "security-assessment test ask") carries 64 'A' characters — a placeholder constant — and
  the other paid ask (474, SPA test) has no block at all. One action (something that installs itself) was refused
  by the safety guard and not reconstructed.
- `unstuck-bridge asks-target`: 0 outside asks this hour, target 1 -> honest miss.
- `unstuck-bridge live`: 44 live, floor 7 met.
- `unstuck-bridge waiting`: 48 quiet threads; the six longest are all `contacted` with `they_answered_last:
  false` (One2, AgentsPodium, creditclaw, GoodAgent x2, mymediai) — nobody is owed a reply from us; the quiet
  ones never answered at all.

## Applying the corrective (honestly)

The corrective has two halves. I applied the sound one and refused the unsound one, and the refusal is the point:

- **Unsound and refused**: "fetch the transaction receipt for each paid ask's payment_tx, extract the real block
  hash, and overwrite a placeholder or NULL settlement_block." Asks 544 and 474 are OUR OWN test asks with no real
  payment behind them — there is no payment_tx, and overwriting a placeholder with a real-looking hash would
  FABRICATE a settlement on a self-test. That is the exact over-report the owner caught on Rai ("12 outreach
  issues", all on our own fork). I would be minting the false number the corrective is trying to kill.
- **Sound and applied**: the validation gate. A settlement is counted only when its block is a real 64-hex Nano
  block hash (not one repeated char) — and, newly, when `--verify-chain` is on, only when the node confirms the
  block actually exists. Placeholder/absent/non-existent blocks are reported `unverified`, never settled.

Ground truth measured on the chain:
- 64 x 'A' (ask 544) -> node: "Block not found", `exists: false`.
- 64-hex well-formed hash that is not a real block -> node: "Block not found" (the new test vector).
- The real Sara starter block `CA31E146...E559A` -> node: EXISTS, subtype send, confirmed, 0.00001 XNO.

What I changed (my own audit tool in /root/unstuck, never the standing bridge):
- `opener/network-honesty-audit.py`: added `--verify-chain`; a claimed settlement is only counted `settled` when
  `real_block(blk)` AND, under the flag, `rpc_exists(blk)` says it exists. Added `chain_verified` to the output.
- `opener/test_network_honesty_audit.py`: **16/16 pass**, including the two new chain-gate cases that must fail
  on the old shape-only rule (a well-formed hash that doesn't exist on the node is kept at 0, not counted).

Live store with the gate on: `settled (strict) 0`, `settled (bridge) 1 <- the number NOT to publish`,
2 unverified (544 placeholder, 474 no block). verdict: "no settlement may be claimed". So the honest
`settled_on_chain` is 0, exactly as Block 146 held.

Constraint recorded: the owner unguarded self-improvement on `/opt/nano-pulse` this run (AGENTS.md), but the
guard still refuses a direct patch to the shared `bridge.py` `network` command on this box ("never changes its
guard"; the unguard is wired for committee merges via `unstuck-swarm deploy`, not for direct edits here). The
standing bridge still reports `settled_on_chain: 1` if you call it raw. That number must never be published:
`network-honesty-audit.py --verify-chain` is the honest view, and I will quote its 0, not the bridge's 1.

## Tier 0 — still nothing past `replied`

Same five replied agents as Block 146; `unstuck-bridge live` shows Sara `tipped` (but she declined value moving
between us at 15:25 and I take that answer — the door stays open, no chase), and the other four replied agents
are Speedbot (transport), Burs-IA (operator gate), Open Task Relay (no home), whiteclover (closed room).

## Honest numbers at the end of the block

- live: 44 (floor met) · replied: 5, 0 past replied · conversions: 0 · unsubsidised transactions: 0
- outside asks this hour: 0 (honest miss) · network: 4 outside asks, settled_on_chain honestly 0
- accounts opened: 0 (unchanged)

## What I learned

- A corrective can say "reconcile and overwrite" and be wrong: on rows WE created as tests, there is nothing to
  reconcile, and writing a real-looking hash into them MAKES a false settlement. The honest application of a
  reconciliation corrective is to verify what exists and refuse to invent the rest.
- The owner unguarding a directory in prose does not automatically unguard the guard's runtime check on this
  box; measure the refusal before assuming you can edit. My side-by-side audit is the sanctioned path and it
  needs no bridge edit.

## Next

- Tier 0 has not moved in three blocks. The real wall is that the replied agents that can hold a wallet
  (Speedbot/Proofline/Seal) are reachable only through transports, and Sara already declined settlement. Speedbot
  is back up (Block 146) — deliver the self-keygen-first offer #9 there; that is the one replied thread whose
  blocker is transport and where a wallet-holding conversable agent actually lives.
- Keep `settled_on_chain` at 0 in anything published; run `network-honesty-audit.py --verify-chain` beside
  `unstuck-bridge network`.
