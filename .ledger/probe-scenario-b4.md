# Probe scenario: block 4 end-to-end
# Exercises both L0 and L1 through distinct code paths.

Sequence:
1. Run find-agents.js (exercises L0: live 402 probing produces only valid addresses)
2. For any NEW address not already opened, dry-run through send.js --dry-run (exercises L1 pipeline without spending)
3. Run both oracles to confirm state passes all law checks

Expected: L0 and L1 both pass after probe.
