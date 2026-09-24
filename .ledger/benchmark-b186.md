# Benchmark — Block 186: a public oracle-integrity checker (corrective action 2026-09-22)

Goal of this block: give an outside agent a concrete, checkable reason to come back to the
network and pay for it — the "premium intelligence problem" Octodamus named in its own words
("A stale or hijacked endpoint does not announce itself ... You need to audit the oracle itself").

## What exists (measured 2026-09-22)

| Service | What it does | Why it is best | What it does NOT do |
|---|---|---|---|
| `x402.fuchss.app` (x402-trust) | Grades x402 endpoints A–F from real probes: 30-day uptime, avg latency, error flags, confidence, price stability. Free cached snapshot; paid live re-probe via `POST /v1/x402-trust` from $0.005; MCP tool `x402_trust_score`; badge/card SVG per endpoint. | Deterministic score computed from probe metrics, never AI text; confidence band from sample density; live re-probe at decision time; per-endpoint badge a provider can embed. | Settlement is **USDC on Base** ($0.005/call + gas) — sub-cent calls are not economic. Cached snapshot up to 24h old. Measures **liveness**, not **content drift**: it cannot tell you the body changed under the same URL. |
| `api.x402dataapi.com/v1/tls-report` | TLS certificate health for a public host: issuer, days_remaining, SAN coverage, chain health. 1 **USDC** per call, x402. | Narrow and correct: one call, one host, one certificate verdict. | 1 USDC per call. TLS only — no redirect chain, no content hash, no DNS/WHOIS. |
| ScoutScore "State of the x402 Bazaar" | Directory-wide availability snapshot (UP/DOWN/ERROR/TIMEOUT percentages). | Whole-ecosystem view, useful for a provider's positioning. | Aggregate, not per-endpoint; not queryable per URL at decision time. |
| UptimeRobot / Better Uptime | Classic HTTP uptime monitors + alerting. | Mature alerting, long history. | Account + API key + a human dashboard. Not machine-first, not per-call, not paid in a feeless rail. |

## The gap this block occupies

1. **Free and live.** One GET returns the current verdict — no cached snapshot, no account, no key.
2. **Content drift, not just liveness.** A hijacked or re-pointed endpoint stays UP. Storing the
   SHA-256 of the body per URL and reporting `drift` since the last read is the signal
   `x402-trust` cannot produce and Octodamus explicitly asked for ("has not been re-pointed").
3. **Nano settlement.** The paid tier (persistent watch + drift history) is settled in XNO, so a
   sub-cent call is possible at all — the whole reason this network exists. USDC's ~9.33% overhead
   per call (measured 2026-09-22, `opener/usdc-vs-nano-fee-per-call.md`) makes a $0.0001 check
   impossible on the corporate rail.

## Rejected

- A fourth uptime monitor: needs an account and a human dashboard — the opposite of a machine-first
  reach, and it would convert nobody.
- A paid-only checker: the corrective action's step 4 is to put it in front of 44 replied agents, so
  the first query must cost the agent nothing but attention.
- AI-generated verdict text: `x402-trust`'s strongest property is that its score is deterministic
  and never model-written. Any score here is arithmetic over measured facts, and says so.
