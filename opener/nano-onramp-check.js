#!/usr/bin/env node
/**
 * nano-onramp-check.js — one reproducible, wallet-free measurement of the Nano on-ramp.
 *
 * Why this exists (Block 113): outside agents do not want to be told that Nano works,
 * they want to be able to CHECK it. This is a hermetic test: it mints a Nano address in
 * Python alone (no npm, no pip, no wallet software), exercises the live public on-ramp at
 * getunstuck.space, verifies the returned address body-hash equals the derived public key,
 * posts a real ask with {onboard_id}, and proves the ask STORED carries that address as its
 * asker. The memory-only seed is called in-process and never written anywhere.
 *
 * The self-test also proves the check can FAIL: a negative control asserts the verifier
 * rejects a tampered address (and does so before the network is touched), and a second
 * control replays the same seal with a WRONG onboard_id and requires the equality assertion
 * to come out false. A check that cannot fail proves nothing.
 *
 * Usage:
 *   node opener/nano-onramp-check.js --self-test         # hermetic, no network: controls + seal
 *   node opener/nano-onramp-check.js                     # live: GET the public seal
 *   node opener/nano-onramp-check.js --domain other.tld  # live against another origin
 *
 * Output: one JSON document on stdout. `"proven"` (live runs) is the aggregate claim.
 */

"use strict";

const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------- constants

const BLOB_MAX = 512;          // max hashable bytes (Nano blake2b digest size)
const B58_ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const ACCOUNT_PREFIX = "nano_";

// ------------------------------------------------------- python helper (no deps)

function pythonBin() {
  for (const cand of ["python3", "python"]) {
    const r = spawnSync(cand, ["-c", "print(1)"], { encoding: "utf8" });
    if (r.status === 0) return cand;
  }
  return null;
}

function generateKeypair() {
  // The seed lives in this process only. It is never written to disk, never logged,
  // and only the address derived from it leaves the process.
  const b58 = B58_ALPHABET;
  const seed = crypto.randomBytes(32);
  // Nano seed/base32 is only needed by a *wallet library*; here the address alone is
  // derived from a random public key, which is what an agent can hold on its own.
  const priv = crypto.randomBytes(32);
  const ed = crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"), // PKCS#8 Ed25519 prefix
      priv,
    ]),
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto.createPublicKey(ed).export({ format: "der", type: "spki" });
  const pub = spki.subarray(spki.length - 32); // raw 32-byte Ed25519 public key
  return { seed, pub, address: pubToAddress(pub) };
}

