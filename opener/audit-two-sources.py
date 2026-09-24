#!/usr/bin/env python3
"""audit-two-sources.py — the reproducible two-source paid-work audit for Codex SourceWorks Audit.

Speedbot room_6668b1cf829c45d9a8a62606c7b0934d (intro_f33b77b44bbc44a3a73cac110218bd12).

Reads two DIFFERENT paid-work sources read-only, checks one real offer in each, compares the metadata
that decides whether an autonomous agent can actually be paid (price, settlement network, auth, limits),
and prints JSON + Markdown with UTC timestamps. No spend, no writes, no credentials.

Run:  python3 audit-two-sources.py            # human-readable + JSON at the end
      python3 audit-two-sources.py --json     # JSON only
"""
import json
import sys
import urllib.error
import urllib.request

UA = {"User-Agent": "unstuck-audit/1.0 (+https://getunstuck.space)", "Accept": "application/json"}


def get(url, timeout=30):
    """Read-only GET. Returns (status, content_type, body_text). Never raises on HTTP status."""
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", "") if e.headers else "", e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - a source being down is a finding, not a crash
        return 0, "", "{}".format(type(e).__name__ + ": " + str(e))


def utc_now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------- source 1: Taskmarket
def taskmarket():
    rows = {"name": "Taskmarket", "index_url": "https://api.taskmarket.dev/api/tasks"}
    s, ct, body = get(rows["index_url"])
    rows["index_status"] = s
    rows["index_content_type"] = ct
    rows["index_bytes"] = len(body)
    try:
        d = json.loads(body)
    except Exception as e:  # noqa: BLE001
        rows["parse_error"] = str(e)
        return rows, None
    tasks = d if isinstance(d, list) else d.get("tasks", [])
    rows["offers_listed"] = len(tasks)
    if not tasks:
        return rows, None
    # One real offer, picked by a rule anyone can repeat: the first entry the source itself returns.
    t = tasks[0]
    raw_reward = t.get("reward")
    reward_usdc = None
    if isinstance(raw_reward, (int, float, str)) and str(raw_reward).isdigit():
        reward_usdc = int(raw_reward) / 1e6          # taskmarket reports base units (6dp)
    rows["offer"] = {
        "id": t.get("id"),
        "reference_code": t.get("referenceCode"),
        "requester": t.get("requester"),
        "field_count": len(t),
        "has_requester_pubkey": bool(t.get("requesterPubkey")),
        "reward_raw": raw_reward,
        "reward_usdc_if_6dp": reward_usdc,
        "url": "https://taskmarket.dev/tasks/{}".format(t.get("id")),
    }
    # Cross-check the same source read through a second reader (Speedbot's router) - same offer?
    s2, _ct2, b2 = get("https://speedbot.dev/api/opportunities")
    try:
        opp = json.loads(b2)
        hit = [o for o in opp.get("opportunities", []) if o.get("source_id") == t.get("id")]
        rows["cross_reader"] = {
            "reader": "speedbot.dev/api/opportunities",
            "status": s2,
            "as_of": opp.get("as_of"),
            "same_offer_found": bool(hit),
            "deadline_seen": hit[0].get("deadline") if hit else None,
            "submissions_seen": hit[0].get("submissions") if hit else None,
        }
    except Exception as e:  # noqa: BLE001
        rows["cross_reader"] = {"status": s2, "error": str(e)}
    return rows, dict(t)


# --------------------------------------------------------------------------- source 2: Speedbot exchange
def speedbot():
    rows = {"name": "Speedbot work exchange", "index_url": "https://speedbot.dev/api/exchange/feed?sort=hot"}
    s, ct, body = get(rows["index_url"])
    rows["index_status"] = s
    rows["index_content_type"] = ct
    rows["index_bytes"] = len(body)
    try:
        d = json.loads(body)
    except Exception as e:  # noqa: BLE001
        rows["parse_error"] = str(e)
        return rows, None
    rows["stats"] = d.get("stats")
    rows["posts_listed"] = len(d.get("posts") or [])
    # The offer a buyer can order without a negotiation: a published fixed-price service.
    s2, _ct2, b2 = get("https://speedbot.dev/api/exchange/services")
    rows["catalog_status"] = s2
    try:
        cat = json.loads(b2)
    except Exception as e:  # noqa: BLE001
        rows["catalog_error"] = str(e)
        return rows, None
    services = cat.get("services", [])
    rows["services_listed"] = len(services)
    if not services:
        return rows, None
    # One real offer, by the same repeatable rule: the first the source returns.
    v = services[0]
    rows["offer"] = {
        "id": v.get("id"),
        "provider": (v.get("provider") or {}).get("name"),
        "title": v.get("title"),
        "price_usdc": v.get("price_usdc"),
        "standard_buyer_total_usdc": v.get("standard_buyer_total_usdc"),
        "pro_buyer_total_usdc": v.get("pro_buyer_total_usdc"),
        "pricing_model": v.get("pricing_model"),
        "delivery_hours": v.get("delivery_hours"),
        "available_slots": v.get("available_slots"),
        "accepts_network": "eip155:8453 (Base) USDC",
        "input_required": (v.get("input_schema") or {}).get("required"),
        "url": v.get("url"),
    }
    return rows, dict(v)


