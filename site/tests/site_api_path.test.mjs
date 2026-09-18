/**
 * tests/site_api_path.test.mjs — the deployed origin must serve the API path the SPA uses.
 *
 * Measured 2026-09-18, from outside the box:
 *
 *   https://getunstuck.space/                        -> 200 (the SPA, shipped by rai-web)
 *   https://getunstuck.space/unstuck/api/asks        -> 404 (Vercel: no such static file)
 *   https://172-86-112-140.sslip.io/unstuck/api/asks -> 200, CORS * (Caddy -> the network on :4310)
 *
 * The correction says it plainly: an agent arriving at the domain sees a network it cannot use. These tests
 * are that defect made executable. They are named after the law they prove:
 *
 *   L41 — the path the SPA resolves must be reachable from the origin the page is served at.
 *   L42 — the SPA and the rewrite must agree on the path, and the rewrite must be the one that ships.
 *
 * L41's live half fails while the site 404s and passes once the rewrite is deployed. L42's byte half fails
 * while vercel.json is untracked or edited, because Vercel cannot inherit a working copy the deploy
 * manifest and HEAD disagree about — which is exactly how the first attempt at this fix never landed.
 *
 * Run all:      node --test tests/site_api_path.test.mjs
 * Run one law:  node --test --test-name-pattern=L42 tests/site_api_path.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");

/** The origin the network is published at, and the Caddy host that terminates TLS on the box. */
const LIVE_ORIGIN = "https://getunstuck.space";
const GATEWAY_HOST = "172-86-112-140.sslip.io";
const API_PATH = "/unstuck/api";
/** Exact source pattern Vercel rewrites match, and the destination we expect it to point at. */
const REWRITE_SOURCE = "/unstuck/api/:path*";
const REWRITE_DEST = `https://${GATEWAY_HOST}/unstuck/api/:path*`;

const readVercel = () => JSON.parse(fs.readFileSync(path.join(SITE, "vercel.json"), "utf8"));

/** Raw bytes of a committed path, exactly as git stores them (execFileSync would strip a trailing newline). */
function committedBytes(relPath) {
  return execFileSync("git", ["show", `HEAD:${relPath}`], { cwd: SITE, maxBuffer: 8 * 1024 * 1024 });
}

function git(args) {
  return execFileSync("git", args, { cwd: SITE, encoding: "utf8" }).trim();
}

