/**
 * tests/site_laws.test.mjs — the shipped site's own laws.
 *
 * The website session at https://getunstuck.space ships `/root/unstuck/site` through
 * rai-web. `rai-web` runs `node --test --test-reporter=tap tests/*.test.mjs` before it
 * uploads anything, so these are the checks that decide whether the network goes live.
 *
 * Each test is named after the law it proves, so a failure names the property that
 * broke rather than the line that threw:
 *
 *   L31 — the shipped page resolves its API base to a URL an https page can call.
 *   L32 — every number the page prints comes from the generated ledger.json.
 *   L33 — the files that ship are the SPA and its machine-readable entry points.
 *   L34 — an empty ask list tells a stranger agent the opener amount and the Nano-only rule.
 *   L43 — the working copy carries the deployment marker, never a stamped sha.
 *
 * (L41/L42 — the deployed origin actually serving the path the page resolves — live in
 *  `site_api_path.test.mjs`, because they are about the rewrite and the live origin.)
 *
 * Everything is read out of the real shipped files, never a reimplementation: the
 * `resolveApi` function is extracted from site/index.html and executed, the file list
 * is the one rai-web itself computes, and the markup is the bytes that go to Vercel.
 *
 * Run all:      node --test tests/site_laws.test.mjs
 * Run one law:  node --test --test-name-pattern=L31 tests/site_laws.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

/** rai-web's own rule: it uploads `git ls-files` minus these prefixes. */
const NOT_SHIPPED = [".vercel/", "tests/", ".gitignore"];

/**
 * The API base the page is allowed to fall back to. It must be reachable from an
 * https page: TLS with a real certificate. `172-86-112-140.sslip.io` is the Caddy
 * host that terminates TLS for this box and proxies /unstuck/api to the network
 * server (NW_PORT 4310), so the whole SPA can call it without mixed-content trouble.
 */
const TLS_API_BASE = "https://172-86-112-140.sslip.io/unstuck/api";

/** Pull `resolveApi` out of the shipped HTML and make it callable. */
function loadResolveApi() {
  const m = HTML.match(/function resolveApi\(win, fallback\)\s*\{([\s\S]*?)\n\}\nconst API = resolveApi\(/);
  assert.ok(m, "site/index.html must ship a resolveApi function");
  return new Function("win", "fallback", m[1]);
}

/** The default constant baked into the page. */
function defaultApiConstant() {
  const m = HTML.match(/const (?:DEFAULT_)?API_BASE = "([^"]*)"/);
  assert.ok(m, "site/index.html must bake an API base constant");
  return m[1];
}

/** The URL a real visitor would be on, and the origin it is allowed to call. */
function visitorWindow(overrides = {}) {
  const loc = { protocol: "https:", hostname: "getunstuck.space", pathname: "/", ...overrides };
  return { location: loc };
}

// ---------------------------------------------------------------------------
// L31 — an https page can actually call the API its own smoke-relevant page calls
// ---------------------------------------------------------------------------

test("L31 the page served at https://getunstuck.space/ resolves an API an https page can call", () => {
  const resolveApi = loadResolveApi();
  const resolved = resolveApi(visitorWindow(), defaultApiConstant());

  assert.ok(resolved, "resolveApi returned nothing for the live domain");
  // Since Block 61 the deployed origin serves /unstuck/api itself through the vercel.json
  // rewrite, so the page may use its own origin — and that is what it must do: no
  // third-party host and no cross-origin hop in a visitor's path. What may never happen
  // is a plain-http base, which an https page blocks as mixed content.
  assert.ok(
    !resolved.startsWith("http://"),
    `the resolved base must never be plain http, got ${resolved}`
  );
  assert.ok(
    resolved === "/unstuck/api" || resolved.startsWith("https://"),
    `the resolved base must be the same-origin proxied path or an https one, got ${resolved}`
  );
  // Whichever it is, the path the page calls is the path the rewrite forwards.
  assert.ok(
    resolved.endsWith("/unstuck/api"),
    `the page must resolve the path the rewrite forwards, got ${resolved}`
  );
});

test("L31 the deployed origin's same-origin path is the one the rewrite forwards", () => {
  // The page and the deploy config must agree on one path, or the rewrite forwards a path
  // nobody calls (the state the live site was in: 404 at the domain on 2026-09-18).
  const resolveApi = loadResolveApi();
  const resolved = resolveApi(visitorWindow(), defaultApiConstant());
  const cfg = JSON.parse(fs.readFileSync(path.join(SITE, "vercel.json"), "utf8"));
  const rw = (cfg.rewrites || []).find((r) => r.source === "/unstuck/api/:path*");
  assert.ok(rw, "vercel.json must forward /unstuck/api/:path*");
  const prefix = rw.source.replace(/\/:path\*$/, "");
  assert.ok(
    resolved.endsWith(prefix),
    `the page resolves ${resolved} but the rewrite forwards ${prefix}`
  );
});

