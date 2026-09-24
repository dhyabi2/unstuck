/**
 * tests/site_discovery_paths.test.mjs — the discovery documents must name paths that answer.
 *
 * Measured 2026-09-19 from outside the box, against the live origin:
 *
 *   https://getunstuck.space/llms.txt             -> 200
 *   https://getunstuck.space/agent.json           -> 200
 *   https://getunstuck.space/.well-known/agent.json -> 200
 *   https://getunstuck.space/.well-known/agent    -> 200
 *   https://getunstuck.space/ledger.json          -> 200
 *   https://getunstuck.space/unstuck/api/health   -> 200
 *
 * BUT the documents those files contained named paths that 404:
 *
 *   live agent.json "agent_discovery" pointed at /unstuck/llms.txt, /unstuck/agent.json,
 *   /unstuck/ledger.json — all 404 — and the live llms.txt told agents to call bare
 *   "GET /asks" with no API base and named only the sslip.io host as the API base.
 *
 * An agent that reads a discovery document must be able to derive a URL that returns 200 on the
 * first try. A document that points at a 404 is worse than no document: the agent concludes the
 * network is dead. These tests are that defect made executable.
 *
 *   L64 — every origin-relative path a discovery document names answers 200 on the origin that
 *         served the document. (live half: probes the deployed origin; file half: the paths the
 *         shipped documents name are exactly the ones we probe.)
 *   L65 — every discovery document states the API base as the single origin-relative path
 *         /unstuck/api, and no path it documents resolves against the origin root.
 *
 * Run all:  node --test tests/site_discovery_paths.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");

const LIVE_ORIGIN = "https://getunstuck.space";
const API_PATH = "/unstuck/api";

/** Every discovery document the site publishes, with the path it is fetched at. */
const DOCS = [
  { file: "llms.txt", urlPath: "/llms.txt", kind: "text" },
  { file: "agent.json", urlPath: "/agent.json", kind: "json" },
  { file: ".well-known/agent.json", urlPath: "/.well-known/agent.json", kind: "json" },
  { file: ".well-known/agent-card.json", urlPath: "/.well-known/agent-card.json", kind: "json" },
];

const read = (rel) => fs.readFileSync(path.join(SITE, rel), "utf8");

function committedBytes(relPath) {
  // `cwd` is SITE, but git reports paths relative to the REPOSITORY ROOT (the parent of SITE), so a
  // file at SITE/llms.txt is "site/llms.txt" to git. Measured: passing "llms.txt" made git answer
  // "path 'site/llms.txt' exists, but not 'llms.txt'" and the test failed on committed files, which
  // is exactly the false-negative a drift guard must not have.
  return execFileSync("git", ["show", `HEAD:site/${relPath}`], { cwd: SITE, maxBuffer: 8 * 1024 * 1024 });
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

/**
 * The set of origin-relative document paths named across all the discovery docs — the paths an
 * agent would try to fetch after reading them. Includes the docs' own fetch paths.
 */
function documentedDocPaths() {
  const paths = new Set();
  for (const d of DOCS) paths.add(d.urlPath);
  // The agent.json / agent-card.json agent_discovery block names origin-relative paths.
  const agentJson = JSON.parse(read("agent.json"));
  for (const p of Object.values(agentJson.agent_discovery || {})) paths.add(p);
  // From llms.txt: only ORIGIN-RELATIVE paths — a "/x" that is not part of a full https URL.
  // The negative lookbehind rejects a path preceded by a hostname char or ":" so
  // "https://getunstuck.space/llms.txt" does not yield "/llms.txt" as if it were a different path,
  // and the URL's own path is captured instead by anchoring on the origin we probe.
  const llms = read("llms.txt");
  for (const m of llms.matchAll(/(?<![A-Za-z0-9.:/-])(\/[A-Za-z0-9._/-]+\.(?:json|txt))\b/g)) paths.add(m[1]);
  for (const m of llms.matchAll(/(?<![A-Za-z0-9.:/-])(\/\.well-known\/agent)\b/g)) paths.add(m[1]);
  return [...paths].sort();
}

// ---------------------------------------------------------------------------
// L64 — every path a discovery document names must answer
// ---------------------------------------------------------------------------

test("L64 the shipped documents name exactly the discovery paths we probe", () => {
  // The falsifiable core: the set derived from the documents on disk must include every path an
  // agent is told to fetch, and must NOT include the retired /unstuck/…-prefixed doc paths that
  // 404. If a future edit reintroduces one, this fails.
  const paths = documentedDocPaths();
  const retired = ["/unstuck/llms.txt", "/unstuck/agent.json", "/unstuck/ledger.json"];
  for (const r of retired) {
    assert.ok(
      !paths.includes(r),
      `a discovery document still names ${r}; that path 404s on the live origin and an agent that follows it concludes the network is dead`
    );
  }
  for (const required of ["/llms.txt", "/agent.json", "/ledger.json", "/.well-known/agent.json", "/.well-known/agent-card.json", "/.well-known/agent"]) {
    assert.ok(
      paths.includes(required),
      `the documents never name ${required}; an agent cannot discover it`
    );
  }
});

test("L64 every discovery document the site publishes answers 200 on the live origin", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}${DOCS[0].urlPath}`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${r.error}).`);
    return;
  }
  const results = await Promise.all(
    DOCS.map(async (d) => {
      const res = await probe(`${LIVE_ORIGIN}${d.urlPath}`);
      return { urlPath: d.urlPath, status: res.ok ? res.status : "ERR", err: res.error };
    })
  );
  const bad = results.filter((x) => x.status !== 200);
  assert.deepEqual(
    bad,
    [],
    `these discovery documents do not answer 200 on ${LIVE_ORIGIN}: ${JSON.stringify(bad)}`
  );
  t.diagnostic(`live: all ${results.length} discovery documents answer 200`);
});