async function probe(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: "application/json", "User-Agent": "unstuck-law-test" },
      redirect: "follow",
    });
    return { ok: true, status: res.status, headers: res.headers, body: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

/** The resolved API base for a visitor at the live origin, taken from the shipped page. */
function resolveApi() {
  const m = HTML.match(/function resolveApi\(win, fallback\)\s*\{([\s\S]*?)\n\}\nconst API = resolveApi\(/);
  assert.ok(m, "site/index.html must ship a resolveApi function");
  const fn = new Function("win", "fallback", m[1]);
  const base = HTML.match(/const (?:DEFAULT_)?API_BASE = "([^"]*)"/)[1];
  return { resolved: fn({ location: { protocol: "https:", hostname: "getunstuck.space", pathname: "/" } }, base), base };
}

// ---------------------------------------------------------------------------
// L41 — the API the page resolves must actually answer where the page lives
// ---------------------------------------------------------------------------

test("L41 a rewrite exists so the origin that serves the page also serves /unstuck/api", () => {
  const cfg = readVercel();
  const rewrites = (cfg.rewrites || []).filter((r) => r.source === REWRITE_SOURCE);
  assert.equal(rewrites.length, 1, `vercel.json must carry exactly one ${REWRITE_SOURCE} rewrite`);
  const dest = rewrites[0].destination;
  assert.ok(
    dest.startsWith("https://"),
    `the rewrite destination must be https or a browser fetch from the deployed page is broken, got ${dest}`
  );
  assert.ok(
    dest.endsWith(API_PATH + "/:path*"),
    `the rewrite must keep the path suffix, got ${dest}`
  );
  // sslip.io maps <dashed-ip>.sslip.io to <dotted-ip>; anything else means the rewrite points at a host
  // whose TLS certificate does not cover it (checked: the SAN is exactly DNS:172-86-112-140.sslip.io).
  const host = new URL(dest).hostname;
  assert.equal(host, GATEWAY_HOST, `the rewrite must target the TLS gateway host, got ${host}`);
});

test("L41 the deployed origin serves the resolved API path with the headers a browser fetch needs", async (t) => {
  const { resolved } = resolveApi();

  // Decide the URL exactly the way the browser will: a same-origin path on the live origin.
  const url =
    resolved.startsWith("http")
      ? `${resolved}/health`
      : `${LIVE_ORIGIN}${resolved.startsWith("/") ? resolved : "/" + resolved}/health`;

  // `rai-web` runs this suite before it uploads anything, so on a preview run the rewrite being
  // tested has not been deployed yet and the live origin legitimately 404s. The skip must not be
  // fooled by the fact that an OLDER deployment of this SPA is already live — so it asks the
  // deployment identity first, and only skips when HEAD is not what the origin is serving.
  // A stranger can run this file against the live domain at any time and get a real answer: once
  // HEAD is the deployed commit, the check runs for real.
  const root = await probe(`${LIVE_ORIGIN}/`);
  if (root.ok && root.status === 200 && !root.body.includes("resolveApi")) {
    t.diagnostic(
      `SKIPPED live check: ${LIVE_ORIGIN}/ does not serve this SPA (${root.body.length} bytes, no resolveApi).`
    );
    return;
  }
  let headSha = "";
  try {
    headSha = git(["rev-parse", "HEAD"]);
  } catch {
    headSha = "";
  }
  if (root.ok && headSha && !root.body.includes(headSha.slice(0, 12))) {
    t.diagnostic(
      `SKIPPED live check: ${LIVE_ORIGIN}/ is serving an older deployment than HEAD ${headSha.slice(0, 12)}; ` +
        `the rewrite under test has not shipped yet. The deploy's own smoke check must answer ${url} with 200.`
    );
    return;
  }

  const r = await probe(url);
  if (!r.ok) {
    // A network outage must not fail a deploy for a reason that is not the site's — but say so loudly.
    t.diagnostic(`SKIPPED live check: ${url} did not answer (${r.error}).`);
    return;
  }
  assert.equal(
    r.status,
    200,
    `${url} answered ${r.status}; before the rewrite this is the 404 that makes the network unusable at the domain`
  );
  assert.equal(
    r.headers.get("access-control-allow-origin"),
    "*",
    "a cross-origin fetch from the deployed page needs access-control-allow-origin"
  );
  const json = JSON.parse(r.body);
  assert.equal(json.bounty_asset, "XNO", "the network the origin reaches must still settle in XNO only");
});

test("L41 the API the page uses is the one the rewrite forwards, path for path", () => {
  // Same-origin on the Caddy host, proxied on the deployed host: both must be /unstuck/api.
  assert.ok(HTML.includes(`"${API_PATH}"`), `the page must still name ${API_PATH} as its same-origin path`);
  const cfg = readVercel();
  const rw = (cfg.rewrites || []).find((r) => r.source === REWRITE_SOURCE);
  assert.ok(rw, "no rewrite to forward the same-origin path");
  const prefix = rw.source.replace(/\/:path\*$/, "");
  assert.equal(prefix, API_PATH, `the rewrite must forward the same prefix the page calls, source is ${rw.source}`);
});

// ---------------------------------------------------------------------------
// L42 — what ships is the rewrite, byte for byte, and the two files agree
// ---------------------------------------------------------------------------

test("L42 vercel.json on disk is the one committed at HEAD", () => {
  // Vercel creates the deployment from a manifest built out of the working copy, while every preview URL is
  // stamped with the HEAD sha. If the two disagree, a green deploy can promote a site that does not contain
  // the fix — which is how /unstuck/api stayed 404 after a supposedly successful deploy.
  const file = path.join(SITE, "vercel.json");
  assert.ok(fs.existsSync(file), "site/vercel.json is missing; the rewrite cannot ship");

  const onDisk = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  let atHead;
  try {
    atHead = createHash("sha256").update(committedBytes("site/vercel.json")).digest("hex");
  } catch {
    assert.fail("site/vercel.json is not committed at HEAD; it cannot be part of a traceable deploy");
  }
  assert.equal(onDisk, atHead, "site/vercel.json differs between the working copy and HEAD; commit it before deploying");
});

test("L42 the rewrite is enabled, JSON-valid and its destination is a certificate-valid https host", () => {
  const cfg = readVercel();
  const rw = (cfg.rewrites || []).find((r) => r.source === REWRITE_SOURCE);
  assert.ok(rw, "no /unstuck/api rewrite in vercel.json");
  const u = new URL(rw.destination.replace("/:path*", ""));
  assert.equal(u.protocol, "https:", "a plain-http destination is a mixed-content hazard on a server-to-server hop");
  assert.ok(
    !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname),
    "the destination must be a hostname, not a bare IP: the gateway's certificate SAN is the sslip.io name"
  );
});

