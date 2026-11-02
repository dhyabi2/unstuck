#!/usr/bin/env python3
"""The resume path reads the card with GET and POSTs only to the endpoint the card declares.

One case per failure measured in agent-conversations (Agent-Ready, ClearedIndex, PHION: 405 on POST to the card;
PoolParty, Council-of-AI, Agoragentic: 308/404; HERE, SCVD-Evidence: registry HTML answered as "delivered").
Run: python3 opener/test_a2a_endpoint.py
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import a2a_endpoint as a  # noqa: E402


def fake(table, calls=None):
    def get(url):
        if calls is not None:
            calls.append(url)
        v = table.get(url)
        if v is None:
            return 404, url, "text/html", "not found"
        if isinstance(v, Exception):
            raise v
        return v
    return get


def card(**k):
    return 200, None, "application/json", json.dumps(k)


class T(unittest.TestCase):
    def test_card_url_is_read_not_posted_and_declared_url_is_used(self):
        u = "https://agent-ready.dev/.well-known/agent-card.json"
        r = a.resolve(u, fake({u: (200, u, "application/json", json.dumps({"url": "https://agent-ready.dev/a2a/rpc"}))}))
        self.assertEqual((r["ok"], r["endpoint"]), (True, "https://agent-ready.dev/a2a/rpc"))
        self.assertNotEqual(r["endpoint"], u)

    def test_redirect_final_url_resolves_relative_declared_url(self):
        u = "https://clearedindex.com/.well-known/agent-card.json"
        fin = "https://www.clearedindex.com/.well-known/agent-card.json"
        r = a.resolve(u, fake({u: (200, fin, "application/json", json.dumps({"url": "/rpc"}))}))
        self.assertEqual(r["endpoint"], "https://www.clearedindex.com/rpc")

    def test_bare_site_url_looks_for_the_well_known_card(self):
        calls = []
        c = "https://www.poolparty.io/.well-known/agent-card.json"
        r = a.resolve("https://www.poolparty.io", fake({c: (200, c, "application/json", json.dumps({"url": "https://api.poolparty.io/a2a"}))}, calls))
        self.assertTrue(r["ok"])
        self.assertEqual(calls, [c])

    def test_registry_html_page_is_never_an_endpoint(self):
        u = "https://www.a2a-registry.org/agent/com.allher"
        r = a.resolve(u, fake({u: (200, u, "text/html; charset=utf-8", "<!doctype html><html>")}))
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "html_page_not_a_card")

    def test_registry_page_that_serves_a_json_card_is_used(self):
        u = "https://www.a2a-registry.org/agent/x"
        r = a.resolve(u, fake({u: (200, u, "application/json", json.dumps({"url": "https://x.example/rpc"}))}))
        self.assertEqual(r["endpoint"], "https://x.example/rpc")

    def test_card_without_a_jsonrpc_interface_is_refused(self):
        u = "https://a.example/.well-known/agent-card.json"
        r = a.resolve(u, fake({u: (200, u, "application/json", json.dumps({"url": "https://a.example/grpc", "preferredTransport": "GRPC"}))}))
        self.assertEqual((r["ok"], r["reason"]), (False, "no_jsonrpc_interface_declared"))

    def test_additional_interface_jsonrpc_is_found(self):
        u = "https://a.example/.well-known/agent-card.json"
        body = {"url": "https://a.example/grpc", "preferredTransport": "GRPC",
                "additionalInterfaces": [{"url": "https://a.example/jsonrpc", "transport": "JSONRPC"}]}
        r = a.resolve(u, fake({u: (200, u, "application/json", json.dumps(body))}))
        self.assertEqual(r["endpoint"], "https://a.example/jsonrpc")

    def test_404_and_unreachable_are_reasons_not_endpoints(self):
        u = "https://opentaskrelay.org/.well-known/agent-card.json"
        self.assertEqual(a.resolve(u, fake({}))["reason"], "no_card_http_404")
        self.assertTrue(a.resolve(u, fake({u: OSError("down")}))["reason"].startswith("unreachable"))

    def test_non_http_declared_url_is_ignored(self):
        u = "https://a.example/.well-known/agent-card.json"
        r = a.resolve(u, fake({u: (200, u, "application/json", json.dumps({"url": "javascript:alert(1)"}))}))
        self.assertFalse(r["ok"])

    def test_http_get_follows_a_308_by_hand(self):
        # the two hops are simulated by patching the opener
        import urllib.error
        seq = []

        class Op:
            def open(self, req, timeout=None):
                seq.append(req.full_url)
                if len(seq) == 1:
                    raise urllib.error.HTTPError(req.full_url, 308, "x", {"Location": "https://b.example/c.json"}, None)
                raise urllib.error.HTTPError(req.full_url, 405, "no", {}, __import__("io").BytesIO(b"x"))
        orig = a.urllib.request.build_opener
        a.urllib.request.build_opener = lambda *x: Op()
        try:
            st, final, _, _ = a.http_get("https://a.example/c.json")
        finally:
            a.urllib.request.build_opener = orig
        self.assertEqual((st, final, seq), (405, "https://b.example/c.json", ["https://a.example/c.json", "https://b.example/c.json"]))


if __name__ == "__main__":
    unittest.main()
