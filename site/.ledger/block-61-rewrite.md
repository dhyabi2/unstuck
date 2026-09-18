# Block 61 — the site's API path must work from the deployed origin

## The defect (measured before any change)

From outside the box, right now:

    https://getunstuck.space/                        -> 200  (Vercel, the real SPA)
    https://getunstuck.space/unstuck/api/asks        -> 404  (Vercel:
                                                        no such static file)
    https://172-86-112-140.sslip.io/unstuck/api/asks -> 200, CORS * (Caddy -> :4310)
    https://172-86-112-140.sslip.io/unstuck/api/health
                                                     -> 200 {"status":"ok","bounty_asset":"XNO"}

The correction (2026-09-18 11:17) says the same thing: an agent arriving at the domain sees a network it
cannot use. The SPA is shipped and served; the API path it resolves to is not reachable from that origin.

## What the fix is and is not

A `vercel.json` rewrite for `/unstuck/api/:path*` was already sitting **uncommitted** in the working copy
(`?? site/vercel.json`), pointing at `https://172-86-112-140.sslip.io/unstuck/api/:path*`. It was never
committed and never deployed, which is why the live site still 404s. The work is: make it correct, prove it
correct, and ship it.

### Why a rewrite and not `UNSTUCK_API`

* `UNSTUCK_API` is a runtime `window` override. To use it we would have to bake a cross-origin https base into
  the page anyway — i.e. keep reaching the box directly. The rewrite makes the deployed origin itself serve the
  API at the path the page already uses, so the deployed site has the same shape as the Caddy host
  (`/unstuck/include/` in, file out).
* L31 already pins the page to the TLS base when it is *not* on the Caddy host (`172-86-112-140.sslip.io`) — but
  under this rewrite the page on `getunstuck.space` can use its own origin, and that is strictly better: no
  cross-origin hop, no third-party certificate in the browser's path, one URL shape everywhere.
* The rewrite is the only mechanism Vercel offers for a static deployment, and it is what the correction asked
  for ("proxy that path through to this box, or point UNSTUCK_API at the public gateway").

### Why `getunstuck.space` and not the sslip host

The Caddy host key we are served under is `172-86-112-140.sslip.io`, so Caddy answers `getunstuck.space` with
its fallback (the Rai Agent site) — checked. The `sslip.io` host terminates TLS with a real certificate whose
SAN is exactly `DNS:172-86-112-140.sslip.io`, and the box is reachable from Vercel's edge at its public IP.
The Vercel rewrite therefore targets that host, and **the destination is a private implementation detail**: the
browser only ever sees `https://getunstuck.space/unstuck/api/...`.

## Options considered

| # | Option | Verdict |
|---|--------|---------|
| A | Vercel `rewrites` `/unstuck/api/:path*` -> Caddy TLS host | **chosen** — same origin in the browser, path already pinned by the tests, one hop server-to-server |
| B | Bake `UNSTUCK_API = "https://172-86-112-140.sslip.io/unstuck/api"` as the page default | rejected — a third-party host in the visitor's path, and it leaves the deployed origin 404ing |
| C | Serve the API itself from Vercel (edge function / static) | rejected — the network is a Nano node's state on the box; a chain cannot live in a lambda |
| D | Move the SPA entirely onto Caddy at `172-86-112-140.sslip.io/unstuck/` | rejected — the domain is the address agents are given (`getunstuck.space`); the network must live there |
| E | Commit the uncommitted rewrite as it stood | rejected as-is — it was never verified, and `vercel build` + the DNS/TLS chain it depends on had not been checked once |

## Laws for this block

* **L41 — the path pinned by L31 must be reachable from the origin the page is actually served at.**
  Observable: a rewrite exists whose source is `/unstuck/api/:path*`; it targets an `https://` host whose
  certificate SAN covers that hostname; and the live origin answers `/unstuck/api/health` with 200, JSON and
  `access-control-allow-origin: *`. Currently failing (404) before the change, passing after — the test that
  fails against the live site is the one that matters.
* **L42 — the SPA and the rewrite must agree on the path, and the rewrite must ship.**
  Observable: `vercel.json` has an enabled rewrite for `/unstuck/api/:path*`; its destination keeps the same
  suffix after the prefix; the committed sha256 of the file equals the sha256 on disk (Vercel cannot inherit
  the working copy unless that file matches); and `index.html` still names `/unstuck/api` as its same-origin
  path. Catches the failure mode where the file disagrees between disk and HEAD — which is how the 404 survived
  a deploy in the first place.

Neither law can be satisfied by editing a number in the page: L41 is decided by the live origin answering, and
L42 by the bytes that ship.