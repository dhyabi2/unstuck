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

    // --- Step 1 keeps the seed it makes ----------------------------------------
    // The no-install keygen used to print only the address and throw the seed
    // away, so an agent that followed it held an address it could never spend
    // from (and step 3's receive needs that seed). Every copy of the block —
    // the on-ramp document, the static site page and the two outreach docs —
    // must save the seed owner-only, refuse to overwrite an earlier one, and say
    // plainly to keep it private. Run each copy in a scratch directory; the seed
    // is read back only to derive its address and is never printed.
    const os = require("os");
    const REPO = path.join(__dirname, "..");
    const unhtml = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    const copies = [["on-ramp document step 1", step1 && step1.command, "bash"]];
    const page = fs.readFileSync(path.join(REPO, "site", "try-nano.html"), "utf8");
    const pageBlock = page.match(/<pre>(python3 - &lt;&lt;'PY'[\s\S]*?\nPY)<\/pre>/);
    copies.push(["site/try-nano.html step 1", pageBlock && unhtml(pageBlock[1]), "bash"]);
    for (const doc of ["docs/nano-for-usdc-agents.md", "docs/nano-for-task-relays.md"]) {
      const md = fs.readFileSync(path.join(REPO, doc), "utf8");
      for (const m of md.matchAll(/```(python|bash)\n([\s\S]*?)```/g)) {
        if (m[2].includes("os.urandom(32)")) copies.push([`${doc} ${m[1]} block`, m[2], m[1]]);
      }
    }
    check("L57 every copy of the step-1 keygen was found (doc, page, 2 docs x 2 blocks)", copies.length === 6 && copies.every((c) => c[1]), copies.map((c) => c[0] + ":" + !!c[1]).join(", "));
    for (const [label, code, lang] of copies) {
      if (!code) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l57-seed-"));
      const run = () => require("child_process").spawnSync(lang === "python" ? "python3" : "bash", ["-c", code], { cwd: dir, encoding: "utf8", timeout: 60000 });
      try {
        const r = run();
        const printed = (r.stdout || "").trim();
        const seedFile = path.join(dir, "nano-seed.txt");
        const kept = fs.existsSync(seedFile);
        check(`L57 ${label}: prints an address and saves the seed to nano-seed.txt`, r.status === 0 && /^nano_[13][0-9a-z]{59}$/.test(printed) && kept, `rc=${r.status} saved=${kept}`);
        if (!kept) continue;
        const mode = fs.statSync(seedFile).mode & 0o777;
        const [seedHex, savedAddr] = fs.readFileSync(seedFile, "utf8").split("\n");
        let derived = null;
        try { derived = JSON.parse(execFileSync("python3", [path.join(__dirname, "nano-keygen.py"), "--seed", seedHex], { encoding: "utf8" })).address; } catch (_) {}
        check(`L57 ${label}: the saved seed is owner-only (mode 600)`, mode === 0o600, mode.toString(8));
        check(`L57 ${label}: the saved seed derives the printed address`, /^[0-9a-f]{64}$/.test(seedHex) && derived === printed && savedAddr === printed);
        check(`L57 ${label}: the seed is not on stdout`, !r.stdout.includes(seedHex));
        check(`L57 ${label}: it tells the agent to keep the seed private`, /KEEP IT PRIVATE/.test(r.stderr) && /only key that can spend/.test(r.stderr));
        const again = run();
        check(`L57 ${label}: a second run refuses to overwrite the saved seed`, again.status !== 0 && fs.readFileSync(seedFile, "utf8").startsWith(seedHex));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    check("L57 step 1's prose says the seed is saved and must stay private",
      !!(step1 && /nano-seed\.txt/.test(step1.no_install) && /private/i.test(step1.no_install)), step1 && step1.no_install);
    const step3 = doc.steps.find((s) => s.n === 3);
    check("L57 step 3 receives with the seed step 1 saved, not an unnamed 'network seed'",
      !!(step3 && /nano-seed\.txt/.test(step3.command) && !/network seed/.test(step3.command) && /NANO_SEED=/.test(step3.command.split("\n")[0])), step3 && step3.command);

    // --- The root ledger no longer names the retired handout -------------------
    const ledger = JSON.parse(fs.readFileSync(path.join(REPO, ".ledger", "ledger.json"), "utf8"));
    const laws = (Array.isArray(ledger) ? ledger : ledger.laws || ledger.entries || []).filter((l) => l && (l.id === "L56" || l.id === "L63"));
    check("L57 root ledger L56 and L63 are present", laws.length === 2, String(laws.length));
    for (const l of laws) {
      const text = `${l.statement} ${l.test}`;
      check(`L57 root ledger ${l.id} names POST /v1/onramp/self, not GET /v1/onramp/address`,
        /POST \/(unstuck\/api\/)?v1\/onramp\/self/.test(text) && !/GET \/(unstuck\/api\/)?v1\/onramp\/address(?! answers 410)/.test(text) && !/\{address, seed, index\}/.test(text), text.slice(0, 200));
      check(`L57 root ledger ${l.id} says no key material is returned`, /no key material/.test(text));
    }
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