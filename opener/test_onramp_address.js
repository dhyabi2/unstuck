#!/usr/bin/env node
/**
 * Test the RETIRED on-ramp address endpoint (issue 940; was Block 82 — L57).
 *
 * Law L57 (revised 2026-10-02): the network never generates or returns a private
 * key. GET /v1/onramp/address used to answer {address, seed, index} to any
 * anonymous caller — a key the server generated and sent over the wire, i.e.
 * custody by construction. It now answers 410 with no key material under every
 * method, query string and Accept header, and the self-custody path
 * (POST /v1/onramp/self) carries an agent from no address to a posted ask.
 *
 * Method: start the persistent server on a test port with a temp database, hit
 * the retired route every way we can think of, then register an address the
 * test generated itself and post an ask with the onboard_id it gets back.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const tmpDb = `/tmp/test-onramp-address-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

const nw = require("./nserver-persist.js");
const onramp = require("./onramp.js");
const PORT = 4313;

nw.server.listen(PORT);

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const KEY_MATERIAL = /"seed"|"private_?key"|"secret"|[0-9a-fA-F]{64}/i;

/** An address this test generated itself; only the address leaves the process. */
function ownAddress() {
  const out = execFileSync("python3", [path.join(__dirname, "nano-keygen.py")], { encoding: "utf8" });
  return JSON.parse(out).address;
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  try {
    // --- The retired route returns 410 and no key material, however it is asked -----
    const variants = [
      ["GET", "/v1/onramp/address", {}],
      ["GET", "/unstuck/api/v1/onramp/address", {}],
      ["GET", "/v1/onramp/address?format=html", {}],
      ["GET", "/v1/onramp/address?seed=1&index=0&legacy=1", {}],
      ["GET", "/v1/onramp/address", { Accept: "text/html" }],
      ["GET", "/v1/onramp/address", { Accept: "text/plain" }],
      ["POST", "/v1/onramp/address", {}],
      ["HEAD", "/v1/onramp/address", {}],
    ];
    for (const [method, p, headers] of variants) {
      const r = await req(method, p, null, headers);
      const tag = `${method} ${p} ${JSON.stringify(headers)}`;
      check(`L57 ${tag} answers 410`, r.status === 410, String(r.status));
      check(`L57 ${tag} carries no key material`, !KEY_MATERIAL.test(r.body), r.body.slice(0, 160));
    }
    const g = await req("GET", "/v1/onramp/address");
    let gj = null;
    try { gj = JSON.parse(g.body); } catch (_) {}
    check("L57 the 410 says the endpoint is retired", !!(gj && gj.error === "endpoint_retired"), g.body.slice(0, 120));
    check("L57 the 410 names the self-custody replacement",
      !!(gj && JSON.stringify(gj.replacement || {}).includes("/v1/onramp/self")), g.body.slice(0, 200));
    check("L57 the 410 carries no address and no onboard_id", !!(gj && !("address" in gj) && !("onboard_id" in gj)));

    // --- Every path the 410 points at must be one an OUTSIDE agent can send -----------
    // L57b. The 410 is the one thing an agent holding no wallet reads, and its whole job is to
    // hand over a working route. Measured 2026-10-04 on the live network, with every check in
    // this file green: step_1 said "GET /try-nano", which answers 404 at the public origin
    // (https://getunstuck.space/try-nano), while the served path is /unstuck/api/try-nano (200).
    // step_2 in the same object was already absolute, so the object contradicted itself, and an
    // agent that followed step_1 before step_2 concluded the on-ramp was dead.
    //
    // THE TRAP, and why this law checks the spelling and not just reachability: this server
    // strips the /unstuck/api prefix (nserver-persist.js: `if (path.startsWith("/unstuck/api"))`),
    // so BOTH spellings answer 200 here. Probing the named paths against this process would have
    // passed before the fix and proved nothing. Only the public origin routes /unstuck/api/* to
    // the network and serves everything else as a static file, so the prefix is not decoration —
    // it is the difference between a 200 and a 404 for every caller outside this box.
    const PUBLIC_PREFIX = "/unstuck/api";
    // Method and path together: probing a POST-only route with GET answers 404 and would
    // report the route as missing when it is only being asked the wrong way.
    const namedRoutes = (body) =>
      [...JSON.stringify(body || {}).matchAll(/\b(GET|POST|PUT|PATCH|DELETE) (\/[A-Za-z0-9._\/{}:-]+)/g)].map((m) => ({
        method: m[1],
        path: m[2],
      }));

    const named = namedRoutes(gj && gj.replacement);
    check("L57b the 410's replacement names at least two routes", named.length >= 2, JSON.stringify(named));
    const bare = named.filter((r) => !r.path.startsWith(PUBLIC_PREFIX));
    check(
      "L57b every path the 410 names carries the public API prefix",
      bare.length === 0,
      `these resolve against the origin root and 404 for every caller off this box: ${JSON.stringify(bare.map((r) => r.path))}`
    );
    // Reachability, on top of the spelling: a prefixed path that names no handler is still a 404.
    for (const r of named) {
      const probe = await req(r.method, r.path, r.method === "GET" ? null : {});
      check(`L57b the 410 names ${r.method} ${r.path}, which this network answers`, probe.status !== 404, `got ${probe.status}`);
    }
    // Non-vacuity, both halves. The pre-fix body must fail the spelling check...
    const preFix = { step_1: "generate a keypair (GET /try-nano shows a no-install python3 way)", step_2: "POST /unstuck/api/v1/onramp/self" };
    check(
      "L57b the pre-fix 410 body is caught by the spelling check, so this law is not vacuous",
      namedRoutes(preFix).filter((r) => !r.path.startsWith(PUBLIC_PREFIX)).length === 1,
      JSON.stringify(namedRoutes(preFix))
    );
    // ...and the reachability check must be able to fail at all.
    const nowhere = await req("GET", `${PUBLIC_PREFIX}/try-nano-not-a-route`);
    check("L57b a prefixed path naming no handler answers 404, so the probe above can fail", nowhere.status === 404, String(nowhere.status));

    // --- Retiring it hands out no onboard row either ---------------------------------
    let rows = -1;
    try {
      rows = new (require("node:sqlite").DatabaseSync)(tmpDb).prepare("SELECT COUNT(*) AS n FROM onboards").get().n;
    } catch (_) { rows = 0; }
    check("L57 the retired route records no onboard row", rows === 0, String(rows));

    // --- The replacement: an address the agent made, registered, then an ask ---------
    const mine = ownAddress();
    const reg = await req("POST", "/v1/onramp/self", { address: mine });
    let rj = null;
    try { rj = JSON.parse(reg.body); } catch (_) {}
    check("L57 POST /v1/onramp/self registers the agent's own address", reg.status === 201 && rj && rj.address === mine, reg.body.slice(0, 160));
    check("L57 the self path returns no key material", !KEY_MATERIAL.test(reg.body), reg.body.slice(0, 160));
    const posted = await req("POST", "/ask", {
      onboard_id: rj && rj.onboard_id,
      title: "self-custody on-ramp can post",
      body: "an outside agent that registered its own address can ask here",
    });
    check("L57 the self-registered onboard_id can post an ask", posted.status === 201, String(posted.status));
    const list = await req("GET", "/asks");
    check("L57 the ask is attributed to the agent's own address", JSON.parse(list.body).asks.some((a) => a.asker === mine));

    // --- The on-ramp document no longer points at a key-issuing endpoint -------------
    const doc = onramp.onrampDoc({ apiBase: "https://example.test/unstuck/api" });
    const step1 = doc.steps.find((s) => s.n === 1);
    check(
      "L57 the on-ramp's address step names the self-custody endpoint",
      !!(step1 && step1.http_shortcut && step1.http_shortcut.includes("/v1/onramp/self")),
      step1 && step1.http_shortcut
    );
    check(
      "L57 the on-ramp document never tells an agent to fetch a seed from the network",
      !/GET [^ ]*\/v1\/onramp\/address returns/.test(JSON.stringify(doc)) && !/the seed from GET/.test(JSON.stringify(doc))
    );
  } finally {
    nw.s.closeDb();
    nw.server.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-wal"); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-shm"); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall on-ramp address laws pass");
  process.exit(failed ? 1 : 0);
})();