test("L31 no API base the page can return is plain http", () => {
  const resolveApi = loadResolveApi();
  const c = defaultApiConstant();
  assert.ok(
    !c.startsWith("http://"),
    `DEFAULT_API is plain http (${c}) and every https deployment would block it`
  );

  // Every fallback path the function has, exercised with the shipped constant.
  const cases = [
    [visitorWindow(), c],
    [{ location: { protocol: "file:", pathname: "/home/agent/site/index.html" } }, c],
    [{ location: { protocol: "https:", hostname: "example.test", pathname: "/" } }, c],
    [{ location: undefined }, c],
  ];
  for (const [win, fallback] of cases) {
    const r = resolveApi(win, fallback);
    assert.ok(!r.startsWith("http://"), `resolveApi returned a plain-http base: ${r}`);
  }
});

test("L31 an explicit UNSTUCK_API override still wins over the baked default", () => {
  const resolveApi = loadResolveApi();
  const r = resolveApi(
    { UNSTUCK_API: "https://api.example.test/", location: { protocol: "https:", pathname: "/" } },
    defaultApiConstant()
  );
  assert.equal(r, "https://api.example.test", "an operator override must still take precedence");
});

test("L31 a host that does not forward /unstuck/api still falls back to an https base", () => {
  // The fallback is what saves a page served from anywhere else: it must be the TLS base,
  // never the same-origin path (which 404s on a host with no rewrite) and never plain http.
  const resolveApi = loadResolveApi();
  const r = resolveApi({ location: { protocol: "https:", hostname: "example.test", pathname: "/" } }, defaultApiConstant());
  assert.equal(r, TLS_API_BASE, `an unproxied host must fall back to the TLS base, got ${r}`);
});

test("L31 on the Caddy host the page still prefers its own same-origin proxy", () => {
  const resolveApi = loadResolveApi();
  const r = resolveApi(
    { location: { protocol: "https:", hostname: "172-86-112-140.sslip.io", pathname: "/unstuck/" } },
    defaultApiConstant()
  );
  assert.equal(r, "/unstuck/api", "same-origin is cheaper when the Caddy proxy is the thing serving the page");
});

// ---------------------------------------------------------------------------
// L32 — the numbers on the page are read from the generated ledger
// ---------------------------------------------------------------------------

test("L32 every published stat is filled from ledger.json, none is typed into the markup", () => {
  // Each stat id the page shows must be assigned from the ledger fetch, and its
  // markup must start empty (an em dash placeholder), never a number.
  const stats = [
    ["n-sent", "starters_sent"],
    ["n-opened", "accounts_opened"],
    ["n-unreceived", "unreceived"],
    ["n-active", "agents_demonstrably_active"],
    ["n-unsub", "unsubsidised_transactions"],
  ];
  for (const [id, field] of stats) {
    const markup = HTML.match(new RegExp(`<b id="${id}">([^<]*)</b>`));
    assert.ok(markup, `no stat element #${id} in the shipped page`);
    assert.ok(
      !/\d/.test(markup[1]),
      `#${id} has a number typed into the markup ("${markup[1]}"); it must come from ledger.json`
    );
    assert.ok(
      new RegExp(`getElementById\\("${id}"\\)\\.textContent`).test(HTML),
      `#${id} is never assigned from the ledger`
    );
  }
  assert.ok(
    HTML.includes("fetchLedger()") && HTML.includes('fetch("ledger.json"'),
    "the page must fetch the generated ledger.json rather than carry its own numbers"
  );
});

test("L32 starters sent and accounts opened stay two different numbers", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(SITE, "ledger.json"), "utf8"));
  assert.ok("starters_sent" in ledger.counts, "ledger.json must publish starters_sent");
  assert.ok("accounts_opened" in ledger.counts, "ledger.json must publish accounts_opened");
  // A send is not an opening. The page must show both, and they must not be conflated.
  assert.ok(
    /starters sent/.test(HTML) && /accounts we opened/.test(HTML),
    "the page must label sends and openings as two different things"
  );
  assert.ok(
    ledger.counts.accounts_opened <= ledger.counts.starters_sent,
    "a send is not an opening: accounts_opened can never exceed starters_sent"
  );
});

// ---------------------------------------------------------------------------
// L33 — what ships is the network and the files a machine agent needs to join it
// ---------------------------------------------------------------------------

test("L33 the SPA and every machine-readable entry point exist in the shipped working copy", () => {
  const required = ["site/index.html", "site/agent.json", "site/llms.txt", "site/try-nano.html", "site/ledger.json"];
  for (const f of required) {
    assert.ok(fs.existsSync(path.join(SITE, "..", f)), `${f} is missing from the working copy`);
    assert.ok(!NOT_SHIPPED.some((p) => f.startsWith(p)), `${f} would be skipped by rai-web's upload filter`);
  }
});

test("L33 the SPA is the page that ships, not a description of one", () => {
  // A page that only describes a network is an advertisement for it (owner, 2026-09-17).
  assert.ok(HTML.includes("resolveApi"), "the shipped page must be the SPA");
  assert.ok(/id="ask-list"/.test(HTML), "the shipped page must render a list of asks");
  assert.ok(/id="ask-form"/.test(HTML), "the shipped page must let an agent post an ask");
  assert.ok(/function postAnswer/.test(HTML), "the shipped page must let an agent answer");
  assert.ok(/function acceptAnswer/.test(HTML), "the shipped page must let the asker mark the answer that worked");
});

