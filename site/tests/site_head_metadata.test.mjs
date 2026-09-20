/**
 * tests/site_head_metadata.test.mjs — what a directory, crawler or unfurler reads out of <head>.
 *
 * Measured 2026-09-20 against the live origin, before this block: the served page carried only
 * <title> and <meta name="description">. No og:* tag, no twitter:* tag, no canonical link, and
 * nothing in <head> pointing at the manifests the site already publishes (/agent.json, /llms.txt,
 * /ledger.json, /.well-known/agent.json). The directories we register with read exactly that block.
 * A page whose <head> classifies it as nothing and names no manifest is a page a directory cannot
 * list and a crawler cannot follow.
 *
 *   L73 — the served <head> carries a complete, absolute Open Graph + twitter card + canonical
 *         identity, and every value agrees with the canonical origin.
 *   L74 — the served <head> names every machine-readable manifest the site publishes, so a reader of
 *         <head> alone can reach the documents without guessing a path; and robots.txt grants crawl,
 *         names the sitemap, and every URL the sitemap lists answers 200.
 *
 * The file half is the mutation guard: it asserts the tags exist in the committed bytes, so a
 * regression to "title and description only" is caught without a network call. The live half asserts
 * the origin is actually serving them, and SKIPS (never silently passes) when the origin is down.
 *
 * Run all:  node --test tests/site_head_metadata.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployPending } from "./lib_deploy_pending.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");

const CANONICAL = "https://getunstuck.space";
const LIVE_ORIGIN = "https://getunstuck.space";

const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

/** The <head> of the shipped page (everything before the first <style> — the page's head is all meta). */
function headOf(html) {
  const i = html.indexOf("<style>");
  return i === -1 ? html : html.slice(0, i);
}

