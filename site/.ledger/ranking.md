# Ranking — how to document the no-wallet ask path

## The decision space

The capability already existed on the server (Block 108). Nothing a visitor could read named it.
So the design question was never "what should the API do" but "what must a document say so an
agent derives a working first call". Candidates considered:

| # | Candidate | Mechanism | Feasible here | Risk | Novelty | Verdict |
|---|-----------|-----------|---------------|------|---------|---------|
| A | Add `first_call` recipe + the on-ramp endpoint to `agent.json`, and a NO-wallet section to `llms.txt` | Structured recipe in both doc kinds; named paths relative to the API base | Yes — pure document edit | Low: no code path changes | New combination: an identity-handoff slot no existing convention has | **CHOSEN** |
| B | Rely on `/try-nano`'s existing prose alone | It already says "get a Nano address" | Yes | High — it tells the agent to generate a keypair itself and never names the network's own one-call endpoint; the 2026-09-19 measurement confirmed no reader derived it | None | Rejected as the fix (kept as the human-readable page) |
| C | Add a third discovery document (e.g. `/onboard.txt`) | A new file for the path only | Yes | An agent that never hears about the new file still cannot find it — adds a discovery step instead of removing one | Low | Rejected: a document nobody is sent to is not discovery |
| D | Bake the two calls into the SPA's UI copy | Human-visible quickstart | Yes | Serves humans, not agents; the target reads llms.txt/agent.json | Low | Rejected for this block (worth a later block) |
| E | Have `POST /ask` accept a bare name and mint an identity server-side | Removes the onboard_id handoff entirely | Yes | **Rejected on principle**: the asker field would become a fiction, and L68's strictness (unknown onboard_id → 400) is exactly the thing that keeps `standing` honest | High but wrong | Rejected — it would trade a real law for convenience |

## Why A wins

1. **It is the only candidate that makes the existing capability visible in both arrival modes.**
   A text-reading agent scans `llms.txt` under a heading; a parser reads `agent.json`'s endpoint
   list. Documenting in one only makes the path invisible to half the arrivals (feature 3).
2. **It names both halves, not one.** The on-ramp path alone leaves the agent knowing it can get
   an address but not that the ask it is about to post takes `onboard_id`. L67 asserts the
   handoff, not merely the URL.
3. **It is falsifiable end to end.** L68 runs the two documented calls against the live origin
   and requires a real 201 with the handed-out address stored as the asker — a sentence saying it
   would work would satisfy nothing.
4. **It uses paths already covered by the block-106 laws.** Both paths are relative to
   `/unstuck/api`, so L64/L65 (every documented path answers; the base is never the bare root)
   keep governing the new lines for free.

## Exclusions applied (from the brainstorm's challenges)

- *"Avoid ideas that involve a new document nobody is sent to."* — kills candidate C: discovery
  is the problem, not the missing artifact.
- *"Avoid ideas that make the asker field anything other than a Nano address."* — kills E; it
  would have made `standing` unprovable, and the network's whole claim rests on standing being
  distinct funded counterparties.
- *"Avoid a fix that cannot fail a test."* — kills B alone: prose that no test reads is the exact
  state the block was written to correct.

## What was NOT done, and why

- No change to `try-nano.html`: it is the human/HTML page and already answers a browser's
  `Accept: text/html`. Editing it would have widened the block's scope without adding a law.
- No new endpoint, no new money path, no change to the starter. This block moves documentation
  only — the cheapest possible change that unblocks the funnel's first step.
## Brainstorm: what the next improvement is (recorded, not built this block)

16 ideas from four angles across four features (`.ledger/tmp/brainstorm-ideas.json`). The
convergent finding, and it is a real one:

**Every strong idea moves the path from prose into runtime.** The recurring mechanism across
the top ideas is a *self-revealing* response — a small machine-readable block that the server
returns so the correct next call is derivable from a response, not inferred from a document:

- the on-ramp response carrying a `next` object with the exact `POST /ask` body and the
  `onboard_id` field named, so the agent pipes it in verbatim instead of mapping name → field;
- the same bootstrap descriptor echoed in the *error* body of a rejected call, so an agent that
  never read the docs still converges on a 201;
- a self-verifying handshake the agent can run before committing its own first post.

Why this is worth doing next and not now: it is a **server change** (`nserver-persist.js`) and a
new endpoint contract, which is a different block with its own laws and its own risk. This block
is documentation-only on purpose — it is the cheapest change that unblocks the funnel's first
step, and widening it would have put an API change behind a document commit.

The convergence is the signal: three of the four features independently produced "the response
should name the next call". That is the next block, not a passing remark.

---

# Ranking (Block 114) — publishing the on-ramp check as a runnable artifact

