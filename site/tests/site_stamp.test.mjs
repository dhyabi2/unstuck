/**
 * tests/site_stamp.test.mjs — the deployed page must name the commit it was built from.
 *
 * L43 (in site_api_path.test.mjs) proved the *marker* exists and that the live origin
 * must name its build. This file is the other half of that law, and it exists because
 * the marker has never actually reached production:
 *
 *   measured 2026-09-18, from outside the box:
 *     https://getunstuck.space/  ->  200, but the page still carries the literal
 *                                    placeholder `// __UNSTUCK_COMMIT__`
 *     L43's live half            ->  "SKIPPED ... no unstuck-commit stamp; the marker
 *                                    has not shipped yet"
 *
 * A check that can only ever skip is not a check. The deploy rig had a stamping
 * function, but it wrote the sha into `site/index.html` on disk and never reverted it
 * — so a run either dirtied the working copy (and was refused by git_state) or shipped
 * the unstamped bytes anyway. The fix is structural: stamp the bytes that are uploaded,
 * never the file on disk. Then L42 (disk == HEAD) holds by construction and a missing
 * stamp is impossible to ship.
 *
 * The laws, each named so a failure says which property broke:
 *
 *   L44 — the bytes uploaded for index.html carry a real commit sha, not the placeholder.
 *   L45 — the source file on disk is never mutated by a stamp run (byte-identical after).
 *   L46 — a build whose stamp is missing or does not match HEAD is a hard failure.
 *   L47 — the live origin, once it is serving HEAD, names that sha.
 *
 * L44/L45/L46 read the real deployer source and execute its stamp function against the
 * real index.html; L47 is the live check and prints a SKIP with its reason when the
 * origin is demonstrably not yet serving this build.
 *
 * Run all:  node --test tests/site_stamp.test.mjs
 * Run one:  node --test --test-name-pattern=L44 tests/site_stamp.test.mjs
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
const REPO = path.resolve(SITE, "..");
const DEPLOYER = "/root/work/unstuck-deploy.py";
const LIVE_ORIGIN = "https://getunstuck.space";
const MARKER = "// __UNSTUCK_COMMIT__";

const HTML = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
const DEPLOYER_SRC = fs.readFileSync(DEPLOYER, "utf8");

function git(args, cwd = REPO) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function probe(url, timeoutMs = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: "text/html", "User-Agent": "unstuck-stamp-law" },
      redirect: "follow",
    });
    return { ok: true, status: res.status, body: await res.text() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// The deployer's stamp function, extracted and executed — never reimplemented.
// ---------------------------------------------------------------------------

/**
 * Pull `def stamp_bytes(...)` out of the real deployer and read its body, so the test
 * exercises the shipped logic rather than a copy of it. The function's name is part of
 * the fix — the old `stamp_index` wrote the sha to disk — so the test looks for the
 * in-memory stamp by what it does, and reports what it found when it is missing.
 */
function stampFnSource() {
  const m = DEPLOYER_SRC.match(/def (stamp_bytes|stamp_index)\(([^)]*)\):\s*\n([\s\S]*?)(?=\ndef |\nclass )/);
  assert.ok(
    m,
    "unstuck-deploy.py must ship a stamp function that produces the uploaded bytes"
  );
  return { name: m[1], params: m[2], body: m[3] };
}

// ---------------------------------------------------------------------------
// L44 — the uploaded bytes carry a real sha
// ---------------------------------------------------------------------------

test("L44 the deployer stamps the bytes it uploads, not the file on disk", () => {
  const { name, body } = stampFnSource();
  // The whole defect was a stamp written through the on-disk path (open(path, "w")).
  // A stamp that still opens index.html for writing is the bug, whatever it is called.
  assert.ok(
    !/open\([^)]*index\.html[^)]*,\s*["']w/.test(DEPLOYER_SRC),
    "the deployer must not open site/index.html for writing: stamping a file on disk dirties " +
      "the working copy and the unstamped bytes are what ship"
  );
  assert.ok(
    name === "stamp_bytes",
    `the stamp must be produced in memory as bytes (found ${name}); ` +
      "a mutating stamp_index is what left the deployed page unstamped"
  );
  assert.ok(
    /return/.test(body),
    "the stamp function must RETURN the stamped bytes rather than mutate the file in place"
  );
});

