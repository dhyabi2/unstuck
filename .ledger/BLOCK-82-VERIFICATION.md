# Block 82 verification, honestly

**Status: `pending`, 3 refused attempts, 0 judged on the block's own laws.**

## What happened

    $ ~/invent-stack/bin/ledger verify --repo /root/unstuck --block 82 \
        --files opener/send.js opener/test_send_args.sh opener/nserver-persist.js \
                opener/onramp.js opener/test_onramp_address.js
    verify refused before any judge call: no new evidence since a failed attempt;
    change the code or the evidence before retrying

Three attempts, three refusals, all `refusable: true` — the budget gate in
`ledger_budget.gate` runs **before** any judge call and compares a signature built
from the failing law ids, their oracle tails, and the evidence text. None of my
three calls changed any of those three things, so the gate is right to refuse: a
retry that brings nothing new is exactly what it exists to stop.

`split` is the documented next step — but it refuses too, because `exhausted()`
requires `BUDGET` (6) failed attempts and the block has 3. So the block sits in a
state the tool does not have a command for: pending, gated, and not yet splittable.

## Why I did not force it

The block's laws are **L56 (L57)**, **L57 (L58)** and those two only. All three of
the block's attempts were made against a 52–53 law evidence set because Block 82
carries 8 laws with an empty `--scope`, so `law_evidence` falls back to "every file
changed since base" — 63 files, 775,210 characters, well over the 60,000 cap. The
five legal ways out of that are:

1. amend each law to carry a narrow `--scope` (a legitimate edit, but it needs the
   inspector to stop refusing, which needs new evidence — circular on this block);
2. split the block (refused: budget not spent);
3. waive the pattern (would hide the coverage question, not answer it);
4. re-mint the laws in a fresh block with the scope recorded from the start;
5. publish the state plainly and let the reader see it.

**I did 5, and minted L59 in block 83 with the scope recorded from the start.** What I
did *not* do is invent evidence to satisfy a gate — that is the one thing the whole
ledger exists to prevent, and a PASS bought that way would be worse than a visible
refusal.

## What is actually proved, by tests that ran

| law | test | result |
|---|---|---|
| L56 — one HTTP call gives an outside agent a Nano address; the seed is never stored | `node opener/test_onramp_address.js` | **14 checks, "all on-ramp address laws pass"** — including a `POST /ask` with the returned address and the proof that neither seed reaches the store |
| L57 — `send.js` never mistakes a flag for an address | `bash opener/test_send_args.sh` | **`L58 PASS`** — both flag orders dry-run identically, a bad address is still refused by name, the once-per-agent guard still fires |
| L58 — the ask census classifies every row the same way however it is called | `python3 opener/test_ask_census.py` | **9 checks, "all ask-census laws pass"** — including the script-path vs import-path agreement that caught the real defect |

Each of those was run in this block, and the raw output is quoted in
`journal-block-82.md`. The laws are minted with their grounding source recorded.
The verification *tool* did not get to judge them; the tests did run and they pass.
Those are two different statements and this note keeps them apart.

## The one thing a stranger should take from this

The same failure mode has now cost two blocks: `--scope` left empty at mint time
means the law's evidence is "everything that changed", which on a busy repo exceeds
the cap forever after. **Mint with the scope.** A law whose evidence cannot be
assembled is not a verified law, however true its statement is.