30 ideas returned (6 features × 5 angles, `.ledger/ideas-114.json`); 25 of the 30 named an
integrity or drift check, which is the signal this step is about.

## The decision space

| # | Candidate | Mechanism | Feasible here | Risk | Verdict |
|---|-----------|-----------|---------------|------|---------|
| A | Copy the script to `site/nano-onramp-check.js`, name it at `https://getunstuck.space/nano-onramp-check.js` from a `## Verify it yourself` section in llms.txt, and pin the published copy's SHA-256 in a test | One file, one URL, origin-relative; the discovery law already walks llms.txt paths | Yes — static file, no build | Low: no code path, no money, no new endpoint | **CHOSEN** |
| B | Publish it under a content-addressed name (`nano-onramp-check.<sha256>.js`) and name that hashed URL in llms.txt | The filename *is* the hash, so an agent verifies with one fetch | Yes | A new name every edit; llms.txt must be rewritten in lockstep or the documented path 404s | Deferred — the pin gives the same guarantee without renaming on every edit |
| C | Add `--expect-sha256` / `--verify` to the script so it self-checks against the llms.txt pin before running | Tamper-evident handshake | Yes | Adds a mode to a file whose Block-113 laws are already minted and passing; `--self-test` already exists and is tested | Rejected for this block: scope, and L65 already covers behaviour |
| D | Name the artifact in `agent.json` / `.well-known/agent.json` as well as llms.txt | More surfaces | Yes | Four files to keep in sync, and the JSON docs are endpoint manifests — a download is not an endpoint | Rejected: widens the drift surface for no new reader |
| E | Serve a friendly alias (`/opener/nano-onramp-check.js`) mirroring the repo layout | Familiar path | Yes | `/opener/` is not a directory the site serves; it invites the belief that other repo paths are fetchable | Rejected — a path that suggests a checkout that is not there |
| F | Add a `/download/` route via `vercel.json` redirect | "Download" is a clear verb | Yes | A second documented route to one artifact; the origin-relative law then has two paths to keep true for no gain | Rejected |
| G | Publish the script's output as a static JSON result and name *that* | Nothing to run | Yes | **Rejected on principle**: a static result is a claim the agent must trust. The point of the artifact is that the agent measures rather than believes | Rejected — it would publish a claim instead of a measurement |
| H | Have the check POST to the public network by default so the run is visible | Visible activity | Yes | **Rejected on principle**: an ask written by our own software is our own activity. The network's numbers only mean something if outside agents produce them | Rejected — it fabricates the number the network is measured on |

## Why A wins

1. **It is the cheapest change that turns a repository file into a fetchable measurement.**
   One copy, one URL, one llms.txt section, one test. No build step, no endpoint, no money.
2. **It is byte-identical by construction.** The site copy *is* the only copy the origin serves,
   and the test pins its SHA-256 against the opener's, so the artifact a stranger runs is the one
   the repo's L65 oracle exercised (feature 5).
3. **It inherits the discovery laws already in force.** `documentedDocPaths()` walks llms.txt for
   origin-relative paths and L64 fetches every one on the live origin, so the new URL is checked
   for reachability the moment it is named — without editing the law (feature 1).
4. **It keeps the network's denominator clean.** The artifact's default mode already posts to a
   local scratch server (Block 113), so publishing it adds no row to the public network
   (feature 6). Candidate H would have done the opposite.
5. **It is falsifiable.** The published copy is pinned by digest; one byte of drift fails the
   test, and the test names which side changed.

## Exclusions applied (from the brainstorm's challenges)

- *"Anything that publishes a result instead of a measurement."* — kills G. An agent must be able
  to reproduce the claim, not read it.
- *"Anything that puts our own writes on the public network."* — kills H, and preserves the rule
  that an ask nobody outside produced is not adoption.
- *"Do not add a second copy that can drift."* — kills the mirror and alias variants (E, F) and
  forces the digest pin (A).
- *"Do not widen the change into the server, the money path or the Block-113 laws."* — kills C and
  D; a website block that changes a minted oracle's behaviour is how a passing law goes quiet.
- *"A documented path must not be able to 404."* — the reason B is deferred: a content-addressed
  filename 404s for every reader the moment llms.txt is edited without renaming the file, and the
  pin in A gives the same evidence with none of that coupling.

## What was NOT done, and why

- No change to `opener/nano-onramp-check.js`. Its behaviour is what Block 113's laws already pin;
  this block publishes those bytes and proves the published bytes are those bytes.
- No new endpoint, no new money path, no starter. This block moves one file and one document.
- The script is not named in `agent.json`: that manifest describes API *endpoints*, and a
  downloadable program is not one. Widening it would add three more files to keep in sync.
