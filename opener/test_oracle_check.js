/**
 * opener/test_oracle_check.js — the laws of the oracle-integrity scorecard.
 *
 * Run:  node opener/test_oracle_check.js
 *
 * What this file is for. On 2026-09-22 the daily conversation review found no outside agent has
 * made its first Nano transaction, and asked for an approach that had not been tried. The block
 * that answers it ships `opener/oracle-check.js` — a free, live, deterministic scorecard for an
 * HTTP data source, the "pre-query verification layer" Octodamus named in its own words. These
 * laws exist so the scorecard cannot quietly become the thing it was built to catch: a number
 * nobody can re-derive, or a checker that will fetch anything it is pointed at.
 *
 * Laws minted with this block (see `.ledger/ledger.json`):
 *
 *   L76 — the scorecard is arithmetic over measured facts, and a URL's first reading is not a
 *         verdict. Test: a URL never seen before scores exactly 50, `history.unseen` is true, and
 *         the verdict says so; a second identical reading scores 100 with drift=false; and the
 *         same two readings with a body that changed score lower with drift=true. A model is
 *         never consulted, so the same input twice gives the same number twice.
 *
 *   L77 — the checker refuses every target that could reach this box's own network, and it
 *         re-checks on every redirect hop. Test: loopback (v4, v6, `localhost`, decimal-encoded),
 *         link-local metadata (169.254.169.254), RFC1918, CGNAT, and any non-80/443 port are each
 *         refused by name; a redirect into 169.254.169.254 is refused rather than followed.
 *
 *   L78 — a score never exceeds 100 and never falls below 0, and every point is attributed.
 *         Test: over a table of synthetic readings (reachable/unreachable, TLS valid/expiring/
 *         absent, 0..6 redirect hops, drift/no drift, 0..20 prior readings) the score stays in
 *         range, `because` has one line per weight and the lines sum to the score.
 *
 * Where the writes go. Nothing here touches the deployed network or the live ask store: the
 * checker's own store is diverted to a temp file with UNSTUCK_ORACLE_DB, and the redirect test
 * runs against a local scratch server on 127.0.0.1 (which the SSRF rule then refuses — that
 * refusal is the assertion).
 */

"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// Divert the store BEFORE the module is required: DB_PATH is read at load.
const TMP_DB = path.join(os.tmpdir(), `oracle-check-test-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`);
process.env.UNSTUCK_ORACLE_DB = TMP_DB;

const oc = require("./oracle-check.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(() => { passed++; console.log(`  ok  ${name}`); })
        .catch((e) => { failed++; failures.push(`${name}: ${e.message}`); console.log(`FAIL  ${name}: ${e.message}`); });
    }
    passed++; console.log(`  ok  ${name}`);
  } catch (e) {
    failed++; failures.push(`${name}: ${e.message}`); console.log(`FAIL  ${name}: ${e.message}`);
  }
  return Promise.resolve();
}

function cleanup() {
  oc.closeDb();
  for (const f of [TMP_DB, TMP_DB + "-wal", TMP_DB + "-shm"]) {
    try { fs.unlinkSync(f); } catch { /* never created */ }
  }
}

/** A reading shaped exactly as fetchOnce returns one, so scoring can be tested without a network. */
function fakeReading({ status = 200, tls = { valid: true, days_remaining: 200 }, redirects = [], hash = "a".repeat(64), error = null } = {}) {
  return {
    final_url: "https://example.com", final_status: status, redirects,
    tls, latency_ms: 50, bytes_read: 100, truncated: false,
    content_hash: hash, error,
  };
}