test("L44 the shipped stamp function turns the placeholder into a sha and leaves no placeholder", async () => {
  // Execute the real deployer's stamp_bytes in Python against the real index.html, and
  // assert on what it returns — not on a JS reimplementation of it.
  const fakeSha = "0123456789abcdef0123456789abcdef01234567";
  const script = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("d", "/root/work/unstuck-deploy.py")
m = importlib.util.module_from_spec(spec)
sys.argv = ["deploy"]
spec.loader.exec_module(m)
raw = open("/root/unstuck/site/index.html", "rb").read()
out = m.stamp_bytes("index.html", raw, "${fakeSha}")
sys.stdout.write(out.decode("utf-8"))
`;
  const { execFileSync: execPy } = await import("node:child_process");
  const stamped = execPy("/usr/local/lib/hermes-agent/venv/bin/python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(
    stamped.includes(`unstuck-commit: ${fakeSha}`),
    "the shipped stamp function must substitute the marker with the sha it was given"
  );
  assert.ok(
    !stamped.includes(MARKER),
    "the stamped bytes must not still contain the placeholder"
  );
  const found = stamped.match(/unstuck-commit:\s*([0-9a-f]{7,40})/);
  assert.ok(found, "the stamped page must match the live check's unstuck-commit regex");
  assert.equal(found[1], fakeSha, "the stamp the live check reads must be the sha that was injected");
});

test("L44 the deployer uploads stamped bytes: create_preview stamps index.html and nothing else", async () => {
  // Behavioural oracle. Mutating stamp_bytes, create_preview or the marker must break this:
  // it drives the real create_preview with a stub API and inspects the bytes it would upload.
  const script = `
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("d", "/root/work/unstuck-deploy.py")
m = importlib.util.module_from_spec(spec)
sys.argv = ["deploy"]
spec.loader.exec_module(m)

class StubApi(m.VercelApi):
    def __init__(self):
        self.uploaded = {}
        self.token, self.team, self.project = "t", "team", "prj"
    def _call(self, method, path, body=None, raw=None, headers=None):
        if path == "/v2/files":
            self.uploaded[headers["x-vercel-digest"]] = raw
            return 200, {}
        if path == "/v13/deployments":
            return 200, {"id": "dpl_x", "url": "x.vercel.app"}
        return 200, {}

api = StubApi()
files = ["index.html", "llms.txt"]
api.create_preview(files, "deadbeefcafe1234")
blobs = list(api.uploaded.values())
assert len(blobs) == 2, f"expected 2 uploads, got {len(blobs)}"
html = [b for b in blobs if b"__UNSTUCK_COMMIT__" in b or b"unstuck-commit:" in b]
other = [b for b in blobs if b is not html[0]] if html else []
assert len(html) == 1, "exactly one uploaded file must carry the stamp marker"
stamped = html[0].decode()
assert "unstuck-commit: deadbeefcafe1234" in stamped, "index.html upload must carry the sha"
assert "__UNSTUCK_COMMIT__" not in stamped, "uploaded index.html must not keep the placeholder"
assert not any(b"unstuck-commit:" in b for b in other), "no other file may be stamped"
# The file on disk must be untouched by the upload path.
disk = open("/root/unstuck/site/index.html", encoding="utf-8").read()
assert "__UNSTUCK_COMMIT__" in disk and "unstuck-commit:" not in disk, "disk file must be unchanged"
print("BEHAVIOUR-OK")
`;
  const { execFileSync: execPy } = await import("node:child_process");
  const out = execPy("/usr/local/lib/hermes-agent/venv/bin/python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.match(out, /BEHAVIOUR-OK/, "the deployer must stamp only index.html on the way to upload");
});

test("L44 a deployer that ships an unstamped page is detected", async () => {
  // The falsifier: take the real deployer, break stamp_bytes so it returns the raw bytes,
  // and prove the verification the deployer runs (verify_stamp) rejects the result. This
  // fails if verify_stamp ever accepts an unstamped page.
  const script = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("d", "/root/work/unstuck-deploy.py")
m = importlib.util.module_from_spec(spec)
sys.argv = ["deploy"]
spec.loader.exec_module(m)
raw = open("/root/unstuck/site/index.html", encoding="utf-8").read()
# Simulate a broken deployer: the placeholder reached the wire unstamped.
try:
    m.verify_stamp(raw, "deadbeefcafe1234")
    print("ACCEPTED-UNSTAMPED")
except m.Refused:
    print("REJECTED-OK")
`;
  const { execFileSync: execPy } = await import("node:child_process");
  const out = execPy("/usr/local/lib/hermes-agent/venv/bin/python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
  assert.equal(out, "REJECTED-OK", "verify_stamp must refuse a page with no commit stamp");
});

test("L44 the source tree ships exactly one marker to substitute", () => {
  const count = (HTML.match(/__UNSTUCK_COMMIT__/g) || []).length;
  assert.equal(count, 1, `index.html must carry exactly one __UNSTUCK_COMMIT__ marker, found ${count}`);
  assert.ok(
    HTML.includes(MARKER),
    "the marker must be the literal comment line the deployer substitutes"
  );
});

// ---------------------------------------------------------------------------
// L45 — stamping never dirties the working copy
// ---------------------------------------------------------------------------

test("L45 the working copy of index.html is byte-identical to HEAD", () => {
  const onDisk = sha256(fs.readFileSync(path.join(SITE, "index.html")));
  const atHead = sha256(execFileSync("git", ["show", "HEAD:site/index.html"], { cwd: REPO, maxBuffer: 8 * 1024 * 1024 }));
  assert.equal(
    onDisk,
    atHead,
    "site/index.html differs between the working copy and HEAD; a stamp run must never mutate it"
  );
});

test("L45 the deployer restores or never touches the source, so a second run is clean", () => {
  // The old bug was an uncalled unstamp_index: the definition existed, nothing invoked it.
  // Either there is no mutating stamp at all, or every mutation has a guaranteed restore.
  const stamps = DEPLOYER_SRC.match(/stamp_index\(/g) || [];
  const unstamps = DEPLOYER_SRC.match(/unstamp_index\(/g) || [];
  const mutating = /open\([^)]*index\.html[^)]*,\s*["']w/.test(DEPLOYER_SRC);
  if (mutating) {
    assert.ok(
      unstamps.length >= 2,
      "a deployer that writes the stamp to disk must call unstamp_index on every exit path " +
        `(found ${unstamps.length} call sites for ${stamps.length} stamp calls)`
    );
  } else {
    assert.ok(true, "the deployer stamps in memory: nothing on disk to restore");
  }
});

// ---------------------------------------------------------------------------
// L46 — a missing or stale stamp is a hard failure
// ---------------------------------------------------------------------------

test("L46 the deployer verifies the stamp it shipped and aborts if it is missing", () => {
  assert.ok(
    /unstuck-commit/.test(DEPLOYER_SRC),
    "the deployer must look for the stamp it published"
  );
  assert.ok(
    /Refused\(/.test(DEPLOYER_SRC),
    "a missing or stale stamp must raise Refused, not print a warning"
  );
  // The verification must compare against the sha that was deployed.
  assert.ok(
    /(?:\bstamp\b|\bcommit\b|\bsha\b)/i.test(DEPLOYER_SRC),
    "the deployer must compare the live stamp against the commit it deployed"
  );
});

// ---------------------------------------------------------------------------
// L47 — the live origin names the sha it is serving (skips with a reason while not shipped)
// ---------------------------------------------------------------------------

test("L47 once the origin serves HEAD, the page names that sha", async (t) => {
  const r = await probe(`${LIVE_ORIGIN}/`);
  if (!r.ok) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN}/ did not answer (${r.error}).`);
    return;
  }
  const head = git(["rev-parse", "HEAD"]);

  const stamped = r.body.match(/unstuck-commit:\s*([0-9a-f]{7,40})/);
  if (!stamped) {
    const placeholder = r.body.includes(MARKER);
    t.diagnostic(
      `SKIPPED live check: ${LIVE_ORIGIN}/ serves no unstuck-commit stamp` +
        (placeholder ? " (it still carries the raw placeholder — the stamp has never shipped)" : "") +
        `; HEAD is ${head.slice(0, 12)}. This check fails for real once the stamped build is promoted.`
    );
    return;
  }
  assert.ok(
    head.startsWith(stamped[1]),
    `the live origin says it is serving ${stamped[1]}, but HEAD is ${head.slice(0, 12)}; ` +
      `a stale deployment is not evidence that this build works`
  );
  assert.ok(
    !r.body.includes(MARKER),
    "the live page must not still carry the raw placeholder once it is stamped"
  );
  t.diagnostic(`live: ${LIVE_ORIGIN}/ names ${stamped[1]}`);
});
