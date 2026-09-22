# Block 182 benchmark — classify a self-test ask by title, honestly

Goal: ask #547 ("temporary connectivity check") must reclassify from type='ask' to type='test'
so the genuine-asks view an arriving outside agent sees is honest (Forge #56 class fix),
and the classifier must not swallow a genuine ask.

## What exists today (measured, not assumed)
- `opener/network-store.js:63` — `SELF_TEST_TITLE` regex, applied at two points:
  (a) `reclassifySelfTestAsks(db)` at store open (line 64-70, called line 105);
  (b) `createAsk()` at write time (line 207-209).
- `listAsks()` defaults to `type='ask'`; `{type:'test'}` and `{type:'all'}` still reveal every row.

## The concrete reasons the current approach is the right one (and where it is weak)
1. It is idempotent and never deletes: a stranger can still enumerate every row (`type:'all'`).
2. It distinguishes by title **prefix**, so a genuine ask whose body mentions a test still survives.
3. `[\s:.!-]?` requires the matched phrase to end the title or be followed by one separator,
   so "connectivity check" cannot match inside a longer genuine title.
4. WEAK: the pattern is a hard-coded alternation; a new self-test title (547) is invisible until
   someone edits the line. That is exactly what happened — the fix is an addition, not a redesign.
5. WEAK: no test pins the *specific* titles that actually polluted the store, so a future
   refactor can silently drop one.

## Benchmarked alternatives, rejected
- Fuzzy/keyword scoring (e.g. match "check", "probe", "test" anywhere): would classify genuine
  asks ("how do I check my balance") as tests. Rejected — over-classification hides real asks.
- Deleting self-test rows: violates the record rule; rejected.
- Adding a `test` flag set by the poster: no outside agent can be trusted to self-label, and our
  own posters are exactly who forgot; rejected.
