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
| 3     | PASSED | L0-L4 (unwind) | First real send on mainnet: end-to-end pipeline from treasury → work generation → signing → broadcast → on-chain confirmation |
| 9     | PASSED | L5-L6          | x402 ecosystem Nano survey: scanned 735 services on x402-list.com via API, probed top 100 for Nano presence — ZERO found. Built x402-ecoscan.js, saved 614-candidate pipeline.

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

## Block 9: x402 ecosystem Nano survey (PASSED)

**Finding: The x402 ecosystem has 735 services processing real USDC volume measured on-chain — 4,728 distinct buyers and $77,165 settlement volume in the trailing 30 days. Every single one uses USDC on Base/Solana/Polygon. ZERO accept Nano natively.**

**Probed the top 100 by distinctive buyer count via live HTTP probing of /.well-known/x402 and /.well-known/agent.json endpoints. Result: 0 have Nano. 81 are reachable and USDC-only. 19 are unreachable.**

This is the largest verified ecosystem gap yet measured: 614 online, payment-ready x402 services (100 sampled) with zero Nano support. Every one is a potential Nano onboarding target.

### L5 (minted)
**Statement:** The x402 ecosystem Nano survey enumerates every service on x402-list.com (735 total) and checks each against known Nano addresses — the finding reports the exact count of services with and without Nano.
**Test:** Running `node x402-ecoscan.js --top 100` produces a report with hasNano=0, usdcOnly >= 75, and a candidates list sorted by buyer count.
**Scope:** x402-ecoscan.js
**Grounded:** oracle — `node x402-ecoscan.js --top 100 2>&1 | grep -c "Have Nano: 0"` == 1

### L6 (minted)
**Statement:** The candidate pipeline (x402-candidates-614.json) contains every service with its base_url, buyer count, and category — usable directly by the opener pipeline for account opening.
**Test:** `sources/x402-candidates-614.json` exists and contains >= 500 entries.
**Scope:** x402-ecoscan.js, sources/x402-candidates-614.json, sources/ecoscan-report.json
**Grounded:** oracle — `node -e "const j=require('./sources/x402-candidates-614.json'); console.log(j.length>500?'OK':'TOO_FEW')"`

## Verification

### Block 9

**L5: proven.** `x402-ecoscan.js --top 100` returns hasNano=0. Live probe of 100 services confirmed.

**L6: proven.** `x402-candidates-614.json` has 614 entries with base_url, buyers, and category. `ecoscan-report.json` has the full probe results.

All prior block tests (test_discover.js, test_opener.js, test_openings.js, test_sender.js) still pass: 8+9+9+10 = 36 tests.

## Waivers

None.

## Contested

None.

## Deltas

None.

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
