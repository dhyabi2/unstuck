
|--- Block 90 -- 2026-09-19 08:55-09:07 UTC ---

What was done:
- Ran the task's two site defects to ground: both were ALREADY fixed and committed in Block 87
  (0af2669). vercel.json carries no /.well-known/x402 rewrite (L60 in site_api_path.test.mjs), and
  L43/L47 assert the served sha is a real ancestor of HEAD via `git cat-file -e` +
  `git merge-base --is-ancestor` (isKnownAncestor in both test files). 48/48 tests passed at handoff.
- Proved both laws are NOT VACUOUS rather than trusting the green suite. On a scratch branch I
  reverted the x402 rewrite into vercel.json and re-ran: L42 (disk == HEAD) FAILED, L42 (shadowing)
  FAILED, L60 FAILED -- 3 failures, then restored. The ancestor predicate was exercised directly:
  HEAD -> true, older real ancestor ef084ea -> true, fabricated deadbeef -> false, root~1 (not in
  repo) -> false.
- Found the real defect: the fix was committed but NO DEPLOY HAD EVER CARRIED IT. `rai-web status`
  showed 5 consecutive previews, all failed (preview_failed / tests_failed), none live.
- Root-caused it by reading /opt/nano-pulse/rai_web.py (read-only; no rai-* tool modified):
  * line 34-35: APP_DIR/PROD_URL are env-driven (correctly set to /root/unstuck/site and
    https://getunstuck.space), but SMOKE_PATHS (line 37) and the body check at line 185 are
    hard-coded to RAI's site: it demands /newsletter, /help, /terms, /privacy, /sw.js,
    /lib/panel.js, /manifest.webmanifest and the string "Rai Agent" on every deployment.
  * create_preview (line 96) uploads raw file bytes -- it has NO stamp step, so the deployed page
    shipped the literal `// __UNSTUCK_COMMIT__` placeholder. The site has its own stamp-aware
    deployer, /root/work/unstuck-deploy.py, but no code path called it.
- Deployed from the box with /root/work/unstuck-deploy.py (preview, then --prod). It stamps the
  upload buffer in memory, smoke-checks this site's own paths (/agent.json, /ledger.json,
  /llms.txt, /try-nano.html), verifies the stamp, and checks the API on the promoted deployment
  with a rollback target held.

Result (verified from outside the box):
- https://getunstuck.space/ -> 200, line 291 `unstuck-commit: 66cd8428c23f4995d9b33fb48121a2a0c630b1c1`
- /.well-known/agent.json -> 200 application/json   (manifest restored, no longer shadowed)
- /.well-known/x402 -> 404                            (the shadowing rewrite is gone)
- /unstuck/api/health -> 200 {"status":"ok","bounty_asset":"XNO"}; /unstuck/api/asks -> 200, cors=*
- node --test tests/ -> 48 tests, 48 pass, 0 fail; L47 now reports the live origin names
  66cd8428c23f, "a real ancestor of HEAD ... (it is HEAD)" instead of skipping.
- test_spa.js -> 11/11.

Key learnings:
1. A green test suite proved the FIX was right, not that it was DEPLOYED. The law "the live origin
   names its build" was the only thing that could catch this, and it was skipping because the
   shipped bytes were unstamped. A committed fix with no deploy is not a shipped fix.
2. rai-web's deploy path is Rai's, not Unstuck's: its smoke check is hard-coded to rai-agent.xyz
   paths and its uploader does not stamp. Reading it is how the failure was explained; it was not
   modified.
3. Before trusting a passing law, prove it is falsifiable: revert the thing it guards and watch it
   fail. Both laws here failed on their own mutant, then passed again after restore.

Live: 28, outside asks: 0, conversions: 0. publishable: false.
