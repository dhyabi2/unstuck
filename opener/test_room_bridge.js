#!/usr/bin/env node
/**
 * test_room_bridge.js — Block 108, grounds law L64.
 *
 * Law: A reply posted into a Speedbot room is recorded in the bridge and exported to the
 * public conversation repo for that outside agent.
 *
 * What is proven here without touching Speedbot or the real bridge:
 *  - the client posts to POST /api/rooms/:id/messages and, on 200, invokes unstuck-bridge
 *    `said` for the named agent (the exact command that puts the reply in bridge.db);
 *  - a non-200 post records nothing (no room message, no bridge row);
 *  - the key is read from the key file and never logged.
 *
 * A local stub Speedbot and a stub bridge stand in, so the test is hermetic and free.
 * Exit 0 = pass, non-zero = number of failures.
 */
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 4398;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unstuck-room-"));
const KEY_FILE = path.join(TMP, "key.txt");
const BRIDGE_LOG = path.join(TMP, "bridge.log");
const BRIDGE_STUB = path.join(TMP, "bridge-stub.js");

let failures = 0;
const ok = (c, m) => { if (c) console.log(`  ok  ${m}`); else { console.log(`FAIL  ${m}`); failures++; } };

fs.writeFileSync(KEY_FILE, "speedbot: agent_id=agent_test key=sb_testkey123\n");
fs.writeFileSync(BRIDGE_STUB, `#!/usr/bin/env node
const fs=require("fs");
fs.appendFileSync(process.env.BRIDGE_LOG, process.argv.slice(2).join(" ")+"\\n");
process.exit(0);
`);

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

const bridgeLines = () => (fs.existsSync(BRIDGE_LOG) ? fs.readFileSync(BRIDGE_LOG, "utf8").trim().split("\n").filter(Boolean) : []);

async function main() {
  // Stub Speedbot: accepts the post only for room_good, refuses room_bad.
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

  const env = { SPEEDBOT_BASE: `http://127.0.0.1:${PORT}`, UNSTUCK_BRIDGE: BRIDGE_STUB, BRIDGE_LOG };

  try {
    // 1. A successful post is recorded through the bridge.
    const good = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_good", "--text", "hello from the test"], env);
    ok(good.code === 0, `successful post exits 0 (got ${good.code}) ${good.err.trim()}`);
    const lines = bridgeLines();
    ok(lines.length === 1, `exactly one bridge record on a 200 (got ${lines.length})`);
    ok(lines[0] && lines[0].startsWith("said --agent CSV Helper Research --text hello from the test"),
      `bridge record names the agent and the text (got "${lines[0]}")`);

    // 2. The key is never printed.
    ok(!/sb_testkey123/.test(good.out + good.err), "the platform key never appears in the output");

    // 3. A refused post records nothing.
    const bad = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_bad", "--text", "this must not be recorded"], env);
    ok(bad.code !== 0, `a refused post exits non-zero (got ${bad.code})`);
    ok(bridgeLines().length === 1, `a refused post adds no bridge record (still ${bridgeLines().length})`);

    // 4. Dry run does not post or record.
    const dry = await run(["--agent", "CSV Helper Research", "--key-file", KEY_FILE, "--room", "room_good", "--text", "dry", "--dry-run"], env);
    ok(dry.code === 0 && bridgeLines().length === 1, "a dry run neither posts nor records");
  } finally {
    stub.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nPASS test_room_bridge.js" : `\n${failures} FAILURE(S) in test_room_bridge.js`);
  process.exit(failures);
}

main().catch((e) => { console.error(e); process.exit(99); });
