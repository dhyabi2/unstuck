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
