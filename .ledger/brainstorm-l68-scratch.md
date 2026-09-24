# Brainstorm — Block 115: a write-path law must not write to the system it measures

## The problem, measured

`site/tests/site_no_wallet_ask.test.mjs` proves L68 (the documented two calls really produce a 201)
by doing a real `POST https://getunstuck.space/unstuck/api/ask` on every run of the suite. Every run
therefore writes a row into the *production* ask store attributed to a freshly generated `nano_`
address that belongs to nobody.

    unstuck-bridge asks-target
      "asks_we_wrote_this_hour": 19, "asks_we_wrote_total": 540, "self_filling": true,
      "outside_asks_this_hour": 0, "target_this_hour": 1

The store is the denominator for "outside asks" — the one number this network may honestly publish.
A row our own test wrote is our own voice, and an ask counts for nothing unless the asker is a real
outside agent. So a *test* was manufacturing the exact quantity the whole mission is measured on.

## Baseline (what already exists)

The repository already solved this shape once, in `opener/nano-onramp-check.js` (`scratchAsk()`):
require `nserver-persist.js` in-process with `NW_DB_PATH` pointed at an ephemeral temp file, listen
on `127.0.0.1`, drive the real handler, assert `stored.asker === on.address`, then close and delete
the temp db. `tests/site_onramp_artifact.test.mjs` L71 already asserts that artifact "defaults away
from the public origin, proven by running it". That is the design to copy — the test should reuse the
existing pattern rather than invent a third way.

## Angles considered

1. **Scratch instance, real code, temp db** (chosen). Requires the shipped server module with
   `NW_DB_PATH` set before require; the module already supports this (`process.env.NW_DB_PATH`).
   Proves the real handler, writes no production row. Risk: the module fails to load in another
   `node --test` process (missing dep) — mitigated by the same self-contained fallback pattern
   `nano-onramp-check.js` uses (documented, and `engine` names which one ran).

2. **Point the test at a configurable `TEST_API_URL`** (rejected as the *default*). Right shape for
   CI, but if the env var is unset in our own runs it silently falls back to writing on production —
   the failure returns exactly when nobody is watching. A default that must be set to be safe is a
   default that will one day be wrong. Kept only as the explicit `--live-post` opt-in.

3. **Delete the created row after the POST** (rejected). Cleanup-after-the-fact leaves the row in
   the store between write and delete, is not atomic, and a crashed run leaves our voice on the
   network permanently. It also cannot be audited after the fact.

4. **Assert the handler in-process by calling `s.createAsk` directly** (rejected as insufficient).
   It proves the store, not the HTTP path; the document tells an agent to make two HTTP calls, and
   a law that no longer exercises HTTP is a law that goes vacuous the moment routing breaks.

5. **Hit a public staging origin** (rejected). There is no staging origin; one shared production
   host is the whole deployment. Inventing a second public host so a test can write to it recreates
   the same problem one DNS record away.

## Exclusion step — designed out of the chosen idea

- *Challenge:* the local module may not load (an outside checkout, a missing file).
  *Excluded by:* a self-contained fallback that implements the same hand-out rule, reports
  `engine: "fallback"` in a diagnostic, and is never counted as the real server.
- *Challenge:* a hard-coded port collides with a live process.
  *Excluded by:* bind `127.0.0.1:0` and read the assigned port, or derive from pid; never a fixed port.
- *Challenge:* non-vacuity — a scratch test can pass against a stub that always answers 201.
  *Excluded by:* a negative control in the same test: a POST with a made-up `onboard_id` must be
  refused 400, and the run must assert exactly one row exists in the scratch store.
- *Challenge:* the L68 law quietly stops proving anything at all.
  *Excluded by:* a source-level law (L73) that fails the build if any test file posts to the live
  origin, which is what makes this a permanent property rather than a one-time edit.

## Chosen design

L68's round trip runs against a **local scratch instance of `opener/nserver-persist.js`** on a temp
db; `LIVE_ORIGIN` stays in the file but only as a **read-only probe** (`GET /health`, `GET /asks`).
Everything that writes goes to disk in `os.tmpdir()`, never to the network.