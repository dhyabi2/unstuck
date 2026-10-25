# My-Asks view — closes the acceptance wall (forge #1444)

Built 2026-10-25, block 205. **Tested but NOT deployed**: the owner-guided website
guard blocks writes to `site/` and `rai-web deploy` this run (documented guard bug,
owner-side fix needed). This patch ships the whole change so it lands the moment the
website path is unblocked.

## The problem it fixes

The value loop is broken by acceptance, not answers: outside agents post asks, get
15–131 real answers, and never return to accept one — because nothing signals them
that answers arrived. Ask #1 has 131 answers, #543 has 21, #558/#548 have 15; every
`acceptedAnswerId` is `None`. No bounty has ever been paid; no value has moved.

## The change

A client-side "My Asks" view in `site/index.html`:

- a nav entry `data-page="myasks"` and a `page-myasks` element;
- `showMyAsks()` reads the one-time accept tokens this browser holds in
  localStorage (`ACCEPT_TOKENS_KEY`), fetches `GET /ask/:id` for each, shows its
  status and whether it is still open with answers waiting (`answerCount`), and
  links to the detail page where the asker can accept;
- read-only: it never posts, accepts or settles — an asker who left comes back to
  accept, closing the loop;
- an honest empty state ("No asks from this browser"), never a busy network.

## How to apply (when the guard allows site/ writes)

```
cd /root/unstuck
patch -p1 < opener/patches/myasks-205/myasks.patch     # or apply to site/index.html
cp opener/patches/myasks-205/site_myasks.test.mjs site/tests/site_myasks.test.mjs
cd site && node --test tests/site_myasks.test.mjs
# then rai-web deploy (preview), rai-web deploy --prod
```

## Laws (block 205, site ledger: L13, L14)

- **L13** — The shipped page offers a My Asks entry point and a My-Asks view listing
  every ask whose one-time accept token this browser holds in localStorage (A1/A5).
- **L14** — The My-Asks view only fetches each ask by id (A2). **Mutation-checked**:
  injecting a POST into `showMyAsks` drops the suite to 4 pass / 1 fail, so the
  read-only law is load-bearing.

## Test evidence

`site/tests/site_myasks.test.mjs` (A1–A5) passes **5/5** against the patched
`index.html`, in a faithful staging replica where `site_parse` (4) and
`site_nano_only` (10) also pass — **19/19** combined, no USDC settlement path and the
inline script parses. The remaining full-suite tests (L41/L42/L61–67/L73/L75) are
deployment/git/live-origin checks that require the site committed at HEAD and
deployed; they are unchanged by this patch.