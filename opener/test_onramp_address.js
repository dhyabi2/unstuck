#!/usr/bin/env node
/**
 * Test the on-ramp address path (Block 82 — L57, revised when the server-side
 * key handout was retired).
 *
 * Law L57: an outside agent can get onto the network with an address it
 * generated itself, and the network never makes, sees or keeps a seed.
 *
 * GET /v1/onramp/address used to generate a keypair on the server and hand over
 * address AND seed. That is counterparty custody, so it is retired: it answers
 * 410 Gone and hands out nothing. The agent runs the stdlib keygen locally and
 * registers only its address with POST /v1/onramp/self.
 *
 * Method: start the persistent server on a test port with a temp database,
 * prove the retired path answers 410 with no key, generate two keypairs locally,
 * register them via POST /v1/onramp/self, POST an ask from that address and
 * prove neither seed reached the store.
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

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } },
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

/** Validate an address with the independent keygen, not the server that made it. */
function keygenValid(address) {
  try {
    const out = execFileSync(
      "python3",
      [path.join(__dirname, "nano-keygen.py"), "--check", address],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return /valid/i.test(out);
  } catch (e) {
    return false;
  }
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  try {
    // --- The retired server-keygen path hands out nothing ----------------------
    const gone = await req("GET", "/v1/onramp/address");
    check("L57 the retired GET /v1/onramp/address answers 410", gone.status === 410, String(gone.status));
    check("L57 the retired path carries no seed or 64-hex key", !/[0-9A-Fa-f]{64}/.test(gone.body), gone.body.slice(0, 120));
    check("L57 the retired path points at POST /v1/onramp/self", /onramp\/self/.test(gone.body), gone.body.slice(0, 120));

    // --- The agent generates its own keypair, locally ---------------------------
    const ownKey = () => JSON.parse(execFileSync("python3", [path.join(__dirname, "nano-keygen.py")], { encoding: "utf8" }));
    const k1 = ownKey();
    const k2 = ownKey();
    check("L57 the agent's own address starts nano_", /^nano_/.test(k1.address), k1.address);
    check("L57 the agent's own address passes the independent keygen", keygenValid(k1.address), k1.address);
    check("L57 two local keygens give two different addresses", k2.address !== k1.address);

    // --- Only the address is registered; the response carries no seed ----------
    const r1 = await req("POST", "/v1/onramp/self", { address: k1.address });
    check("L57 POST /v1/onramp/self registers the agent's own address", r1.status === 201, String(r1.status));
    check("L57 the registration response carries no 64-hex string", !/[0-9A-Fa-f]{64}/.test(r1.body), r1.body.slice(0, 120));
    const r2 = await req("POST", "/v1/onramp/self", { address: k2.address });
    check("L57 a second agent registers too", r2.status === 201, String(r2.status));

    // --- The address actually unlocks an ask (the point of the on-ramp) --------
    const posted = await req("POST", "/ask", {
      asker: k1.address,
      title: "self-generated address can post",
      body: "an outside agent that generated its own address can ask here",
    });
    check("L57 a self-generated address can post an ask", posted.status === 201, String(posted.status));

    const list = await req("GET", "/asks");
    const listed = JSON.parse(list.body).asks.some((a) => a.asker === k1.address);
    check("L57 the ask is attributed to the agent\'s own address", listed);

    // --- The network never stored the seed -------------------------------------
    let raw = "";
    try { raw = fs.readFileSync(tmpDb, "utf8"); } catch (e) { raw = ""; }
    let stored = "";
    try {
      stored = require("node:sqlite")
        ? new (require("node:sqlite").DatabaseSync)(tmpDb).prepare("SELECT asker FROM asks").all().map((r) => r.asker).join("\n")
        : "";
    } catch (e) {
      stored = "";
    }
    check("L57 the server stores the agent\'s address", stored.includes(k1.address), stored.slice(0, 120));
    check("L57 the seed is nowhere in the store", !stored.includes(k1.seed) && !raw.includes(k1.seed));
    check("L57 the second seed is nowhere in the store either", !stored.includes(k2.seed) && !raw.includes(k2.seed));

    // --- The on-ramp document points at the endpoint ---------------------------
    const doc = onramp.onrampDoc({ apiBase: "https://example.test/unstuck/api" });
    const step1 = doc.steps.find((s) => s.n === 1);
    check(
      "L57 the on-ramp's address step no longer pitches the server-side key generator",
      !!(step1 && !step1.http_shortcut && !JSON.stringify(step1).includes("/v1/onramp/address") && step1.no_server_keys),
      step1 && step1.no_server_keys
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