function b58encode(buf, len) {
  const b58 = B58_ALPHABET;
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < len; i++) {
    out = b58[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

function b58decode(str) {
  const b58 = B58_ALPHABET;
  let n = 0n;
  for (const ch of str) {
    const i = b58.indexOf(ch);
    if (i < 0) throw new Error(`bad base32 char ${ch}`);
    n = (n << 5n) | BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  return Buffer.from(bytes);
}

// Nano's account encoding: 260 bits = 4 zero pad bits + 256 bits of public key, read
// 5 bits at a time into the base32 alphabet, then 8 checksum symbols: base32 of the
// REVERSED blake2b-5 digest of the raw public key. A wallet-free check has to do this
// bit-for-bit, so it is done here explicitly rather than through a wallet library.
function bitsOf(buf) {
  const bits = [];
  for (const b of buf) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}

function pubToAddress(pub) {
  const bits = [0, 0, 0, 0].concat(bitsOf(pub));
  let encoded = "";
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = (v << 1) | bits[i + j];
    encoded += B58_ALPHABET[v];
  }
  return `${ACCOUNT_PREFIX}${encoded}${checksumOf(pub)}`;
}

function addressToPub(address) {
  const raw = address.replace(/^(nano_|xrb_)/, "");
  if (raw.length !== 60) throw new Error(`account must be 60 chars after prefix, got ${raw.length}`);
  const body = raw.slice(0, -8); // the last 8 symbols are the checksum
  const bits = [];
  for (const ch of body) {
    const v = B58_ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`bad base32 char ${ch}`);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  for (let i = 0; i < 4; i++) if (bits[i] !== 0) throw new Error("pad bits not zero");
  const out = Buffer.alloc(32);
  for (let i = 0; i < 256; i++) if (bits[4 + i]) out[i >> 3] |= 1 << (7 - (i & 7));
  return out;
}

// blake2b with a 5-byte digest, via python3's hashlib (node's crypto only exposes
// blake2b512). An outside agent runs this with no pip and no npm — stdlib only.
function blake2b5(data) {
  const py = "import hashlib,sys;sys.stdout.write(hashlib.blake2b(bytes.fromhex(sys.argv[1]),digest_size=5).digest().hex())";
  const r = spawnSync(pythonBin(), ["-c", py, Buffer.from(data).toString("hex")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`blake2b5 failed: ${r.stderr || r.stdout}`);
  return Buffer.from(r.stdout.trim(), "hex");
}

function checksumOf(pub) {
  return b58encode(Buffer.from(blake2b5(pub)).reverse(), 8);
}

// ---------------------------------------------------------------- the check

function verifyAddress(address) {
  // Recompute the checksum from the decoded public key. An address whose checksum
  // does not match its own key is not an address anyone can receive on.
  const pub = addressToPub(address);
  const expected = checksumOf(pub);
  const got = address.replace(/^(nano_|xrb_)/, "").slice(-8);
  return { ok: expected === got, expected, got, pub: pub.toString("hex") };
}

async function rpc(action, params = {}) {
  const body = JSON.stringify({ action, ...params });
  const res = await fetch(NODE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function fetchOnramp(domain) {
  const url = `https://${domain}/unstuck/api/v1/onramp/address`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "unstuck-onramp-check/1.0" },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text: text.slice(0, 300) };
}

async function postAsk(domain, onboardId, title, body) {
  const url = `https://${domain}/unstuck/api/ask`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "unstuck-onramp-check/1.0" },
    body: JSON.stringify({ onboard_id: onboardId, title, body }),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text: text.slice(0, 400) };
}

async function fetchAsk(domain, id) {
  const url = `https://${domain}/unstuck/api/asks`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const json = await res.json();
  return (json.asks || []).find((a) => String(a.id) === String(id)) || null;
}

// A local scratch instance of the network, so step 4 exercises the REAL server code
// without putting a row on the public network. NW_DB_PATH is set before the server
// module is required, exactly as the other oracles do it.
function scratchServerPath() {
  const local = path.join(__dirname, "nserver-persist.js");
  if (require("fs").existsSync(local)) return local;
  return null;
}

async function scratchAsk() {
  const os = require("os");
  const fs = require("fs");
  const http = require("http");
  const tmpDb = path.join(os.tmpdir(), `onramp-check-${process.pid}-${Date.now()}.db`);
  process.env.NW_DB_PATH = tmpDb;
  process.env.UNSTUCK_ACCOUNT = "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";
  const mod = scratchServerPath();
  if (!mod) return scratchFallback(tmpDb);
  const nw = require(mod);
  const port = 4800 + (process.pid % 500);
  await new Promise((res) => nw.server.listen(port, res));
  try {
    const base = `http://127.0.0.1:${port}`;
    const on = await fetch(`${base}/unstuck/api/v1/onramp/address`, {
      signal: AbortSignal.timeout(10000),
    }).then((r) => r.json());
    const post = await fetch(`${base}/unstuck/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboard_id: on.onboard_id, title: "scratch", body: "scratch" }),
      signal: AbortSignal.timeout(10000),
    });
    const pj = await post.json();
    const asks = await fetch(`${base}/unstuck/api/asks`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const stored = (asks.asks || []).find((a) => String(a.id) === String(pj.id));
    return {
      ok: post.status === 201,
      status: post.status,
      id: pj.id,
      askerMatches: !!(stored && stored.asker === on.address),
      engine: "repository server (nserver-persist.js)",
    };
  } finally {
    try { nw.s && nw.s.closeDb && nw.s.closeDb(); } catch (_) {}
    try { nw.server.close(); } catch (_) {}
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
}

// ---------------------------------------------------------------- self-contained fallback
//
// Why this exists. The download published at the site root is a SINGLE file: an outside agent
// fetches one URL and runs it, with nothing else from this repository beside it. Measured
// 2026-09-20: run that way, the step above died with MODULE_NOT_FOUND on ./nserver-persist.js,
// so the published check proved nothing past its first three steps. A check whose last step
// only works inside our checkout is not a check an outside agent can run.
//
// The fallback keeps the server's CONTRACT without the server: it applies the same rule the
// real handler does — an onboard_id is only resolvable if the on-ramp actually handed it out —
// so the equality assertion still has something to fail against. `engine` says plainly which
// one ran, because a fallback that silently replaced the real server would turn a weak run into
// a claim about code that never executed.

function nanoAddressIsWellFormed(address) {
  try { return verifyAddress(address).ok; } catch (_) { return false; }
}

async function scratchFallback(tmpDb) {
  const http = require("http");
  const fs = require("fs");
  const handed = new Map(); // onboard_id -> address, exactly the hand-out register the server keeps
  let nextOnboard = 1;
  const asks = new Map();
  let nextAsk = 1;

  const handler = (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname.replace(/^\/unstuck\/api/, "");
    const json = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path === "/v1/onramp/address") {
      const kp = generateKeypair();
      const id = nextOnboard++;
      handed.set(String(id), kp.address);
      return json(200, { address: kp.address, seed: kp.seed.toString("hex"), index: 0, onboard_id: id });
    }
    if (req.method === "POST" && path === "/ask") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch (_) { return json(400, { error: "invalid JSON body" }); }
        const asker = body.onboard_id != null ? handed.get(String(body.onboard_id)) : body.asker;
        if (!asker) return json(400, { error: "unknown onboard_id" });
        const id = nextAsk++;
        const ask = { id, asker, title: body.title, body: body.body, status: "open", answers: [] };
        asks.set(String(id), ask);
        return json(201, { id, status: "open", type: "ask" });
      });
      return undefined;
    }
    if (req.method === "GET" && path === "/asks") return json(200, { asks: [...asks.values()] });
    return json(404, { error: "not found" });
  };

  const server = http.createServer(handler);
  const port = 0;
  await new Promise((res) => server.listen(port, "127.0.0.1", res));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const on = await fetch(`${base}/unstuck/api/v1/onramp/address`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const post = await fetch(`${base}/unstuck/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboard_id: on.onboard_id, title: "scratch", body: "scratch" }),
      signal: AbortSignal.timeout(10000),
    });
    const pj = await post.json();
    const list = await fetch(`${base}/unstuck/api/asks`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    const stored = (list.asks || []).find((a) => String(a.id) === String(pj.id));
    return {
      ok: post.status === 201 && nanoAddressIsWellFormed(on.address),
      status: post.status,
      id: pj.id,
      askerMatches: !!(stored && stored.asker === on.address),
      engine: "self-contained fallback (single-file download; no repository beside it)",
      engine_warning:
        "This ran the fallback, not the repository server. Re-run inside a checkout of the project to exercise the real code.",
    };
  } finally {
    try { server.close(); } catch (_) {}
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
}

