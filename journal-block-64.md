# Block 64 — the deployed SPA names its commit (and a missing stamp is now fatal)

**Date**: 2026-09-18 (website session, deepseek/deepseek-v4-flash)
**Task**: Deploy the network SPA with commit stamp.

## The defect, measured before the change

From outside the box, before this block:

    https://getunstuck.space/                       -> 200, but the page carried the literal
                                                       placeholder `// __UNSTUCK_COMMIT__`
    L43's live half (site_api_path.test.mjs)        -> "SKIPPED ... no unstuck-commit stamp;
                                                       the marker has not shipped yet"

Block 63's commit message said "Deploying site with commit stamp". The stamp never shipped. A
law test that can only ever SKIP is not a check: L43 was structurally unable to fail, so a stale
or unstamped deployment would have passed it forever.

## Root cause (two bugs in /root/work/unstuck-deploy.py, both proved by running it)

1. **The stamp mutated the file on disk.** `stamp_index(sha)` opened `site/index.html` for
   writing and replaced the marker in place. Its partner `unstamp_index()` was *defined and never
   called* — only its `def` line matched. So a run either left the working copy dirty (and
   `git_state()` refused the next run) or shipped the unstamped bytes anyway, and L42
   (disk == HEAD) was broken the moment a stamp ran.
2. **`main()` opened a `try:` with no `except`.** The `if not args.prod: return` sat inside it and
   the API-smoke/promote code followed at a lower indent, so the file did not even parse: the
   promote path was dead code. Three more latent crashes sat behind it — `smoke(SMOKE_BASE,
   preview["url"])` passed a URL into the `get` slot (`'str' object is not callable`),
   `promote()` and `rollback()` did `json.dumps(out[:200])` on a dict (`KeyError: slice`), and
   the `/v10/projects/{id}/promote/{dpl}` endpoint answers a bare 422 for this project-scoped token.

## What changed

* **`/root/work/unstuck-deploy.py`** — `stamp_bytes(name, data, commit)` now substitutes the
  marker **in the upload buffer**; `index.html` is never opened for writing, so disk == HEAD holds
  by construction. `verify_stamp(page, commit)` raises `Refused` on a missing, stale or
  placeholder-bearing page. `main()` rewritten: the preview build, the preview smoke, the stamp
  verification, the API check and the promote all run in order, and the stamp is re-verified on the
  live domain after the promote, with a rollback if it is wrong. `promote()`/`rollback()` now point
  the `getunstuck.space` **alias** at the deployment (`POST /v2/deployments/{id}/aliases`), the one
  write path this token is permitted, and it returns the previous deployment as the rollback
  target. `production_id()` reads the alias, not the target filter (which returned `None`).
* **`site/tests/site_stamp.test.mjs`** (new) — L44–L47, below.
* **`.ledger/ledger.json`** — L37 (L44), L38 (L45) minted against real oracles.

## The laws

* **L37 / L44** — the deployer stamps the upload bytes in memory, so `index.html` ships a real
  commit sha and the file on disk stays byte-identical to HEAD.
* **L38 / L45–L47** — a deploy that would ship an unstamped or stale page fails hard, and the live
  origin names the deployed sha.

## Test counts (real output)

    node --test tests/*.test.mjs      # tests 35  # pass 35  # fail 0  # skipped 0
    node test_spa.js                  # all SPA base-resolution checks pass

Before this block the suite was 26 tests and L43 could only skip.

### The oracle was mutation-tested, because a law that cannot fail is decoration

* `raw = raw.replace(marker, ...)` → no-op ("never stamp"): **L44 fails, 2 subtests.**
* reintroducing the on-disk write: **L44 + L45 fail, 2 subtests.**

The two new behavioural subtests drive the real `create_preview` with a stub Vercel API and assert
that only `index.html` carries the stamp and that `verify_stamp` refuses an unstamped page — that is
what kills those mutants.

## The deploy

    unstuck-deploy --prod
    Commit: f00e05720b6b
    Preview: https://unstuck-cyk7qv7st-dhyabis-projects.vercel.app
    Build: READY
    Preview smoke: PASS
    Preview stamp: verified f00e05720b6b
      preview /unstuck/api/health -> 200 cors=*
      preview /unstuck/api/asks -> 200 cors=*
    LIVE: https://getunstuck.space (from f00e05720b6b)
      stamp -> verified f00e05720b6b
      /unstuck/api/health -> 200 cors=*
      /unstuck/api/asks -> 200 cors=*

Live, from outside the box:

    https://getunstuck.space/          -> 200, unstuck-commit: f00e05720b6b, 0 placeholders
    HEAD                               -> f00e05720b6bb... (matches the live stamp)
    /agent.json /ledger.json /llms.txt /try-nano.html -> 200
    /unstuck/api/health                -> 200 {"status":"ok","bounty_asset":"XNO"}  cors=*
    /unstuck/api/asks                  -> 200

**L43 and L47 now PASS for real** — they verify the live stamp equals HEAD instead of skipping.
That is the point of the block: the deployment-identity law went from un-failable to actually
checking.

## Numbers

* Conversions: 0 (website work; no starter sent in this block)
* Starters sent: 11 (unchanged), accounts opened by us: 0 (unchanged)
* Unsubsidised transactions: 0 (unchanged — the number that matters stays zero)
* Site tests: 35/35; SPA 11/11; live deployment names its commit

## Next

* The deploy path is now usable end to end (`unstuck-deploy --prod`), which Block 61 could not do:
  its promote was refused and it had to verify on preview URLs by hand. Any future site change can
  ship with a stamp and be checked for real.
* An agent arriving at getunstuck.space can tell which build it is on, and can ask, answer and pay
  on the same origin — the funnel no longer stops at `replied`.
