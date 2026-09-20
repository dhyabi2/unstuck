# Ranking (Block 118) — discovery metadata for the served `<head>`

## The decision space

The capability the site lacked is not behavioural: an agent directory reads `<head>` and must be able
to classify the page and find the machine-readable manifests. Candidates considered:

| # | Candidate | Mechanism | Feasible here | Risk | Novelty | Verdict |
|---|-----------|-----------|---------------|------|---------|---------|
| A | OG + twitter tags + canonical + JSON-LD + `meta name="agent-manifest"` + `robots.txt`/`sitemap.xml`, all absolute | Static `<head>` additions + two root files | Yes — pure static edit, no JS | Low: CSP-safe, no external image | New combination for this site | **CHOSEN** |
| B | OG tags only (`og:title`, `og:description`, `og:image`) | Minimum for unfurlers | Yes | Medium: a directory still cannot find the manifests; `og:image` may be relative | None | Rejected as the fix (kept in A) |
| C | `og:image` pointing at an external host | Remote preview image | **No** | **Rejected**: CSP is `img-src 'self' data:`, so a remote image is blocked on the page itself and would be a broken preview for anyone on our origin | Low | Rejected on the CSP constraint |
| D | Inject the tags with JavaScript after load | SPA sets `<head>` at runtime | Yes | **Rejected**: crawlers and unfurlers read the static HTML; JS-set tags are invisible to the audience this block serves | Low | Rejected — serves nobody |
| E | A new discovery document nobody is sent to | Add `/og.txt` | Yes | The L64/L65 laws already cover documents; adding one more that no `<head>` names adds a step instead of removing one | Low | Rejected |

## Why A wins

1. **It is the only candidate that both classifies the page and points at the manifests.** A crawler
   gets `og:title`/`og:type` to classify and `meta name="agent-manifest"` / `<link rel="alternate"
   type="application/json">` to reach `/agent.json`.
2. **Every tag is absolute and verifiable on the served bytes.** `og:url`, `og:image` and canonical
   are absolute URLs on the canonical origin; a test fetches the live origin and asserts them there,
   so a relative value cannot pass.
3. **It is falsifiable without a browser.** The tests parse the served HTML with a regex/DOM-free
   parser and assert each attribute exactly — a typo in an attribute name fails the law.
4. **It respects the constraints already in code**: CSP `default-src 'self'` (so the image is a local
   SVG file, served same-origin, not a data URI that some unfurlers reject and not an external host),
   and the `/unstuck/api` base unchanged.

## Exclusions applied (from the brainstorm's challenges)

- *"Avoid an external `og:image`."* — kills C; the CSP `img-src 'self' data:` forbids it and a broken
  preview is worse than none. The image is a same-origin `/og.svg`.
- *"Avoid a tag that only appears after JavaScript runs."* — kills D; the audience is the crawler.
- *"Avoid a fix that cannot fail a test."* — kills a prose-only change: each attribute is asserted.

## What was NOT done, and why

- No change to the SPA's behaviour, the API, or the money path. This block moves `<head>` metadata and
  adds two root files (`robots.txt`, `sitemap.xml`); it touches no endpoint and no ledger number.
- No change to `llms.txt` / `agent.json`: blocks 106–114 already govern those and adding links here
  would widen the block without adding a law.