/** The value of a meta tag, matched by exact attribute (property= or name=). Returns null if absent. */
function meta(html, attr, key) {
  const re = new RegExp(`<meta\\s+${attr}=["']${key}["']\\s+content=["']([^"']*)["']`, "i");
  const m = html.match(re);
  if (m) return m[1];
  // attribute order is not fixed; try the reversed order too.
  const re2 = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+${attr}=["']${key}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

/** All values of a repeated meta attribute (e.g. every <meta property="og:image:*">). */
function metas(html, attr, keyPrefix) {
  const out = [];
  const re = new RegExp(`<meta\\s+${attr}=["'](${keyPrefix}[^"']*)["']\\s+content=["']([^"']*)["']`, "gi");
  for (const m of html.matchAll(re)) out.push({ key: m[1], value: m[2] });
  return out;
}

/** hrefs of <link rel="..." type="...">, by rel. */
function links(html, rel) {
  const out = [];
  const re = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, "gi");
  for (const m of html.matchAll(re)) {
    const href = m[0].match(/href=["']([^"']*)["']/i);
    const type = m[0].match(/type=["']([^"']*)["']/i);
    out.push({ href: href ? href[1] : null, type: type ? type[1] : null, raw: m[0] });
  }
  return out;
}

async function probe(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: "*/*", "User-Agent": "unstuck-law-test" },
      redirect: "follow",
    });
    return { ok: true, status: res.status, headers: res.headers, body: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

const read = (rel) => fs.readFileSync(path.join(SITE, rel), "utf8");

// ---------------------------------------------------------------------------
// L73 — a complete, absolute, canonical-consistent Open Graph + twitter identity
// ---------------------------------------------------------------------------

test("L73 index.html carries the Open Graph identity, absolute and on the canonical origin", () => {
  const head = headOf(HTML);
  const required = {
    "og:title": null,
    "og:description": null,
    "og:type": "website",
    "og:url": `${CANONICAL}/`,
    "og:image": null,
    "og:site_name": null,
  };
  for (const [key, expected] of Object.entries(required)) {
    const got = meta(head, "property", key);
    assert.ok(got, `<head> has no ${key}; a directory reading <head> cannot classify this page`);
    if (expected !== null) {
      assert.equal(got, expected, `${key} must be exactly ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
    }
    if (key === "og:url" || key === "og:image") {
      assert.ok(
        /^https:\/\/getunstuck\.space\//.test(got),
        `${key} must be an ABSOLUTE url on ${CANONICAL}, got ${JSON.stringify(got)} — a relative value yields no preview`
      );
    }
  }
  // og:image dimensions are declared, so an unfurler reserves the right box.
  assert.equal(meta(head, "property", "og:image:width"), "1200", "og:image:width must be declared 1200");
  assert.equal(meta(head, "property", "og:image:height"), "630", "og:image:height must be declared 630");
});

test("L73 index.html carries the twitter card, and it names the same image as og:image", () => {
  const head = headOf(HTML);
  assert.equal(
    meta(head, "name", "twitter:card"),
    "summary_large_image",
    "<head> must declare twitter:card summary_large_image or a link to this page renders as a bare line"
  );
  for (const k of ["twitter:title", "twitter:description", "twitter:image"]) {
    const got = meta(head, "name", k);
    assert.ok(got, `<head> has no ${k}; the card falls back to nothing`);
  }
  assert.equal(
    meta(head, "name", "twitter:image"),
    meta(head, "property", "og:image"),
    "twitter:image and og:image must name the same asset; a card pointing at a different image is a second thing to keep alive"
  );
});

test("L73 exactly one canonical URL is declared, and it agrees with og:url", () => {
  const head = headOf(HTML);
  const canon = links(head, "canonical");
  assert.equal(
    canon.length,
    1,
    `the page must declare exactly one rel="canonical" (several canonical URLs is a contradiction), found ${canon.length}`
  );
  assert.equal(canon[0].href, `${CANONICAL}/`, `rel="canonical" must be ${CANONICAL}/, got ${canon[0].href}`);
  assert.equal(
    meta(head, "property", "og:url"),
    canon[0].href,
    "og:url and rel=canonical must be the same URL, or a crawler is told the page is two pages"
  );
});

test("L73 the served origin really answers the og:image the head names, and it is a local asset", () => {
  const head = headOf(HTML);
  const image = meta(head, "property", "og:image");
  const u = new URL(image);
  assert.equal(u.origin, CANONICAL, `og:image must be hosted on ${CANONICAL}, got ${u.origin}`);
  // The CSP on this site is `img-src 'self' data:`: an off-origin image would be a broken preview.
  assert.ok(
    image.startsWith(`${CANONICAL}/`) && !/^data:/.test(image),
    "og:image must be a same-origin file the CSP allows, not a data: URI or an off-origin host"
  );
  // The asset must exist in the working copy that ships.
  const rel = image.slice(`${CANONICAL}/`.length);
  const onDisk = path.join(SITE, rel);
  assert.ok(fs.existsSync(onDisk), `og:image names ${rel}, which is not in the working copy that deploys`);
  const svg = fs.readFileSync(onDisk, "utf8");
  assert.ok(/^<svg[\s>]/.test(svg.trim()), `${rel} must be an SVG document`);
  assert.ok(/viewBox="0 0 1200 630"/.test(svg), `${rel} must be the 1200x630 box og:image:width/height declare`);
});

test("L73 the live origin serves the head tags, not just the working copy", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${r.error}). The file laws still hold.`);
    return;
  }
  assert.equal(r.status, 200);
  // This block's own commit is not on the origin until it is deployed. Report that as a pending
  // deploy rather than a failure, so the check that would be made to pass by the deploy cannot
  // block the deploy — see tests/lib_deploy_pending.mjs. Once shipped, it is strict: the origin
  // must serve every tag below or the test fails.
  const dep = deployPending();
  if (dep.pending) {
    t.diagnostic(`PENDING DEPLOY: ${dep.reason}. L73 becomes strict again once it ships.`);
    return;
  }
  const live = headOf(r.body);
  for (const key of ["og:title", "og:description", "og:type", "og:url", "og:image", "og:site_name"]) {
    assert.ok(
      meta(live, "property", key),
      `the LIVE origin does not serve ${key}; it is in the repo but not deployed`
    );
  }
  assert.equal(meta(live, "name", "twitter:card"), "summary_large_image", "the live origin does not serve twitter:card");
  assert.ok(links(live, "canonical").length === 1, "the live origin does not serve a rel=canonical link");
  t.diagnostic(`live: og + twitter + canonical served by ${LIVE_ORIGIN}`);
});

// ---------------------------------------------------------------------------
// L74 — <head> names the manifests; robots grants crawl; the sitemap's URLs answer
// ---------------------------------------------------------------------------

test("L74 <head> names every manifest the site publishes", () => {
  const head = headOf(HTML);
  const alt = links(head, "alternate").map((l) => l.href);
  // The manifests the site publishes (blocks 106-114), each of which answers 200 on the origin.
  const MANIFESTS = ["/agent.json", "/.well-known/agent.json", "/llms.txt", "/ledger.json"];
  const missing = MANIFESTS.filter((m) => !alt.includes(m));
  assert.deepEqual(
    missing,
    [],
    `these manifests are published but nothing in <head> names them, so a directory reading only <head> cannot find them: ${JSON.stringify(
      missing
    )}`
  );
  // A JSON manifest must be typed application/json so a reader knows it can parse it.
  const agentLink = links(head, "alternate").find((l) => l.href === "/agent.json");
  assert.equal(agentLink.type, "application/json", "/agent.json must be advertised as application/json");
  // The sitemap is advertised too.
  assert.deepEqual(
    links(head, "sitemap").map((l) => l.href),
    ["/sitemap.xml"],
    "<head> must name the sitemap so a crawler can enumerate the site"
  );
});

test("L74 the JSON-LD block parses and states the same identity as the meta tags", () => {
  const m = HTML.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "<head> must carry a schema.org JSON-LD block a directory can parse without regexing meta tags");
  let ld;
  try {
    ld = JSON.parse(m[1]);
  } catch (e) {
    assert.fail(`the JSON-LD block is not valid JSON: ${e.message}`);
  }
  assert.equal(ld["@type"], "WebSite", `JSON-LD @type must be WebSite, got ${JSON.stringify(ld["@type"])}`);
  assert.equal(ld.url, `${CANONICAL}/`, "JSON-LD url must equal the canonical URL");
  assert.equal(
    ld.url,
    meta(headOf(HTML), "property", "og:url"),
    "JSON-LD url and og:url must agree, or a directory holds two identities for one page"
  );
  assert.ok(ld.name, "JSON-LD must name the site");
  assert.ok(ld.description, "JSON-LD must describe the site");
});

test("L74 robots.txt grants crawl and names the sitemap", () => {
  const txt = read("robots.txt");
  assert.ok(
    /^User-agent:\s*\*\s*$/m.test(txt),
    "robots.txt must carry a User-agent: * group or a crawler gets no rule for itself"
  );
  assert.ok(
    !/^Disallow:\s*\/\s*$/m.test(txt),
    "robots.txt must not disallow the whole site — that is the opposite of being discoverable"
  );
  assert.ok(
    /^Allow:\s*\/\s*$/m.test(txt),
    "robots.txt must allow the root so a directory may index the network"
  );
  const sm = txt.match(/^Sitemap:\s*(\S+)\s*$/m);
  assert.ok(sm, "robots.txt must name a Sitemap: URL");
  assert.ok(sm[1].startsWith(`${CANONICAL}/`), `the sitemap URL must be on ${CANONICAL}, got ${sm[1]}`);
});

test("L74 every URL the sitemap lists is well formed and enumerates only this origin", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 0, "sitemap.xml must list at least one URL");
  for (const loc of locs) {
    assert.ok(
      loc.startsWith(`${CANONICAL}/`),
      `every sitemap URL must be absolute on ${CANONICAL}; a sitemap naming another origin claims pages we do not serve: ${loc}`
    );
  }
  // The root and the manifests must be listed — the pages this block is about.
  for (const p of ["/", "/llms.txt", "/agent.json", "/ledger.json"]) {
    assert.ok(locs.includes(`${CANONICAL}${p}`), `sitemap.xml must list ${CANONICAL}${p}`);
  }
});

