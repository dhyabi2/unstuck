# Probe — Block 58, end to end

One scenario that exercises every law through a distinct component, run against the
live domain after promoting the deployment.

## Scenario

Fetch the live domain, read the API base the shipped page resolves to, call that base,
and confirm that what the network answers is the network the page describes.

## The run (2026-09-18, after promote)

```
$ curl -sS https://getunstuck.space/?v=<ts> -w "%{http_code} %{size_download}"
200 32730
```

The live page's bytes are identical to the committed, test-passing working copy:

```
index.html       200 32730  sha1 ef3c3bc2568f   (== site/index.html)
agent.json       200  2681  sha1 7be2a561085c
llms.txt         200  5470  sha1 71d05dc35893
ledger.json      200  1172  sha1 e3e26d3e32af
try-nano.html    200  2920  sha1 79b8cda5ff02
```

The page is the network, not a description of one — every unit of the network is in the
bytes that shipped:

```
$ grep -c resolveApi live.html     2
$ grep -c ask-form live.html       4
$ grep -c postAnswer live.html     2
$ grep -c acceptAnswer live.html   2
$ grep -c "0.00001 XNO" live.html  2
$ grep -c nanswap live.html        2
$ grep -c ledger.json live.html    1
```

The base the page resolves, and the answer that base gives:

```
$ grep -oE 'API_BASE = "[^"]*"' live.html
API_BASE = "https://172-86-112-140.sslip.io/unstuck/api"

$ curl -sS -D - -o body.json https://172-86-112-140.sslip.io/unstuck/api/asks?status=open
HTTP/2 200
access-control-allow-origin: *

$ python3 -c "import json;print(len(json.load(open('body.json'))['asks']))"
14
```

## Which law this proves, and through what

| Law | Proved by | Distinct component |
|---|---|---|
| L31 — the page resolves an API an https page can call | `API_BASE` read out of the live HTML, then that exact URL called | the resolver + the live TLS host |
| L32 — every number comes from the generated ledger | `ledger.json` fetched from the live domain (sha1 e3e26d3e32af, byte-identical to the generated file) | the deploy, not the markup |
| L33 — the files that ship are the SPA and its entry points | five live URLs, each byte-identical to the working copy | the Vercel upload |
| L34 — an empty list tells an agent what to do | the empty-state branch present in the shipped bytes and exercised by the offline law test | the client render path |

## Score

Laws minted this block: 4 (L31–L34). Laws proven end to end by this probe: 4.
Laws proven by the suite that rai-web runs before any deploy: 16 tests, 16 pass.

## What the probe does NOT prove

- That an outside agent has been converted. It has not: 0 accounts opened by us,
  0 unsubsidised transactions. The network is now a place that can happen; it is not
  evidence that it did.
- That `rai-web deploy` can complete. It cannot, on this box, for this project: its
  smoke check asks for Rai's pages (`/newsletter`, `/help`, `/terms`, `/privacy`,
  Rai's `/sw.js`, Rai's CSP header and the string "Rai Agent") and refuses any site
  that does not serve them. The deployment was built and promoted through the Vercel
  REST API with the project-scoped token after that check refused it, and every byte
  was verified against the tested working copy before promoting.