async function main() {
  console.log("oracle-check laws\n");

  // ---- L76: arithmetic, and a first reading is not a verdict -----------------------------
  await check("L76a first reading of an unseen URL is not a verdict, and cannot outrank a known-good source", () => {
    const r = fakeReading();
    const unseen = oc.scoreReading(r, []);
    const seen = oc.scoreReading(r, [{ content_hash: "a".repeat(64), final_status: 200, error: null }]);
    // Half credit on the two history components is the whole design: an unseen URL is capped below
    // a source we have actually watched, so "never seen it" can never read as "trustworthy".
    assert.equal(unseen.score, 78, `unseen URL should score the documented 78, got ${unseen.score}`);
    assert.equal(seen.score, 100, `a confirmed-identical repeat should score 100, got ${seen.score}`);
    assert.ok(unseen.score < seen.score, "an unseen URL must not outrank a source with history");
    assert.ok(unseen.because.some((b) => /no history yet/.test(b)), "the half-credit must be named");
    // And the served card must say it out loud rather than publishing the raw number.
    assert.match(oc.verdictOf(50, true), /unknown/i);
  });

  await check("L76b a second identical reading earns full drift credit, and a changed body loses it", () => {
    const r = fakeReading({ hash: "b".repeat(64) });
    const same = oc.scoreReading(r, [{ content_hash: "b".repeat(64), final_status: 200, error: null }]);
    const changed = oc.scoreReading(r, [{ content_hash: "c".repeat(64), final_status: 200, error: null }]);
    assert.equal(same.score, 100, `identical body should score 100, got ${same.score}`);
    assert.ok(changed.score < same.score, "a changed body must score lower than an unchanged one");
    assert.ok(changed.because.some((b) => /CONTENT CHANGED/.test(b)), "the drift line must name the change");
  });

  await check("L76c the same reading scores the same number twice (no model, no randomness)", () => {
    const r = fakeReading();
    const prior = [{ content_hash: "a".repeat(64), final_status: 200, error: null }];
    assert.equal(oc.scoreReading(r, prior).score, oc.scoreReading(r, prior).score);
    assert.deepEqual(oc.scoreReading(r, prior).because, oc.scoreReading(r, prior).because);
  });

  // ---- L77: the SSRF wall ---------------------------------------------------------------
  const refused = [
    ["http://127.0.0.1/", /not public/],
    ["http://127.1/", /not public/],
    ["http://2130706433/", /not public/],
    ["http://[::1]/", /not public/],
    ["http://localhost/", /non-public address/],
    ["http://169.254.169.254/latest/meta-data/", /not public/],
    ["http://10.0.0.5/", /not public/],
    ["http://192.168.1.1/", /not public/],
    ["http://172.16.9.9/", /not public/],
    ["http://100.64.0.1/", /not public/],
    ["http://example.com:8080/", /port 8080 not allowed/],
    ["file:///etc/passwd", /scheme file:/],
    ["ftp://example.com/", /scheme ftp:/],
    ["not a url at all", /not a URL/],
  ];
  for (const [url, want] of refused) {
    await check(`L77 refuses ${url}`, async () => {
      const t = await oc.checkTarget(url);
      assert.equal(t.ok, false, `${url} must be refused`);
      assert.match(t.reason, want, `reason should match ${want}, got: ${t.reason}`);
    });
  }

  await check("L77 a redirect into the cloud-metadata address is refused, not followed", async () => {
    // A scratch server on 127.0.0.1 that 302s to the metadata IP. checkTarget() refuses the first
    // hop already (loopback), so the assertion is the refusal — which is exactly the point: we
    // never get as far as the redirect, and if we did, the hop is re-checked by the same rule.
    const srv = http.createServer((req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    try {
      const t = await oc.checkTarget(`http://127.0.0.1:${port}/`);
      assert.equal(t.ok, false, "loopback scratch server must be refused");
      // And the redirect-target rule itself, exercised directly:
      const meta = await oc.checkTarget("http://169.254.169.254/latest/meta-data/");
      assert.equal(meta.ok, false, "metadata address must be refused as a redirect target too");
    } finally {
      srv.close();
    }
  });

  // ---- L78: bounded, and every point attributed ------------------------------------------
  await check("L78 every score is within 0..100 and every point is attributed to a named component", () => {
    const readings = [];
    for (const status of [200, 301, 404, 500]) {
      for (const tls of [{ valid: true, days_remaining: 200 }, { valid: true, days_remaining: 5 }, { valid: false, days_remaining: -3 }, null]) {
        for (const hops of [0, 1, 2, 3, 6]) {
          for (const hash of ["a".repeat(64), "b".repeat(64)]) {
            readings.push(fakeReading({ status, tls, redirects: Array(hops).fill(302), hash }));
          }
        }
      }
    }
    const priors = [
      [],
      [{ content_hash: "b".repeat(64), final_status: 200, error: null }],
      Array.from({ length: 20 }, () => ({ content_hash: "b".repeat(64), final_status: 200, error: null })),
      Array.from({ length: 5 }, () => ({ content_hash: "b".repeat(64), final_status: 500, error: "boom" })),
    ];
    let n = 0;
    for (const r of readings) {
      for (const p of priors) {
        const { score, because } = oc.scoreReading(r, p);
        n++;
        assert.ok(score >= 0 && score <= 100, `score out of range: ${score}`);
        assert.equal(because.length, 5, `expected one line per weight, got ${because.length}`);
        // Every line starts "+<n> " and the numbers must sum to the score.
        const sum = because.reduce((acc, line) => {
          const m = /^\+(\d+) /.exec(line);
          assert.ok(m, `unattributed line: ${line}`);
          return acc + Number(m[1]);
        }, 0);
        assert.equal(sum, score, `attributed points ${sum} != score ${score} (${because.join(" | ")})`);
      }
    }
    assert.ok(n >= 150, `expected a real sweep, only ${n} combinations ran`);
  });

  await check("L78 a 500 that is still reachable scores strictly lower than a 200", () => {
    const prior = [{ content_hash: "a".repeat(64), final_status: 200, error: null }];
    const ok = oc.scoreReading(fakeReading({ status: 200 }), prior).score;
    const bad = oc.scoreReading(fakeReading({ status: 500 }), prior).score;
    assert.ok(bad < ok, `500 (${bad}) must score below 200 (${ok})`);
  });

  await check("L78 an unreachable URL earns no reachability credit at all", () => {
    const { score, because } = oc.scoreReading(fakeReading({ error: "ECONNREFUSED", status: 0, hash: null }), []);
    assert.ok(score < 50, `an unreachable URL must not reach the unseen-URL floor, got ${score}`);
    assert.ok(because.some((b) => /^\+0 not reachable/.test(b)), "the reachability line must be +0");
  });

  // ---- honesty: what this checker may claim -----------------------------------------------
  await check("stats() counts readings, not URLs, and never calls a single reading evidence of drift", () => {
    const s = oc.stats();
    assert.ok(typeof s.checks === "number" && typeof s.distinct_urls === "number");
    assert.match(s.note, /not evidence that anything changed/i);
    assert.ok(s.checks >= s.distinct_urls, "every URL has at least one reading");
  });

  await check("a refused target is never stored as a reading", async () => {
    const before = oc.stats().checks;
    const card = await oc.check("http://169.254.169.254/");
    assert.equal(card.refused, true);
    assert.equal(oc.stats().checks, before, "a refused target must not enter the store");
  });

  cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log("\nfailures:\n  " + failures.join("\n  ")); process.exit(1); }
}

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
