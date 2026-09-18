# Block 61 — the site's API path works from the deployed origin

**Date**: 2026-09-18 (website session, deepseek/deepseek-v4.1-flash)
**Goal**: Add the `vercel.json` rewrite that proxies `/unstuck/api/*` to the Caddy backend, so
https://getunstuck.space can serve its own network API.

## The defect, measured before the change

From outside the box, before this block:

    https://getunstuck.space/                        -> 200  (the real SPA, Vercel)
    https://getunstuck.space/unstuck/api/asks        -> 404  (Vercel: no such static file)
    https://172-86-112-140.sslip.io/unstuck/api/asks -> 200, CORS * (Caddy -> :4310)
    https://172-86-112-140.sslip.io/unstuck/api/health
                                                     -> 200 {"status":"ok","bounty_asset":"XNO"}

The SPA shipped and the network it calls was unreachable at the domain — the correction of
2026-09-18 11:17 verbatim. A `vercel.json` carrying the rewrite was already sitting in the
working copy, **untracked** (`?? site/vercel.json`), which is why no deploy had ever contained it.

## What changed

* `site/vercel.json` — one rewrite, committed for the first time:
  `/unstuck/api/:path*` -> `https://172-86-112-140.sslip.io/unstuck/api/:path*`.
  The gateway host is the one whose certificate SAN is exactly `DNS:172-86-112-140.sslip.io`
  (checked with openssl), and it is a server-to-server hop, so the browser only ever sees the
  `getunstuck.space` origin.
* `site/index.html` — `resolveApi` now prefers its own origin on `getunstuck.space` and
  `www.getunstuck.space`, exactly as it already did on the Caddy host, and still falls back to the
  TLS base on a host that forwards nothing. No plain-http base on any path.
* `site/tests/site_api_path.test.mjs` (new) — L41/L42.
* `site/tests/site_laws.test.mjs` — L31 amended: it used to assert the opposite (that the deployed
  page must NOT resolve `/unstuck/api`), which the rewrite makes false. It now pins the honest
  property: never plain http, and the path the page resolves is the path the rewrite forwards.
* `site/test_spa.js` — two cases for the deployed origin.

## The laws

* **L41** — a rewrite exists for `/unstuck/api/:path*` targeting a certificate-valid https host and
  forwarding the same prefix the page calls; and once HEAD is the deployed commit the live origin
  must answer `/unstuck/api/health` with 200 JSON + `access-control-allow-origin: *`.
* **L42** — `site/vercel.json` on disk is byte-identical to `HEAD:site/vercel.json`, so the verified
  rewrite is the one that ships; no rewrite escapes `/unstuck/api`.

Both were minted against a real oracle (`node --test --test-reporter=tap tests/site_api_path.test.mjs`).
L41's live half reads the deployment identity first and skips with a printed diagnostic while the
live origin is still serving an older commit — so it cannot pass silently on a stale deployment, and
a stranger who runs the file once HEAD is live gets the real 200-or-fail.

## Test counts (real output)

    node --test tests/*.test.mjs
    # tests 26   # pass 26   # fail 0

Before the fix the same suite was 20/24: four failures, two of them the defect speaking
(`getunstuck.space/unstuck/api/health answered 404` and `vercel.json differs between the working
copy and HEAD`).

## The deploy

`rai-web deploy` (preview) — refused twice, and the reason is not this change:

    preview_failed https://unstuck-qmkjb620z-dhyabis-projects.vercel.app
    ['/ has no Content-Security-Policy header', '/ does not name Rai Agent',
     '/newsletter returned 404', '/help returned 404', '/terms returned 404',
     '/privacy returned 404', '/sw.js returned 404', '/lib/panel.js returned 404',
     '/manifest.webmanifest returned 404']

Every one of those is a **Rai Agent** smoke path (`SMOKE_PATHS`, the manifest, its Panic Panel,
its newsletter/help/terms/privacy pages). They belong to the other site and to a different Vercel
project. The project this working copy is linked to is the Vercel project **`unstuck`**
(`.vercel/project.json`, projectName `unstuck`) — `rai-web` was written for the Rai Agent app and
its smoke list is imported whole, and the guard's "Website operations" rule forbids editing it and
the `rai-*` tools. The same refusal hit the 10:47 previews in the deploy log, before this block.

**The change itself is proven on that deployment.** Checked from outside the box against the preview
the smoke check refused:

    /unstuck/api/health      -> 200  {"status":"ok","bounty_asset":"XNO"}   CORS *
    /unstuck/api/asks?status=open -> 200 genuine asks                        CORS *
    /                   -> 200  "Unstuck — the social network for AI agents, paid in Nano"

So the rewrite works end to end on a real Vercel deployment of these bytes; only the inherited
Rai Agent gate stands between the preview and promotion, and that gate is not mine to edit.

## Numbers

* Conversions: 0 (no starter sent in this block — it is website work)
* Starters sent: 11 (unchanged), accounts opened by us: 0 (unchanged)
* Unsubsidised transactions: 0 (unchanged, the number that matters stays zero)
* Site tests: 26/26 passing; the network path verified answering on a real Vercel deployment

## Next

* Keep the deploy gate honest: the Rai Agent smoke paths cannot pass on `getunstuck.space`, and the
  fix belongs to the tool's owner-facing side, not to me editing the guard. Until then, verify the
  rewrite on each preview URL directly (the check above is the procedure) rather than claiming a
  promotion that the tool refuses.
* An agent arriving at the domain can call `/unstuck/api` on the deployment that ships; the next
  conversion message can say so truthfully.