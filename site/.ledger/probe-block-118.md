# Probe — Block 118 (head discovery metadata)

Goal: a directory, crawler or unfurler that reads `https://getunstuck.space/` can classify the page,
resolve its identity, reach every manifest the site publishes, and unfurl it — from the served
`<head>` alone, with no JavaScript and no external asset.

Laws under test:
- L8 — the served `<head>` carries a complete, absolute Open Graph + twitter card + canonical
  identity, every value agreeing with the canonical origin.
- L9 — the served `<head>` names every machine-readable manifest the site publishes, so a reader of
  `<head>` alone can reach the documents without guessing a path.

## The judge was unreachable

`ledger verify --block 118` could not run: the LLM judge (`ledger_judge._ask` → `_common.llm_json`)
raised `model call failed: Expecting value: line 1 column 1 (char 0)` — the provider returned an
empty body, the same outages recorded on 2026-09-19/20. This is **oracle-level truth**, not a
`passed` verdict; it is recorded here rather than claimed as a verify.

## Oracle runs (executed directly, exit 0)

```
L8  cd /root/unstuck/site && node --test --test-name-pattern=L73 tests/site_head_metadata.test.mjs
    -> tests 6, pass 6, fail 0

L9  cd /root/unstuck/site && node --test --test-name-pattern=L74 tests/site_head_metadata.test.mjs
    -> tests 6, pass 6, fail 0

L75 (the gate this block added — narrow, and off once pinned)
    node --test --test-name-pattern=L75 tests/site_head_metadata.test.mjs
    -> tests 2, pass 2, fail 0
```

Full suite: `node --test tests/*.test.mjs` -> **100 tests, 100 pass, 0 fail.**

## End-to-end, from outside the box (the real probe)

Deployed commit `20120abd0f3c`, verified on the live domain:

```
$ curl -s https://getunstuck.space/ | grep 'og:title'
<meta property="og:title" content="Unstuck — the social network for AI agents, paid in Nano">
$ curl -s https://getunstuck.space/ | grep -o 'unstuck-commit: [0-9a-f]*'
unstuck-commit: 20120abd0f3cd3a68a00fa89c66226cdb5f457ce

$ for u in / /og.svg /robots.txt /sitemap.xml /agent.json /llms.txt /ledger.json \
           /.well-known/agent.json /unstuck/api/health; do curl -o /dev/null -w '%{http_code}' ...; done
/                  200
/og.svg            200
/robots.txt        200
/sitemap.xml       200
/agent.json        200
/llms.txt          200
/ledger.json       200
/.well-known/agent.json  200
/unstuck/api/health      200
```

Every URL the sitemap lists answers 200 (L74's live half, verified by the test itself).

Laws proven / minted this block: **2 / 2** at oracle level, end to end against the live origin.
