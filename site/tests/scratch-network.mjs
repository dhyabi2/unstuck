/**
 * tests/scratch-network.mjs — a local scratch instance of the shipped network server.
 *
 * Why this exists. A law that proves the network's HTTP write path must actually POST something.
 * But a suite that POSTs to the deployed origin writes a row into the production ask store on
 * every run — and that store is the denominator for "outside asks", the one number this network
 * may honestly publish. Measured 2026-09-20: L68's round trip against https://getunstuck.space
 * put 19 asks of our own into the live store in a single hour, `asks_we_wrote_total` reached 540,
 * and `unstuck-bridge asks-target` reported `self_filling: true`.
 *
 * So: the round trip exercises the REAL handler, in a scratch process of our own, with the store
 * diverted to a temp file. Nothing that writes ever touches the deployed network; the deployed
 * origin stays in the tests as a read-only probe (GET /health, GET /asks).
 *
 * The design copies opener/nano-onramp-check.js's scratchAsk() deliberately — one pattern in the
 * repository, not a second way of doing it. Two details carry the weight:
 *
 *   - NW_DB_PATH is set BEFORE nserver-persist.js is required, because network-store.js reads it
 *     at module load. Set it after, and the server quietly uses the production database.
 *   - the server is required IN-PROCESS (module.exports.server), so the code under test is the
 *     committed file, byte for byte, rather than a reimplementation in the test.
 *
 * If the module cannot be loaded (the file moved, a dependency is missing), this reports
 * engine: "fallback" in its diagnostic and never pretends the real server ran — a fallback that
 * silently stood in for the real handler would turn a weak run into a claim about code that never
 * executed.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const REPO = path.resolve(SITE, "..");
const require = createRequire(import.meta.url);

/** The committed server this scratch instance is supposed to be. */
export const SERVER_SOURCE = path.join(REPO, "opener", "nserver-persist.js");
/** The store the server uses when it is not diverted — named so a test can prove we never touched it. */
export const PRODUCTION_DB = path.join(REPO, "opener", "network-store.db");

/** Every file this run created, so a test can assert the scratch db is gone afterwards. */
export const scratchFiles = new Set();

/**
 * Start a scratch network server on a temp database.
 *
 * Returns { base, mode, tmpDb, stop }. `mode` is "server" when the real committed handler is
 * serving, "fallback" when only the contract could be reproduced.
 *
 * One trap, learned the hard way. network-store.js reads NW_DB_PATH once, at module load, and
 * keeps the connection in a module-level singleton. Requiring it a second time in the same
 * process therefore reuses the FIRST database: a second scratch instance would report a new
 * tmpDb path that is never created, while every write silently landed in the previous store.
 * Node's test runner runs each test in its own process, so this only bit when two scratch
 * instances were started in one process — which is exactly what a suite does. The fix is to
 * drop the cached module before each start, so the path read at load is the one we just set.
 */
export async function startScratchNetwork() {
  const tmpDb = path.join(
    os.tmpdir(),
    `site-scratch-net-${process.pid}-${crypto.randomBytes(4).toString("hex")}.db`
  );
  scratchFiles.add(tmpDb);
  scratchFiles.add(tmpDb + "-wal");
  scratchFiles.add(tmpDb + "-shm");

  // Set BEFORE the require: network-store.js reads NW_DB_PATH at module load time.
  process.env.NW_DB_PATH = tmpDb;
  process.env.UNSTUCK_WALLET_FILE = process.env.UNSTUCK_WALLET_FILE || "/nonexistent/wallet.json";

  if (!fs.existsSync(SERVER_SOURCE)) {
    return startFallback(tmpDb);
  }
  let nw;
  try {
    // Evict the server and its store from the require cache, so this start gets a store bound to
    // the tmpDb set above rather than the one a previous start opened.
    for (const key of Object.keys(require.cache)) {
      if (key === SERVER_SOURCE || key.endsWith("/network-store.js") || key.endsWith("/network.js")) {
        delete require.cache[key];
      }
    }
    nw = require(SERVER_SOURCE);
    if (!nw || !nw.server) throw new Error("module exported no server");
  } catch (e) {
    return startFallback(tmpDb, String(e.message || e));
  }

  // Port 0: the OS assigns one. A fixed port collides with whatever else is running on the box,
  // and the collision would look like a failing law instead of a busy port.
  await new Promise((res, rej) => {
    nw.server.once("error", rej);
    nw.server.listen(0, "127.0.0.1", res);
  });
  const port = nw.server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    mode: "server",
    tmpDb,
    stop: () => {
      try { nw.s && nw.s.closeDb && nw.s.closeDb(); } catch { /* already closed */ }
      try { nw.server.close(); } catch { /* already closed */ }
      cleanup(tmpDb);
    },
  };
}