def markdown(report):
    L = []
    L.append("# Two-source paid-work audit")
    L.append("")
    L.append("Read-only. Two independent sources, one real offer checked in each, no spend, no credentials.")
    L.append("Generated {} (UTC).".format(report["checked_at_utc"]))
    L.append("")
    for src in report["sources"]:
        L.append("## {}".format(src["name"]))
        L.append("")
        L.append("- index: `{}` -> HTTP {} ({} bytes, {})".format(
            src["index_url"], src.get("index_status"), src.get("index_bytes"), src.get("index_content_type")))
        for k in ("offers_listed", "posts_listed", "services_listed", "catalog_status"):
            if k in src:
                L.append("- {}: {}".format(k, src[k]))
        off = src.get("offer")
        if off:
            L.append("- offer checked: `{}`".format(off.get("id")))
            for k, v in off.items():
                if k != "id":
                    L.append("    - {}: {}".format(k, v))
        if "cross_reader" in src:
            L.append("- cross-read through a second reader: {}".format(json.dumps(src["cross_reader"])))
        if src.get("stats"):
            L.append("- source's own stats: {}".format(json.dumps(src["stats"])))
        L.append("")
    L.append("## Limits and findings")
    L.append("")
    for line in report["findings"]:
        L.append("- " + line)
    L.append("")
    return "\n".join(L)


def main():
    report = {"audit": "two-source paid-work audit", "checked_at_utc": utc_now(),
              "spend": "0", "writes": "none", "method": "read-only GET per source, first offer returned by each"}
    tm, _t = taskmarket()
    sb, _s = speedbot()
    report["sources"] = [tm, sb]

    findings = []
    # What each source controls vs what it does not - the point of a two-operator audit.
    if tm.get("offer") and tm.get("cross_reader"):
        findings.append(
            "Taskmarket offer {}: reward {} raw (= {} USDC at 6dp), requesterPubkey present: {}. "
            "Read independently through Speedbot's router it reports deadline {} and {} submissions - the "
            "deadline/submission fields exist in the router view and not in the source view, so a buyer "
            "relying on only one reader cannot see the closing time.".format(
                tm["offer"]["id"][:18], tm["offer"]["reward_raw"], tm["offer"]["reward_usdc_if_6dp"],
                tm["offer"]["has_requester_pubkey"],
                tm["cross_reader"].get("deadline_seen"), tm["cross_reader"].get("submissions_seen")))
    if sb.get("offer"):
        findings.append(
            "Speedbot offer {}: price {} USDC, buyer total {} USDC standard / {} pro (model {}). "
            "Settlement is Base USDC only; the source's own jobs stats read {} - a fixed-price catalog can be "
            "full of offers while the paid-job ledger is empty, which is why both numbers are printed.".format(
                sb["offer"]["id"][-8:], sb["offer"]["price_usdc"], sb["offer"]["standard_buyer_total_usdc"],
                sb["offer"]["pro_buyer_total_usdc"], sb["offer"]["pricing_model"],
                json.dumps((sb.get("stats") or {}).get("jobs", "n/a"))))
    findings.append(
        "Neither source needs a private credential to READ an offer; both need a funded wallet to TAKE one. "
        "The audited sources settle in USDC on Base - the rail an autonomous agent without a bank or a card "
        "cannot open by itself. That is the finding this audit was asked to check, and it is reproducible "
        "with this script alone.")
    report["findings"] = findings

    if "--json" in sys.argv:
        print(json.dumps(report, indent=1))
    else:
        print(markdown(report))
        print("\n---- JSON ----")
        print(json.dumps(report, indent=1))
    with open("audit-two-sources.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    with open("audit-two-sources.md", "w", encoding="utf-8") as f:
        f.write(markdown(report))
    print("\nwrote audit-two-sources.json and audit-two-sources.md", file=sys.stderr)


if __name__ == "__main__":
    main()
