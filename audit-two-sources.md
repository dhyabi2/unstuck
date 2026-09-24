# Two-source paid-work audit

Read-only. Two independent sources, one real offer checked in each, no spend, no credentials.
Generated 2026-09-23T06:52:28Z (UTC).

## Taskmarket

- index: `https://api.taskmarket.dev/api/tasks` -> HTTP 200 (70410 bytes, application/json)
- offers_listed: 20
- offer checked: `0xbf396ef8896446f96e50618d269761c089222aeefb3ffc14fed7d6513163072c`
    - reference_code: TSK-7E1T965Z
    - requester: 0x436326b6772851Ca8Bd84F27e48d77A8668b34Bd
    - field_count: 41
    - has_requester_pubkey: True
    - reward_raw: 2000000
    - reward_usdc_if_6dp: 2.0
    - url: https://taskmarket.dev/tasks/0xbf396ef8896446f96e50618d269761c089222aeefb3ffc14fed7d6513163072c
- cross-read through a second reader: {"reader": "speedbot.dev/api/opportunities", "status": 200, "as_of": "2026-09-23T06:52:29.295Z", "same_offer_found": false, "deadline_seen": null, "submissions_seen": null}

## Speedbot work exchange

- index: `https://speedbot.dev/api/exchange/feed?sort=hot` -> HTTP 200 (14225 bytes, application/json; charset=utf-8)
- posts_listed: 0
- services_listed: 15
- catalog_status: 200
- offer checked: `service_da4a553ac6994dd782c065c1fef585ec`
    - provider: Softpeanut Data Steward
    - title: Build a reproducible data dictionary for one public CSV
    - price_usdc: 2.000000
    - standard_buyer_total_usdc: 2.160000
    - pro_buyer_total_usdc: 2.080000
    - pricing_model: buyer_fee_v1
    - delivery_hours: 24
    - available_slots: 1
    - accepts_network: eip155:8453 (Base) USDC
    - input_required: ['dataset_url']
    - url: https://speedbot.dev/services/service_da4a553ac6994dd782c065c1fef585ec
- source's own stats: {"jobs": 0, "paid_jobs": 0, "open_jobs": 0, "settled_volume_usdc": "0.000000", "platform_fees_usdc": "0.000000", "note": "Verified job transfers, not profit. Subtasks are separate transactions; volume is not unique external demand."}

## Limits and findings

- Taskmarket offer 0xbf396ef8896446f9: reward 2000000 raw (= 2.0 USDC at 6dp), requesterPubkey present: True. Read independently through Speedbot's router it reports deadline None and None submissions - the deadline/submission fields exist in the router view and not in the source view, so a buyer relying on only one reader cannot see the closing time.
- Speedbot offer fef585ec: price 2.000000 USDC, buyer total 2.160000 USDC standard / 2.080000 pro (model buyer_fee_v1). Settlement is Base USDC only; the source's own jobs stats read 0 - a fixed-price catalog can be full of offers while the paid-job ledger is empty, which is why both numbers are printed.
- Neither source needs a private credential to READ an offer; both need a funded wallet to TAKE one. The audited sources settle in USDC on Base - the rail an autonomous agent without a bank or a card cannot open by itself. That is the finding this audit was asked to check, and it is reproducible with this script alone.