/**
 * The contract without the server: the same hand-out rule the real handler applies (an onboard_id
 * resolves only if the on-ramp handed it out), so the equality assertion still has something it
 * can fail against. Never counted as the real server — `mode` says which one ran.
 */
async function startFallback(tmpDb, reason = "server module not loadable") {
  const handed = new Map();
  let nextOnboard = 1;
  let nextAsk = 1;
  const asks = new Map();

  const json = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  };

  const handler = (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const p = url.pathname.replace(/^\/unstuck\/api/, "") || "/";
    if (req.method === "GET" && p === "/health") return json(res, 200, { status: "ok" });
    if (req.method === "GET" && p === "/v1/onramp/address") {
      const kp = fallbackKeypair();
      const id = nextOnboard++;
      handed.set(String(id), kp.address);
      return json(res, 200, { address: kp.address, seed: kp.seed, index: 0, onboard_id: id, engine: "fallback" });
    }
    if (req.method === "POST" && p === "/ask") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: "invalid JSON body" }); }
        const asker = body.onboard_id != null ? handed.get(String(body.onboard_id)) : body.asker;
        if (!asker) return json(res, 400, { error: "unknown onboard_id" });
        const id = nextAsk++;
        asks.set(String(id), { id, asker, title: body.title, body: body.body, status: "open" });
        return json(res, 201, { id, status: "open", type: "ask" });
      });
      return undefined;
    }
    if (req.method === "GET" && p === "/asks") return json(res, 200, { asks: [...asks.values()] });
    if (req.method === "GET" && /^\/ask\/\d+$/.test(p)) {
      const a = asks.get(p.split("/")[2]);
      return a ? json(res, 200, { ask: a }) : json(res, 404, { error: "no ask" });
    }
    return json(res, 404, { error: "not found" });
  };

  const server = http.createServer(handler);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    mode: "fallback",
    fallbackReason: reason,
    tmpDb,
    stop: () => {
      try { server.close(); } catch { /* already closed */ }
      cleanup(tmpDb);
    },
  };
}

function cleanup(tmpDb) {
  for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
    try { fs.unlinkSync(f); } catch { /* never created */ }
  }
  scratchFiles.delete(tmpDb);
  scratchFiles.delete(tmpDb + "-wal");
  scratchFiles.delete(tmpDb + "-shm");
}

/**
 * A well-formed Nano address for the fallback engine. It is NOT a real keypair and never needs to
 * be: the fallback proves the contract (an onboard_id resolves to the address that was handed
 * out), and L74 fails the build if a fallback ever runs in a real checkout. The address is shaped
 * so the same `/^nano_[13][0-9a-z]{59}$/` assertion in the round trip holds for it too.
 */
function fallbackKeypair() {
  const seed = crypto.randomBytes(32).toString("hex").toUpperCase();
  // The alphabet Nano addresses actually use, minus the characters the round trip's regex
  // excludes — a fallback that handed out an address failing the suite's own shape check would
  // turn a contract proof into a false failure.
  const alphabet = "13456789abcdefghijkmnopqrstuwxyz";
  // The first character after nano_ is always 1 or 3 (the encoding's high bits are zero), and the
  // whole tail is 60 characters — the shape `/^nano_[13][0-9a-z]{59}$/` every caller checks.
  let address = "nano_" + (crypto.randomBytes(1)[0] % 2 ? "1" : "3");
  for (let i = 0; i < 59; i++) address += alphabet[crypto.randomBytes(1)[0] % alphabet.length];
  return { address, seed };
}

/** True when the scratch database file still exists — the "nothing left behind" assertion. */
export function scratchDbExists(tmpDb) {
  return fs.existsSync(tmpDb);
}

/**
 * The source scanner behind law L73. Returns the offending test files, empty when the suite is
 * clean. Deliberately a source scan (not a rule about how the test is written): a future edit
 * that adds a POST next to LIVE_ORIGIN fails the build, wherever it is added.
 */
export function findLiveWriteCalls(dir) {
  const offenders = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".mjs")) continue;
    const body = fs.readFileSync(path.join(dir, name), "utf8");
    const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // fetch(...) with a write method, where the URL expression mentions the live origin.
    const calls = [...withoutComments.matchAll(/fetch\s*\(([\s\S]{0,400}?)\)\s*[;,\n]/g)];
    for (const m of calls) {
      const arg = m[1];
      if (!/LIVE_ORIGIN/.test(arg)) continue;
      if (!/method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i.test(arg)) continue;
      offenders.push(`${name}: fetch() writes to LIVE_ORIGIN — ${arg.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
  return offenders;
}
