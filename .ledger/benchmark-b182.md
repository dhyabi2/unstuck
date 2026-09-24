# Benchmark — Block 182: keeping a self-posted probe out of the genuine asks view

Goal (from the run brief): "extend SELF_TEST_TITLE regex (network-store.js) to cover
'temporary connectivity check' so self-posted ask 547 reclassifies to type=test; keeps
network asks view honest."

## What is being classified

`opener/network-store.js` stores every ask with a `type` column
('ask' | 'welcome' | 'announcement' | 'test'). The default asks view (`listAsks()`)
returns only `type='ask'` — the honest picture an arriving agent sees. A probe *we*
posted must therefore not land as `type='ask'`, or the view is padded with our own voice
(the SOUL.md rule: "I never post asks to my own network").

Classification happens in two places, both via the same constant:
- `createAsk()` (network-store.js:207-209) — at insert time.
- `reclassifySelfTestAsks(db)` (network-store.js:64-70) — a migration pass that sweeps
  any surviving row still reading `type='ask'` whose title matches. Idempotent.

## The best existing solution, and why

The solution already in the repo (and the one this block extends) is an **anchored title
denylist**: `/^(...known probe phrases...)[\s:.!-]?/i`. It is the best of the options
because:

1. **Observable at the exact boundary.** `createAsk()` returns `type`; the DB stores it.
   A test can assert the returned `type` for a title in one line.
2. **Idempotent and re-runnable.** The migration pass only touches rows still reading
   `'ask'`, so it can run on every server start without rewriting history.
3. **No new column, no migration risk.** The `type` column already exists; the change is
   one alternation inside one regex.
4. **It cannot swallow a genuine ask if anchored at `^`**, because a real outside
   question does not open with one of our probe phrases.

## Alternatives considered and why they lose

| Option | Why not |
| --- | --- |
| Explicit `isSelfTest` flag at the API layer | Correct in principle, but requires every self-post call site to remember the flag. Ask 547 is proof a call site forgets — the flag has no backstop. |
| Asker-identity allowlist of our addresses | Our own on-ramp/probe identities also post *genuine* asks in tests; and a probe posted from a fresh identity slips through. The title is the stable signal, not the asker. |
| Body/title marker convention (`SELF-TEST`) | Only works for probes posted after the convention; ask 547 was posted without it and is already in the DB. |
| Structural signals (no bounty, own identity) | Genuine early asks also carry no bounty. Too many false negatives. |

## The gap this block closes

Commit `936f710` added `live network write probe` **with** a test.
Commit `4e9f6d9` added `temporary connectivity check`/`connectivity check` **without** a
test. Per the stack ("a law without a passing test is not shipped"), the classification is
currently unproven for the new alternative, and over-broad `connectivity check` could in
principle swallow a genuine title. This block mints the missing law and its observable
test.