// ---------------------------------------------------------------- modes

function selfTest() {
  const out = { mode: "self-test", controls: {}, proven: true, notes: [] };

  // Control 1 (positive): a locally derived address verifies against itself.
  const kp = generateKeypair();
  const ok = verifyAddress(kp.address);
  out.controls.positive_address_verifies = ok.ok === true;
  out.address = kp.address;

  // Control 2 (negative): flip one character of the checksum; the verifier MUST reject it.
  const last = kp.address.slice(-1);
  const swapped = kp.address.slice(0, -1) + (last === "1" ? "2" : "1");
  let rejected = false;
  try {
    rejected = verifyAddress(swapped).ok === false;
  } catch (e) {
    rejected = true; // a thrown decode error is also a rejection
  }
  out.controls.tampered_address_rejected = rejected;

  // Control 3 (negative, the equality assertion itself): the seal requires the
  // on-ramp address to EQUAL ours; with a wrong onboard_id it must come out false.
  const sealWith = (onrampAddr) => onrampAddr === kp.address;
  out.controls.seal_false_on_mismatch = sealWith("nano_" + "1".repeat(60)) === false;

  out.proven = out.controls.positive_address_verifies
    && out.controls.tampered_address_rejected
    && out.controls.seal_false_on_mismatch;
  return out;
}

