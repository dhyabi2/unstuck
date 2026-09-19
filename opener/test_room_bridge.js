#!/usr/bin/env node
/**
 * test_room_bridge.js — Block 108, grounds law L64.
 *
 * Law: A reply posted into a Speedbot room is recorded in the bridge and exported to the
 * public conversation repo for that outside agent.
 *
 * What is proven, against the REAL bridge (not a stub), on a scratch bridge database:
 *  - speedbot-room.js posts to POST /api/rooms/:id/messages and, on 200, records the reply
 *    through the real `unstuck-bridge said`, which writes a row into a sqlite bridge db;
 *  - that row is read back from the database and its text is the reply;
 *  - a non-200 post records nothing;
 *  - the platform key is read from the key file and never appears in the output.
 *
 * A local stub Speedbot stands in for the network; the bridge is the real one, pointed at a
 * scratch UNSTUCK_BRIDGE_DB, so this test writes no conversation and costs nothing.
 * Exit 0 = pass, non-zero = number of failures.
 */
"use strict";

const http = require("http");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 4399;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unstuck-room-"));
const KEY_FILE = path.join(TMP, "key.txt");
const BRIDGE_DB = path.join(TMP, "bridge.db");

let failures = 0;
const ok = (c, m) => { if (c) console.log(`  ok  ${m}`); else { console.log(`FAIL  ${m}`); failures++; } };

fs.writeFileSync(KEY_FILE, "speedbot: agent_id=agent_test key=sb_testkey123\n");

function waitHealth() {
  return new Promise((resolve, reject) => {
    const tick = (n) => http.get(`http://127.0.0.1:${PORT}/health`, (r) => { r.resume(); resolve(); })
      .on("error", () => (n <= 0 ? reject(new Error("stub never came up")) : setTimeout(() => tick(n - 1), 50)));
    tick(50);
  });
}

function run(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, "speedbot-room.js"), ...args], {
      env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

/** Read the bridge rows back with the same sqlite the bridge wrote them to. */
function bridgeRows() {
  if (!fs.existsSync(BRIDGE_DB)) return [];
  const q = "SELECT agent, direction, text FROM messages ORDER BY id;";
  const r = spawnSync("python3", ["-c",
    `import sqlite3,json,sys\n` +
    `c=sqlite3.connect(${JSON.stringify(BRIDGE_DB)})\n` +
    `print(json.dumps(c.execute(${JSON.stringify(q)}).fetchall()))`], { encoding: "utf8" });
  if (r.status !== 0) return [];
  try { return JSON.parse(r.stdout); } catch (_) { return []; }
}

async function main() {
  const stub = http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); return res.end("{}"); }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization || "";
      const m = req.url.match(/^\/api\/rooms\/(room_\w+)\/messages$/);
      if (req.method === "POST" && m) {
        if (!auth.startsWith("Bearer sb_testkey123")) { res.writeHead(401); return res.end("{}"); }
        if (m[1] === "room_good") { res.writeHead(200); return res.end(JSON.stringify({ message: { id: 7 } })); }
        res.writeHead(409); return res.end(JSON.stringify({ error: "not_your_turn" }));
      }
      res.writeHead(404); res.end("{}");
    });
  });
  await new Promise((r) => stub.listen(PORT, r));
  await waitHealth();

  const env = { SPEEDBOT_BASE: `http://127.0.0.1:${PORT}`, UNSTUCK_BRIDGE_DB: BRIDGE_DB };

  try {
    // 0. The real bridge refuses a reply from an agent never recorded, so record it first
    //    (this is the rule the bridge enforces, and the test must obey it too).
    const seen = spawnSync("unstuck-bridge", ["seen", "--agent", "CSV Helper Research",
      "--source", "https://speedbot.dev/api/agents/agent_test", "--pays-in", "usdc"],
      { env: { ...process.env, ...env }, encoding: "utf8" });
    ok(seen.status === 0, `the test agent can be recorded with 'seen' (got ${seen.status}) ${seen.stderr || ""}`);

    // 1. A successful post is recorded through the REAL bridge into the real db.
    const reply = "hello from the test room, recorded in the real bridge";
    const good = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_good", "--text", reply], env);
    ok(good.code === 0, `successful post exits 0 (got ${good.code}) ${good.err.trim()}`);

    const rows = bridgeRows();
    ok(rows.length === 1, `exactly one bridge row on a 200 (got ${rows.length})`);
    if (rows.length) {
      ok(rows[0][0] === "CSV Helper Research", `bridge row names the agent (got "${rows[0][0]}")`);
      ok(rows[0][1] === "out", `bridge row records an outgoing message (got "${rows[0][1]}")`);
      ok(rows[0][2] === reply, `bridge row text is the reply (got "${String(rows[0][2]).slice(0, 60)}")`);
    } else {
      ok(false, "no bridge row to inspect");
    }

    // 2. The key is never printed.
    ok(!/sb_testkey123/.test(good.out + good.err), "the platform key never appears in the output");

    // 3. A refused post records nothing.
    const bad = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_bad", "--text", "this must not be recorded"], env);
    ok(bad.code !== 0, `a refused post exits non-zero (got ${bad.code})`);
    ok(bridgeRows().length === 1, `a refused post adds no bridge row (still ${bridgeRows().length})`);

    // 4. Dry run does not post or record.
    const dry = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_good", "--text", "dry", "--dry-run"], env);
    ok(dry.code === 0 && bridgeRows().length === 1, "a dry run neither posts nor records");
  } finally {
    stub.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nPASS test_room_bridge.js" : `\n${failures} FAILURE(S) in test_room_bridge.js`);
  process.exit(failures);
}

main().catch((e) => { console.error(e); process.exit(99); });
