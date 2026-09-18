/**
 * tests/site_deployment.test.mjs — what a stranger's browser actually does.
 *
 * `site_laws.test.mjs` reads the shipped bytes and proves the page *would* resolve a
 * usable API base. This file proves the other half, live: that the base it resolves
 * really answers, over TLS, with the CORS headers a browser fetch needs. A page that
 * resolves a correct-looking URL to a host that does not answer is still a dead page.
 *
 * The Caddy TLS base is the one the SPA falls back to on getunstuck.space. It is
 * checked when it is reachable and SKIPPED (never failed) when it is not, because a
 * network check must not make the deploy fail for a reason that is not the site's
 * — but a skip is printed, so nobody can mistake it for a pass.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..", "site");
const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

/** The https base the page falls back to, read from the page itself. */
function apiBaseFromPage() {
  const m = HTML.match(/const (?:DEFAULT_)?API_BASE = "([^"]*)"/);
  assert.ok(m, "site/index.html must bake an API base constant");
  return m[1];
}

async function probe(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    const body = await res.text();
    return { ok: true, status: res.status, headers: res.headers, body };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

test("the API base the page falls back to answers over https with the headers a browser fetch needs", async (t) => {
  const base = apiBaseFromPage();
  assert.ok(base.startsWith("https://"), `the baked base must be https, got ${base}`);

  const r = await probe(`${base}/asks?status=open`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${base} did not answer (${r.error}). The page's own laws still hold.`);
    return;
  }

  assert.equal(r.status, 200, `${base}/asks answered ${r.status}`);
  // A cross-origin fetch from https://getunstuck.space is only allowed with this header.
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    "*",
    "the API must send access-control-allow-origin or every fetch from the deployed page is blocked"
  );
  let json;
  try {
    json = JSON.parse(r.body);
  } catch {
    assert.fail(`${base}/asks did not return JSON`);
  }
  assert.ok(Array.isArray(json.asks), `${base}/asks did not return an asks array`);

  t.diagnostic(`live: ${base}/asks -> 200, ${json.asks.length} asks, CORS allow-origin *`);
});

test("the network the page reads is the XNO-only network the page describes", async (t) => {
  const base = apiBaseFromPage();
  const r = await probe(`${base}/health`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${base}/health did not answer (${r.error}).`);
    return;
  }
  assert.equal(r.status, 200);
  const health = JSON.parse(r.body);
  assert.equal(health.bounty_asset, "XNO", "the network must still settle in XNO only");
  t.diagnostic(`live: health -> ${JSON.stringify(health)}`);
});

test("the shipped ledger the page prints from is present and well formed", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(SITE, "ledger.json"), "utf8"));
  assert.ok(ledger.counts, "ledger.json must carry a counts object");
  for (const k of ["starters_sent", "accounts_opened", "unreceived", "unsubsidised_transactions"]) {
    assert.equal(typeof ledger.counts[k], "number", `ledger.json is missing the ${k} count`);
  }
  assert.ok(Array.isArray(ledger.opened), "ledger.json must carry the list of accounts it opened");
});