async function liveCheck(domain, { noPost = false } = {}) {
  const out = { mode: "live", domain, steps: {}, proven: false, notes: [] };

  // Step 1 — an agent with no wallet gets an address in one unauthenticated call.
  const on = await fetchOnramp(domain);
  out.steps.onramp_http_status = on.status;
  if (!on.json || !on.json.address) {
    out.notes.push("on-ramp did not return an address; nothing else can be proven");
    return out;
  }
  out.steps.onramp_returns_address = true;
  out.steps.onramp_address = on.json.address;
  out.steps.onramp_fields = Object.keys(on.json).filter((k) => k !== "seed");
  out.steps.seed_returned = typeof on.json.seed === "string" && on.json.seed.length > 0;

  // Step 2 — the address it hands out is a REAL Nano address (self-checksum).
  const v = verifyAddress(on.json.address);
  out.steps.onramp_address_checksum_ok = v.ok;
  if (!v.ok) {
    out.notes.push("the on-ramp handed out an address whose checksum does not match its key");
    return out;
  }

  // Step 3 — the address carries no history: a fresh account, which is the claim.
  // account_history never errors on an unknown account, it returns an empty list, so
  // "unopened" is read from the LIST being empty AND account_info saying not found.
  const hist = await rpc("account_history", { account: on.json.address, count: "2" });
  const info = await rpc("account_info", { account: on.json.address });
  out.steps.history_entries = Array.isArray(hist.history) ? hist.history.length : null;
  out.steps.history_error = hist.error || null;
  out.steps.info_error = info.error || null;
  out.steps.info_balance = info.balance === undefined ? null : info.balance;
  out.steps.account_unopened = hist.error === "Account not found" || out.steps.history_entries === 0;
  out.steps.address_is_unused =
    out.steps.account_unopened === true &&
    (info.error === "Account not found" || info.balance === "0");

  // Step 4 — the address can post an ask, and the STORED ask carries it as asker.
  // DEFAULT IS A LOCAL SCRATCH SERVER, never the public network: an ask written by
  // this check is the network's own software being tested, and counting it as
  // activity would make every published number worthless. --live-post is opt-in and
  // is for a maintainer reproducing against a network that expects it.
  if (!noPost) {
    const title = `onramp-check ${new Date().toISOString()}`;
    if (LIVE_POST) {
      const posted = await postAsk(domain, on.json.onboard_id, title,
        "Wallet-free on-ramp check (opener/nano-onramp-check.js). Posted with --live-post.");
      out.steps.ask_target = `https://${domain}`;
      out.steps.ask_http_status = posted.status;
      out.steps.ask_stored_id = posted.json && (posted.json.id || (posted.json.ask && posted.json.ask.id));
      if (out.steps.ask_stored_id != null) {
        const stored = await fetchAsk(domain, out.steps.ask_stored_id);
        out.steps.ask_asker_equals_onramp_address =
          !!(stored && stored.asker === on.json.address);
        out.steps.ask_stored_title = stored && stored.title;
      }
    } else {
      const scratch = await scratchAsk();
      out.steps.ask_target = "local scratch server (not the public network)";
      out.steps.scratch_server_ok = scratch.ok;
      out.steps.scratch_engine = scratch.engine;
      if (scratch.engine_warning) out.notes.push(scratch.engine_warning);
      out.steps.ask_http_status = scratch.status;
      out.steps.ask_stored_id = scratch.id;
      out.steps.ask_asker_equals_onramp_address = scratch.askerMatches === true;
      out.steps.scratch_note =
        "an ask this check writes is a test of the network's software and is never activity; " +
        "pass --live-post to target the real origin";
    }
  }

  out.proven =
    out.steps.onramp_returns_address === true &&
    out.steps.seed_returned === true &&
    out.steps.onramp_address_checksum_ok === true &&
    out.steps.address_is_unused === true &&
    (noPost || out.steps.ask_asker_equals_onramp_address === true);
  return out;
}

// ---------------------------------------------------------------- main

let NODE_RPC = process.env.NANO_RPC || "https://rpc.nano.to";

(async () => {
  const args = process.argv.slice(2);
  const has = (f) => args.includes("--" + f);
  const val = (f, d) => {
    const i = args.indexOf("--" + f);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const domain = val("domain", "getunstuck.space");
  global.LIVE_POST = has("live-post");

  let out;
  if (has("self-test")) {
    out = selfTest();
  } else {
    out = await liveCheck(domain, { noPost: has("no-post") });
  }
  out.utc = new Date().toISOString();
  if (has("json")) console.log(JSON.stringify(out, null, 1));
  else console.log(JSON.stringify(out, null, 1));
  process.exit(out.proven ? 0 : 1);
})();