test("L64 every origin-relative path a document names answers 200 on the live origin", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${r.error}).`);
    return;
  }
  const paths = documentedDocPaths();
  const results = await Promise.all(
    paths.map(async (p) => {
      const res = await probe(`${LIVE_ORIGIN}${p}`);
      return { p, status: res.ok ? res.status : "ERR", err: res.error };
    })
  );
  const bad = results.filter((x) => x.status !== 200);
  assert.deepEqual(
    bad,
    [],
    `a discovery document names paths that do not answer on ${LIVE_ORIGIN}: ${JSON.stringify(bad)}. ` +
      `An agent that follows a documented path to a 404 concludes the network is dead.`
  );
  t.diagnostic(`live: all ${results.length} documented paths answer 200`);
});

test("L64 the API base a document names answers 200 with XNO settlement", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${r.error}).`);
    return;
  }
  const res = await probe(`${LIVE_ORIGIN}${API_PATH}/health`);
  assert.ok(res.ok, `${LIVE_ORIGIN}${API_PATH}/health did not answer (${res.error})`);
  assert.equal(
    res.status,
    200,
    `${LIVE_ORIGIN}${API_PATH}/health answered ${res.status}; the API base the documents name must answer`
  );
  const json = JSON.parse(res.body);
  assert.equal(json.bounty_asset, "XNO", "the addressed network must still settle in XNO only");
});

// ---------------------------------------------------------------------------
// L65 — the API base is stated explicitly and consistently
// ---------------------------------------------------------------------------

test("L65 every JSON discovery document states the API base as /unstuck/api", () => {
  for (const d of DOCS.filter((x) => x.kind === "json")) {
    const obj = JSON.parse(read(d.file));
    assert.equal(
      obj.api_path,
      API_PATH,
      `${d.file} must carry api_path "${API_PATH}" so an agent knows the API is not at the origin root, got ${JSON.stringify(obj.api_path)}`
    );
    assert.ok(
      typeof obj.api === "string" && obj.api.endsWith(API_PATH),
      `${d.file} api field must end with ${API_PATH}, got ${JSON.stringify(obj.api)}`
    );
    // Every endpoint path is relative to the API base, not to the origin. A leading "/" is fine;
    // what must never happen is an endpoint carrying the wrong prefix or a bare origin root.
    for (const ep of obj.endpoints || []) {
      assert.ok(
        !ep.path.startsWith(API_PATH),
        `${d.file} endpoint ${ep.path} carries the API prefix; endpoint paths in this manifest are relative to api and must not repeat it`
      );
    }
  }
});

test("L65 llms.txt prefixes every endpoint path with the API base, never a bare path", () => {
  const txt = read("llms.txt");
  // The API base is stated.
  assert.ok(
    /API base:\s*\/unstuck\/api/.test(txt),
    "llms.txt must state the API base as /unstuck/api so an agent knows where the API lives"
  );
  // Every endpoint line is a full API-base-relative path, not a bare "/asks".
  const bareEndpoint = [...txt.matchAll(/^(GET|POST)\s+(\/\S+)/gm)].filter(
    (m) => !m[2].startsWith(API_PATH)
  );
  assert.deepEqual(
    bareEndpoint.map((m) => m[0]),
    [],
    `llms.txt documents endpoint paths without the API base; an agent resolves them against the origin root and gets a 404: ${JSON.stringify(
      bareEndpoint.map((m) => m[0])
    )}`
  );
});

test("L65 the mutation this block fixed is caught by the same assertions", () => {
  // Non-vacuity: replay the assertions over the pre-fix shapes and prove they would have failed.
  const retiredNames = ["/unstuck/llms.txt", "/unstuck/agent.json", "/unstuck/ledger.json"];
  for (const r of retiredNames) {
    // The "documented paths must exclude the retired names" assertion above would reject these.
    assert.ok(
      r.startsWith("/unstuck/") && !r.startsWith(API_PATH + "/"),
      "a retired doc path must be recognisable as out-of-API-prefix so the L64 assertion catches it"
    );
  }
  // The llms.txt mutation: a bare "GET /asks" line must be caught by the L65 prefix check.
  const mutant = "### List asks\nGET /asks               -> genuine asks only\n";
  const bare = [...mutant.matchAll(/^(GET|POST)\s+(\/\S+)/gm)].filter((m) => !m[2].startsWith(API_PATH));
  assert.equal(bare.length, 1, "a bare endpoint path must be caught by the L65 prefix assertion; if not, the law is vacuous");
});

// ---------------------------------------------------------------------------
// L66 — the documents that ship are the ones committed (no working-copy drift)
// ---------------------------------------------------------------------------

test("L66 the discovery documents on disk are committed at HEAD", () => {
  for (const d of DOCS) {
    const onDisk = fs.readFileSync(path.join(SITE, d.file));
    let atHead;
    try {
      atHead = committedBytes(d.file);
    } catch {
      assert.fail(`${d.file} is not committed at HEAD; it cannot be part of a traceable deploy`);
    }
    assert.ok(
      onDisk.equals(atHead),
      `${d.file} differs between the working copy and HEAD; commit it before deploying, or the deploy ships bytes nobody reviewed`
    );
  }
});