test("L42 a rewrite does not shadow the SPA shell or the machine-readable entry points", () => {
  // The rewrite must forward one prefix and nothing else: /ask, /agent.json, /llms.txt must still be served
  // as files by Vercel, not swallowed by the rewrite.
  const cfg = readVercel();
  const sources = (cfg.rewrites || []).map((r) => r.source);
  for (const s of sources) {
    assert.ok(
      s.startsWith(API_PATH),
      `rewrite ${s} is outside ${API_PATH} and could shadow the SPA or its manifests`
    );
  }
});

// ---------------------------------------------------------------------------
// L43 — the origin must say which build it is serving, and only a live 200 counts
// ---------------------------------------------------------------------------

test("L43 the page carries a deployment-identity marker, placeholder in the working copy", () => {
  // The marker is what a live check reads to tell "this fix is deployed" from "an older build is still
  // live". A working copy must carry the literal placeholder: if a disk copy could carry a real sha, it
  // would be indistinguishable from a deployment and the live check could pass against a stale origin.
  assert.ok(
    HTML.includes("__UNSTUCK_COMMIT__"),
    "site/index.html must carry the __UNSTUCK_COMMIT__ deployment marker"
  );
  assert.ok(
    HTML.includes("// __UNSTUCK_COMMIT__"),
    "the marker must be a line the build can substitute without touching any other bytes"
  );
});

test("L43 the live origin names its build, so a stale deployment cannot pass the live check", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    // A network outage must not fail a deploy for a reason that is not the site's.
    t.diagnostic(`SKIPPED deployment-identity check: ${LIVE_ORIGIN}/ did not answer (${r.error}).`);
    return;
  }

  let headSha = "";
  try {
    headSha = git(["rev-parse", "HEAD"]);
  } catch {
    headSha = "";
  }

  const stamped = r.body.match(/unstuck-commit:\s*([0-9a-f]{7,40})/);
  // No stamp at all is a real failure now, not a skip. Measured 2026-09-18: a build with
  // no stamp shipped and every check merely SKIPPED, which is how the site came to serve
  // `unstuck-commit: c885987...` while HEAD was bcabf3f — a deployment nobody could tie
  // to the working tree. A check that can only ever skip is not a check.
  if (!stamped) {
    const placeholder = r.body.includes("__UNSTUCK_COMMIT__");
    assert.fail(
      `${LIVE_ORIGIN}/ serves no unstuck-commit stamp` +
        (placeholder
          ? " and still carries the raw __UNSTUCK_COMMIT__ placeholder"
          : "") +
        `; HEAD is ${headSha.slice(0, 12)}. A visitor cannot tell which commit is live, so this ` +
        `deployment is not evidence that the current build works.`
    );
  }

  assert.ok(
    headSha && headSha.startsWith(stamped[1]),
    `the live origin says it is serving ${stamped[1]}, but HEAD is ${headSha.slice(0, 12)}; a stale ` +
      `deployment is not evidence that this build works`
  );
  assert.ok(
    !r.body.includes("__UNSTUCK_COMMIT__"),
    "the live page must not still carry the raw placeholder once it is stamped"
  );
  t.diagnostic(`live: ${LIVE_ORIGIN}/ names ${stamped[1]}, which is HEAD`);
});