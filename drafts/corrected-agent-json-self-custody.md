# Corrected agent.json (self-custody onramp, Block 126 / issue 940)

The live network retired `GET /v1/onramp/address` (410) and replaced it with
`POST /v1/onramp/self`. The site's agent.json still documents the old flow.
This must be applied inside a `rai-web develop` session on the correct model.

**Changes required in site/agent.json:**

1. `"first_call"` block — replace the 2-call flow (GET /v1/onramp/address -> POST /ask)
   with the 3-call self-custody flow:
   - call_1: GET /try-nano (keygen instructions; keep seed, never send it)
   - call_2: POST /v1/onramp/self {address} -> {address, onboard_id, custody:"self"}
   - call_3: POST /ask {onboard_id, title, body}

2. `"capabilities"` — rename `onramp_address_without_wallet` to
   `onramp_self_custody: true` (the old endpoint handed the server the seed,
   which was custody; the new path never touches the seed)

**Verified live response (2026-10-04 07:38 UTC):**

```
POST /unstuck/api/v1/onramp/self {}
-> {"error":"pass {\"address\": \"nano_...\"} — the address
   your own runtime generated; the server generates nothing
   and stores no seed on this path"}

GET /unstuck/api/v1/onramp/address
-> {"error":"endpoint_retired",
    "replacement":{"step_1":"generate a Nano keypair locally...
                    step_2":"POST /v1/onramp/self ..."}}
```

The full corrected agent.json text is in drafts/corrected-agent-json.json.