test("L33 agent.json names the network's real API and the XNO-only payment rule", () => {
  const aj = JSON.parse(fs.readFileSync(path.join(SITE, "agent.json"), "utf8"));
  assert.ok(aj.api && aj.api.includes("/unstuck/api"), `agent.json api field is not the network API: ${aj.api}`);
  assert.equal(aj.payment.asset, "XNO", "the network settles in XNO and nothing else");
  assert.ok(aj.payment.network === "nano", "the payment network must be nano");
  const paths = (aj.endpoints || []).map((e) => e.path);
  for (const p of ["/asks", "/ask", "/standing"]) {
    assert.ok(paths.includes(p), `agent.json does not advertise ${p}`);
  }
});

test("L33 the site, agent.json and llms.txt all point at the same network and the same API", () => {
  // An agent that reads the page, the manifest and the llms.txt must not be sent to
  // three different places. One network, one API base, named in every entry point.
  const aj = JSON.parse(fs.readFileSync(path.join(SITE, "agent.json"), "utf8"));
  const llms = fs.readFileSync(path.join(SITE, "llms.txt"), "utf8");
  const pageBase = defaultApiConstant();
  const tryNano = fs.readFileSync(path.join(SITE, "try-nano.html"), "utf8");

  assert.equal(aj.api, pageBase, `agent.json api (${aj.api}) disagrees with the page (${pageBase})`);
  assert.ok(llms.includes(pageBase), `llms.txt does not name the API base the page calls (${pageBase})`);
  assert.ok(llms.includes("getunstuck.space"), "llms.txt must name the domain the network is served at");
  assert.ok(
    tryNano.includes(pageBase),
    "the on-ramp page must send an agent to the same API base the network itself uses"
  );
  assert.ok(
    !/http:\/\/172\.86\.112\.140:4310\/(ask|asks)/.test(tryNano),
    "the on-ramp page must not send a browser to a plain-http API (mixed content)"
  );
});

// ---------------------------------------------------------------------------
// L34 — an agent landing on an empty network is told what to do
// ---------------------------------------------------------------------------
//
// Superseded by the owner's corrective action of 2026-09-18: this law used to
// require the empty state to point at nanswap for a USDC -> XNO swap. That is a
// conversion path the network must never offer again (L48, in
// site_laws_nano_only.test.mjs), so the requirement is now the opposite: the
// empty state names the opener AND the Nano-only rule, and never a swap.

test("L34 the empty ask list names the opener amount and the Nano-only rule", () => {
  const empty = HTML.match(/<div class="empty">([\s\S]*?)<\/div>/);
  assert.ok(empty, "the page ships no empty state for the ask list");
  const text = empty[1];
  assert.ok(/0\.00001\s*XNO/.test(text), `the empty state does not name the 0.00001 XNO opener: ${text}`);
  assert.ok(
    /in Nano \(XNO\) and nothing else|only Nano|Nano and nothing else|no USDC/i.test(text),
    "the empty state does not state the Nano-only settlement rule"
  );
  assert.ok(
    !/nanswap|USDC[^.]*(swap|convert|bridge)/i.test(text),
    "the empty state must not offer a USDC conversion path"
  );
});

test("L34 reading the network needs no wallet and no address", () => {
  // Both read paths must be plain GETs with no address, key or header.
  assert.ok(
    /api\("\/asks"/.test(HTML),
    "listing asks must be a plain GET so an agent with no wallet can read the network"
  );
  const listCall = HTML.match(/const data = await api\(("\/asks" \+ q)\)/);
  assert.ok(listCall, "the ask list call must not carry an address or a credential");
  assert.ok(!/api\("\/asks"[^)]*asker/.test(HTML), "the ask list must not require an asker address");
});

test("L34 the page says plainly that the network settles in Nano only", () => {
  assert.ok(
    /in Nano \(XNO\) only|XNO.*and only|only Nano/i.test(HTML),
    "the shipped page must state the XNO-only rule the network is built on"
  );
});

// ---------------------------------------------------------------------------
// L43 — the working copy carries the marker, and only the marker
// ---------------------------------------------------------------------------

test("L43 the working copy carries the deployment marker as a placeholder, never a stamped sha", () => {
  // The marker is what the deployer substitutes and what a live check reads to tell
  // "this build is deployed" from "an older build is still live". The working copy must
  // hold the literal placeholder: a disk copy carrying a real sha would be
  // indistinguishable from a deployment, and the live check could then pass against a
  // stale origin — the exact state measured on 2026-09-18, when getunstuck.space served
  // `unstuck-commit: c885987...` while HEAD was bcabf3f.
  assert.ok(
    HTML.includes("// __UNSTUCK_COMMIT__"),
    "site/index.html must carry the literal __UNSTUCK_COMMIT__ marker the deployer substitutes"
  );
  assert.ok(
    !/unstuck-commit:\s*[0-9a-f]{7,40}/.test(HTML),
    "site/index.html must not carry a real unstuck-commit stamp on disk; the deployer injects that at upload"
  );
});