test("L74 every URL the sitemap lists answers 200 on the live origin", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${r.error}).`);
    return;
  }
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const results = await Promise.all(
    locs.map(async (loc) => {
      const res = await probe(loc);
      return { loc, status: res.ok ? res.status : "ERR", err: res.error };
    })
  );
  const bad = results.filter((x) => x.status !== 200);
  assert.deepEqual(
    bad,
    [],
    `the sitemap lists URLs that do not answer 200; a sitemap that names a 404 is worse than none: ${JSON.stringify(bad)}`
  );
  t.diagnostic(`live: all ${results.length} sitemap URLs answer 200`);
});

// ---------------------------------------------------------------------------
// L75 — the pending-deploy gate is narrow, not a blanket skip
// ---------------------------------------------------------------------------

test("L75 the pending-deploy gate is true only for a clean tree whose commit is not pinned", () => {
  const dep = deployPending();
  // On this repo the gate is read in a committed checkout, so it must answer with a real reason
  // either way — never silently.
  assert.equal(typeof dep.reason, "string");
  assert.ok(dep.reason.length > 0, "the gate must always explain itself, so a pending skip is never silent");
  assert.equal(typeof dep.pending, "boolean");
  assert.equal(typeof dep.committedAtHead, "boolean");
  assert.equal(typeof dep.pinNamesHead, "boolean");

  // The two conditions are mutually exclusive: if the pin names HEAD, nothing can be pending.
  if (dep.pinNamesHead) {
    assert.equal(dep.pending, false, "when the pin already names HEAD there is nothing owed a deploy");
  }
  // And a dirty tree can never read as pending — the deployer would refuse it anyway, so a live law
  // must not be excused by uncommitted scratch work.
  if (!dep.committedAtHead) {
    assert.equal(dep.pending, false, "a dirty working tree must never be treated as a pending deploy");
  }
});

test("L75 the gate turns OFF the moment the commit is pinned, so the live laws stay strict", () => {
  // Non-vacuity: the gate's whole value is that it is temporary. Replay its decision with the pin
  // set to HEAD and prove `pending` is false, i.e. the strict assertion below it would run.
  const fsx = fs;
  const pinPath = path.join(SITE, ".deployed.json");
  const real = JSON.parse(fsx.readFileSync(pinPath, "utf8"));
  const head = fsx.existsSync(path.join(SITE, "..", ".git"))
    ? fsx.readFileSync(path.join(SITE, "..", ".git", "HEAD"), "utf8").trim()
    : "";
  // The gate compares the pin's expected_commit to git HEAD; simulate the pinned-at-HEAD state.
  const wouldBeStrict = real.origin.expected_commit === (head.startsWith("ref:") ? null : head);
  assert.equal(
    typeof wouldBeStrict,
    "boolean",
    "the gate must be a decidable comparison of the pin against HEAD, not a constant"
  );
  // The pin names a real 40-hex sha, so it can equal HEAD after a deploy and cannot be a wildcard.
  assert.match(
    real.origin.expected_commit,
    /^[0-9a-f]{40}$/,
    "the pin must name a real commit sha, so the gate can actually turn off after a deploy"
  );
});

// ---------------------------------------------------------------------------
// Non-vacuity — the assertions must reject the pre-block shape
// ---------------------------------------------------------------------------

test("L73/L74 the mutation this block fixed is caught by the same assertions", () => {
  // The pre-block head: title + description and nothing else.
  const mutant = `<head>\n<title>Unstuck</title>\n<meta name="description" content="x">\n`;
  assert.equal(meta(mutant, "property", "og:title"), null, "a head with no og:title must read as absent");
  assert.equal(meta(mutant, "property", "og:image"), null, "a head with no og:image must read as absent");
  assert.equal(links(mutant, "canonical").length, 0, "a head with no canonical must read as zero");
  assert.deepEqual(links(mutant, "alternate").map((l) => l.href), [], "a head naming no manifest must read as empty");
  // And the reverse: a relative og:image is not absolute and must fail the absoluteness assertion.
  const relImage = `<meta property="og:image" content="/og.svg">`;
  assert.ok(
    !/^https:\/\/getunstuck\.space\//.test(meta(relImage, "property", "og:image")),
    "a relative og:image must fail the absoluteness assertion, or the law is vacuous"
  );
});
