#!/usr/bin/env python3
"""Find where an A2A agent really takes JSON-RPC, BEFORE sending it a message.

Measured 2026-10 (agent-conversations: Agent-Ready, ClearedIndex, PHION, PoolParty, Council-of-AI, Agoragentic, HERE,
SCVD-Evidence): resume_waiting.py POSTed `message/send` to the agent-card URL itself (a static JSON document that answers
GET only: HTTP 405), to hosts that 308-redirect, and to registry pages that answer HTML. Every attempt was recorded as a
conversation attempt and none could reach one.

The rule: the card is READ (GET, redirects followed, 308 included), and the JSON-RPC endpoint is the card's own declared
`url` (or the JSONRPC entry of `additionalInterfaces` / `supportedInterfaces`). Nothing is ever POSTed to a card, to a
registry listing, or to anything that answered HTML.

    resolve(url, get=http_get) -> {"ok": bool, "endpoint": str|None, "reason": str, "card_url": str|None}

`get(url)` returns (status, final_url, content_type, body_text) and may raise; tests pass a fake. No network at import.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

UA = "unstuck/1.0 (+https://getunstuck.space)"
MAX_HOPS = 5
CARD_PATHS = ("/.well-known/agent-card.json", "/.well-known/agent.json")
REGISTRY_HOSTS = ("a2a-registry.org", "www.a2a-registry.org", "a2acards.ai", "www.a2acards.ai")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http_get(url, timeout=20):
    """GET with redirects followed by hand (301/302/303/307/308), at most MAX_HOPS."""
    opener = urllib.request.build_opener(_NoRedirect)
    cur = url
    for _ in range(MAX_HOPS + 1):
        req = urllib.request.Request(cur, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with opener.open(req, timeout=timeout) as r:
                return r.status, cur, r.headers.get("Content-Type", ""), r.read(200000).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location")
            if e.code in (301, 302, 303, 307, 308) and loc:
                cur = urllib.parse.urljoin(cur, loc)
                continue
            return e.code, cur, e.headers.get("Content-Type", ""), e.read(2000).decode("utf-8", "replace")
    return 310, cur, "", ""


def _is_card_url(url):
    p = urllib.parse.urlparse(url).path.lower().rstrip("/")
    return p.endswith("/agent-card.json") or p.endswith("/agent.json") or p.endswith("/.well-known/agent")


def _json_or_none(status, ctype, body):
    if status != 200:
        return None
    if "html" in (ctype or "").lower() or body.lstrip()[:1] == "<":
        return "html"
    try:
        d = json.loads(body)
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


def endpoint_from_card(card, card_url):
    """The JSON-RPC URL the card declares, or (None, reason)."""
    transport = str(card.get("preferredTransport") or "JSONRPC").upper()
    cands = []
    if transport == "JSONRPC" and card.get("url"):
        cands.append(card["url"])
    for key in ("additionalInterfaces", "supportedInterfaces"):
        for it in card.get(key) or []:
            if isinstance(it, dict):
                t = str(it.get("transport") or it.get("protocolBinding") or "").upper().replace("-", "")
                if t in ("JSONRPC", "JSONRPC2.0") and it.get("url"):
                    cands.append(it["url"])
    for c in cands:
        u = urllib.parse.urljoin(card_url, str(c))
        if urllib.parse.urlparse(u).scheme in ("http", "https"):
            return u, "card_declared_url"
    return None, "no_jsonrpc_interface_declared"


def resolve(url, get=http_get):
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if _is_card_url(url) or host in REGISTRY_HOSTS:
        tries = [url]
    else:
        base = f"{urllib.parse.urlparse(url).scheme}://{urllib.parse.urlparse(url).netloc}"
        tries = [base + p for p in CARD_PATHS]
    last = "no_card_found"
    for t in tries:
        try:
            status, final, ctype, body = get(t)
        except Exception as e:  # noqa: BLE001
            last = f"unreachable:{type(e).__name__}"
            continue
        d = _json_or_none(status, ctype, body)
        if d == "html":
            last = "html_page_not_a_card"  # a registry listing or website: never POST to it
            continue
        if d is None:
            last = f"no_card_http_{status}"
            continue
        ep, why = endpoint_from_card(d, final)
        if ep:
            return {"ok": True, "endpoint": ep, "reason": why, "card_url": final}
        last = why
    return {"ok": False, "endpoint": None, "reason": last, "card_url": None}
