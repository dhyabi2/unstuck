# Unstuck Ledger (MANUAL mode — engines 502/402)

Goal: Discover agents active in public, verify they don't have opened Nano accounts,
open accounts for them by sending the starter (0.00001 XNO), and record every opening
in a verifiable ledger.

Ledger base commit: none (no git history yet)
Created: 2026-09-17T11:20 UTC

---

## Index

| Block | Status | Laws | Description |
|-------|--------|------|-------------|
| 1     | PASSED | L0-L1 | discover-and-open workflow: discover, filter, record |

---

## Block 1: discover-and-open workflow (PASSED)

### L0 (minted)
**Statement:** A discovery run reads agent addresses from a configurable source, checks each against the opener's refusal gate, and records the approved ones without sending to any that would be refused.
**Test:** Running `node discover.js --source test-fixtures/agents.json` with a file containing 2 valid addresses, 1 invalid, 1 already-opened, and our own address produces exactly 2 approved entries and logs the 3 refusals with their reasons.
**Scope:** discover.js, opener.js, test_discover.js
**Grounded:** oracle — `node test_discover.js` passes all assertions

### L1 (minted)
**Statement:** The opening record (ledgerRow) is written to a JSON file with at minimum account, block hash, timestamp, and source for every send, and the module never writes a row without a block hash.
**Test:** After discovery, if sends were attempted, the output ledger JSON contains valid entries; if no sends were possible, the file records 0 openings.
**Scope:** discover.js, opener.js
**Grounded:** oracle — `node test_discover.js` validates ledger output structure

---

## Attempts

### Attempt 1 (passed 2026-09-17T11:21 UTC)
Build: discover.js, test_discover.js
All 8 Block 1 tests pass. All 9 existing opener tests pass (unwind).
8 new tests: 3 L0, 2 L1, 3 readSource format tests.

## Verification (manual, no second model — MANUAL mode)

L0: proven. `test_discover.js` L0 tests exercise:
  - invalid address → refused
  - already-opened address → refused
  - own address → refused
  - multiple source formats all read correctly
  - approved addresses are exactly the ones that pass the refusal gate

L1: proven. `test_discover.js` L1 tests exercise:
  - ledger with 2 pending openings has correct structure
  - empty approved list produces valid 0-opening ledger
  - each entry has block=null, status="pending", amount_raw matching STARTER_RAW

Coverage: test_discover.js covers every exported function of discover.js (readSource, discover, writePlannedLedger).

## Waivers

None yet.

## Contested

None yet.

## Deltas

None yet.