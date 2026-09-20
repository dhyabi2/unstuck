# Benchmark (Block 118) — what an agent directory reads out of a page's `<head>`

Goal: an agent directory or crawler that fetches `https://getunstuck.space/` must be able to classify
the page (what it is), resolve its identity (`og:url`), discover its machine-readable manifests, and
unfurl it for a human — all from the served `<head>`, with no JavaScript and no external asset fetch.

| # | Solution | What it is best at | Source |
|---|----------|--------------------|--------|
| 1 | Open Graph protocol (`og:*`) | The de-facto interchange for a page's identity: `og:title`, `og:description`, `og:type`, `og:url`, `og:image`, `og:site_name`. Every unfurler and most crawlers read it. | https://ogp.me |
| 2 | OGP `og:image` with an absolute URL | The one OG tag that breaks silently: a relative or missing `og:image` yields no preview. Must be absolute. | https://ogp.me/#structured |
| 3 | `twitter:card` / `twitter:title` / `twitter:description` / `twitter:image` | Fallback used by X/LinkedIn when OGP is partial; `summary_large_image` is the shape a link-preview renders. | https://developer.x.com/cards |
| 4 | Standard `<link rel="canonical">` | Tells a crawler the one URL to index when the content is reachable at several origins (we serve the same page on `getunstuck.space` and the sslip.io TLS host). | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| 5 | `/sitemap.xml` + `robots.txt` | The crawler contract: robots grants crawl + points at the sitemap; the sitemap enumerates the indexable URLs. | https://www.sitemaps.org/protocol.html |
| 6 | Schema.org JSON-LD (`@type: WebSite`) | Machine-readable structured data a directory parses to get name/url/description without regexing meta tags. | https://schema.org/WebSite |
| 7 | `agent.json` / `.well-known/agent.json` | Already shipped (blocks 106–114). Best at *endpoint* discovery. | this repo |

What is common to 1–6: a crawler defaults to the `<title>` and meta description, and a directory that
cannot classify a page does not list it. Our page ships only `<title>` and `meta name="description"`,
plus the discovery documents in 7 which nothing in the `<head>` points at.

The gap this block closes: the manifests exist (`/agent.json`, `/llms.txt`, `/ledger.json`,
`/.well-known/agent.json`) and answer 200, but the served `<head>` names **none** of them and carries
**no** OG/twitter/canonical/sitemap metadata. An agent directory that reads `<head>` — which is what the
directories we registered with (e.g. allagents.app) do — sees a title and a description and nothing else.

Prior art check: OG + canonical + sitemap is a **new combination for this site**, not a new mechanism.
Each is standard; what the site lacked was any of it, and what is worth a law is that the tags are
present, absolute and mutually consistent on the *served* bytes (not merely in the source file).
