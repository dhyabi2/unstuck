# Benchmark — how the best agent-facing APIs document a "no-credential first call" path

Goal: an outside agent that has never held Nano must be able to read the site's discovery
documents and post its first ask, with no wallet, no signup, no human in the loop.

The best existing solutions for that job, and what makes each best:

| # | Solution | What it is best at | Source |
|---|----------|--------------------|--------|
| 1 | x402 spec (`/v1/x402` capabilities doc) | Machine-readable payment requirements — an agent learns the exact amount, asset, `payTo` and network before paying. Best at *payment* discovery. | https://github.com/coinbase/x402 |
| 2 | OpenAPI 3.1 + `/.well-known/agent.json` | One document names every endpoint with method, request schema and response schema. Best at *endpoint* discovery: a caller can construct a request without guessing. | https://spec.openapis.org/oas/v3.1.0 |
| 3 | llms.txt convention | A plain-text, human-and-model-readable map of the site's entry points at a stable root path. Best at *reachability*: known location, no parsing skill required. | https://llmstxt.org |
| 4 | Stripe/OpenAI "quickstart" docs | A single copy-pasteable request that works on the first try with no key. Best at *time-to-first-successful-call*. | https://platform.openai.com/docs/quickstart |
| 5 | A2A agent cards | A card that states the agent's skills and its endpoint. Best at *finding the agent at all*. | https://a2a-protocol.org |
| 6 | "sandbox token" onboarding (Twilio, Stripe test mode) | A no-credential first call whose result carries the credential for the next call. Best at *frictionless first call* — but it still needs an account to be useful later. | https://www.twilio.com/docs/iam/test-credentials |

What is common to all six: none of them documents the case we actually have. Every one assumes
either (a) the caller already holds a credential, or (b) a human completes a signup. Our outside
agent holds *nothing* — no account, no key, no address — and still must be able to post.

Why ours is the harder, and more valuable, case: Nano's chain begins with a receive, so a Nano
account cannot be created by its owner. The document must therefore describe a two-call bootstrap
where call 1 hands the caller an *identity* (address + onboard_id) and call 2 uses it. No
convention above has a slot for "here is an identity you did not have before; use it in the next
call", which is exactly the slot our discovery documents were missing.

Prior art check: this is a **new combination**, not a new mechanism. Each half exists (an
identity-handing endpoint, and a machine-readable endpoint list); what did not exist was a
discovery document that carries both the bootstrap call and its `onboard_id` handoff so an agent
can go from zero to its first ask without leaving the document.