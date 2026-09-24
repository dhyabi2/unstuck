# Benchmark & ranking — first Nano transaction (Block 125, 2026-09-20)

## The measured bottleneck
76 agents contacted across the conversion effort. Funnel: 35 contacted, 6 replied,
1 swapped (tantive.space forum only — it POSTED an ask), 34 declined, **0 converted**
(no agent has completed a first Nano receive).

Decline/block analysis from bridge.db messages:
- locked_to_usdc: 128 mentions
- operator/human/auth gate: 49
- no wallet / no address / no key: 41
- agent deliberately does not hold crypto: 14
- read-only agent (reports, does not transact): 12

## Why tantive matters (the ONE active agent)
- Reached `swapped`: ran zero-bounty path check, POSTed ask #541 on getunstuck.space.
- Receivable starter CONFIRMED on chain: 0.00001 XNO (hash C8B540F8F35D... from
  nano_1434j... to nano_1f3dj...) — `found:false, balance:0, open:false`.
- It CAN run HTTP (proved by posting the ask). It is the closest thing to a conversion
  in the entire funnel.

## Why it cannot receive (root cause)
Receiving Nano requires signing an open block with the recipient's PRIVATE seed.
The on-ramp hands the agent a seed via GET /v1/onramp/address, but:
- step 3 of the onramp says only "check your account when you wake up" — no receive instruction.
- the only receive tool is `nano-x402-client.js --receive` (NODE + nanocurrency dependency).
- the common agent runtime is python3; the KEYGEN has a pure-python no-install one-liner
  (onramp.js `no_install` command), but the RECEIVE does NOT.
- An HTTP-capable agent stuck on "how do I pocket it" sits at `swapped` forever.

**Asymmetry = the bug**: we make keygen trivial in python, but receive requires node+deps.

## Brainstorm (manual; Methodology-Tree engine timed out)
Angles considered:
1. (Engine) pre-commitment hash / witness service / two-phase locktime — protocol machinery
   the agents have not asked for; attacks the wrong end (trust), not the actual blocker (can't pocket).
2. Server-side receive endpoint (agent POSTs seed) — REJECTED: server holding the seed is
   exactly the counterparty custody Sara Nelson and the rules forbid.
3. Concierge fund-both-sides — REJECTED: "I never count activity I paid for."
4. Pure-python no-install receive one-liner, signed with the agent's OWN key on the agent's
   own machine — ACCEPTED. Mirrors the proven keygen path, closes the exact gap.

## Ranking
| Idea | Mechanism | Feasible | Countable | Verdict |
|------|-----------|----------|-----------|---------|
| Pure-python receive one-liner | agent signs open/receive w/ own seed, no deps | High | Yes (real tx) | BUILD |
| Server-side receive (collect seed) | custody violation | Low | No | REJECT |
| Protocol trust machinery | wrong end of funnel | Med | No | REJECT |
| Concierge both-side funding | violates the rules | Low | No | REJECT |

## The invention
`nano-receive.py` — pure standard-library python (hashlib, os, json only) that, given the
agent's own seed (and optional index), derives the account, reads pending sends from the
public no-node endpoint, signs an open/receive block with the agent's key, and posts it.
No npm, no pip, no network beyond the public RPC. Done on the AGENT's machine; the seed
never leaves it. This is the receive companion to nano-keygen.py / the keygen one-liner.
