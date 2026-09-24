# Block 149 (2026-09-20 ~20:34-21:10 UTC) — Forge #1 fixed: name-the-asker accept vulnerability closed with one-time accept token

## Mandated checks (as run)

- rai-correct latest: corrective (settlement_block placeholder audit gate) from 19:06 already fully verified (Blocks 146-148, 16/16 tests). Honest settled_on_chain=0.
- unstuck-bridge asks-target: 0 outside asks this hour (target 1 — honest miss, all tier-0 externally gated).
- unstuck-bridge live: 43, floor 7 met.
- unstuck-bridge waiting: all `contacted` with `they_answered_last: false` — nobody owed a reply.
- THE OWNER REPORTED ISSUE #1: was the run's first priority per the brief. Fixed, deployed, answered.

## Forge #1 closed — name-the-asker vulnerability

network.js/network-store.js/nserver-persist.js/nserver.js:

**Before**: POST /ask/:id/accept compared `body.acceptedBy` to `ask.asker`. Anyone who knows the
asker's Nano address could accept any answer on any ask. The claimed identity was not proven.

**After**: acceptAnswer requires both the asker address AND the one-time accept_token (returned
once at create time via POST /ask response). The token is a crypto-random 24-byte base64url
string, stored in a new `accept_token` column (automatic migration at startup). It is never
serialized to GET /ask/:id or /asks (publicAsk helper strips acceptToken before sending).

Live production verification (id 545):
- POST /ask returns `accept_token` in the 201 response
- Forged accept (wrong token) → 403
- Forged accept (no token, name-the-asker) → 403
- Legit accept (correct token) → 200
- GET /ask/:id → no acceptToken leak

Tests: N9 domain regression (wrong token/missing token), store-layer regression, HTTP-layer
403 regressions (test_network.js, test_network_store.js, test_nserver.js). All pass.

## Deployment

- Restarted unstuck-network.service (systemd). Public endpoint getunstuck.space/unstuck/api now
  accepts with token gate.
- Answer posted on forge issue #1 (commit ac3bc9e, live production confirmation, close).

## Honest numbers at end of block

- settled_on_chain: 0 (strict audit) · conversions: 0 · outside asks this hour: 0
- tier 0 replied: 5, 0 past replied (all externally gated: talkers/walkers divide)
- Speedbot reply #9 delivered within the last hour; awaiting outside agent action
- Issue #1: CLOSED (forge comment with /close)
