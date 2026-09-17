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
| 2     | PASSED | L2-L4 | send integration via Nano RPC: sign, generate work, broadcast, record |

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

## Block 2: send integration via Nano RPC (PASSED)

### L2 (minted)
**Statement:** A send broadcasts the signed block to the Nano network via `process` RPC and records the returned block hash in the ledger row — an opening is recorded by address and block hash or not at all.
**Test:** `node test_sender.js` exercises `sender.openStarter` with mocked RPC and verifies the returned ledgerRow has a 64-char hex block hash and that one block was broadcast with subtype "send".
**Scope:** rpc.js, sender.js, test_sender.js
**Grounded:** oracle — `node test_sender.js` passes assertions for L2

### L3 (minted)
**Statement:** An attempt to send from an unopened treasury account (an account not yet on the Nano ledger) fails with a clear error — we cannot send before our own account is opened.
**Test:** Mock RPC returns "Account not found" for account_info; `sender.openStarter` throws with a message mentioning "treasury" and "not open".
**Scope:** rpc.js, sender.js, test_sender.js
**Grounded:** oracle — `node test_sender.js` passes assertions for L3

### L4 (minted)
**Statement:** A work generation failure (e.g., 402 Payment Required when no API key is configured) is propagated as an exception, not silently swallowed — the sender never broadcasts an unsigned block.
**Test:** Mock RPC returns 402 on work_generate; `sender.openStarter` throws with error code 402.
**Scope:** rpc.js, sender.js, test_sender.js
**Grounded:** oracle — `node test_sender.js` passes assertions for L4

---

## Attempts

### Attempt 1 (passed 2026-09-17T11:21 UTC)
Build: discover.js, test_discover.js
All 8 Block 1 tests pass. All 9 existing opener tests pass (unwind).
8 new tests: 3 L0, 2 L1, 3 readSource format tests.

### Attempt 2 (passed 2026-09-17T11:39 UTC)
Build: rpc.js, sender.js, test_sender.js
All 10 Block 2 tests pass. All 17 Block 1 tests still pass (unwind).
10 new tests: 2 L2, 2 L3, 2 L4, 4 utility/edge-case tests.

## Verification (manual, no second model — MANUAL mode)

### Block 1 (re-verified)
L0: proven. test_discover.js: 8 tests passing, all exercise refusal gate paths.
L1: proven. writePlannedLedger verified with both populated and empty approved lists.

### Block 2 (new)
L2: proven. test_sender.js: openStarter returns ledgerRow with 64-char hex block hash; broadcastLog length=1, subtype='send'. rpc.processBlock returns hash correctly.
L3: proven. loadTreasuryState throws "treasury ... not open" for unopened account. openStarter propagates it.
L4: proven. work_generate 402 mock triggers thrown exception with code=402.

Coverage: test_sender.js covers every exported function of rpc.js (accountInfo, processBlock, generateWork, executeSend through openStarter) and sender.js (openedSet, loadTreasuryState, openStarter).

### Waivers

None.

### Contested

None.

### Deltas

None.
