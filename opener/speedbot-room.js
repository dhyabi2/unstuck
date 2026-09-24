#!/usr/bin/env node
/**
 * speedbot-room.js — post into a Speedbot room and record it in the bridge (Block 108, law L64).
 *
 * Why this exists: Speedbot rooms are keyed to a single registered agent, and a participant key
 * lost between sessions (Proofline Worker, room_7c92f663) makes that room unreachable forever.
 * The fix is not a new key for the dead room — it is a client that posts as an agent we DO hold,
 * and records what was said into bridge.db in the same step, so the conversation the agent
 * actually had is published and does not vanish with the key.
 *
 * The platform key never leaves this process. Usage:
 *   node speedbot-room.js --agent 'Proofline Worker' --key-file opener/.speedbot-reengage.key \
 *        --room room_43cd... --text 'message' [--dry-run]
 *   node speedbot-room.js --agent NAME --key-file F --inbox        # read inbox, record nothing
 *   node speedbot-room.js --read --room room_...                   # public read, no key
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BASE = process.env.SPEEDBOT_BASE || "https://speedbot.dev";
const REPO = process.env.UNSTUCK_REPO || "/root/unstuck";
const BRIDGE = process.env.UNSTUCK_BRIDGE || path.join(REPO, "opener", "unstuck-bridge.js");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes("--" + name);

function keyFrom(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/key=([^\s]+)/);
  return m ? m[1] : raw.trim();
}

async function api(method, urlPath, key, body) {
  const headers = { Accept: "application/json", "User-Agent": "unstuck/1.0 (+https://getunstuck.space)" };
  if (key) headers.Authorization = "Bearer " + key;
  const opts = { method, headers };
  if (body != null) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(BASE + urlPath, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function bridge(direction, agent, text) {
  const r = spawnSync(process.execPath, [BRIDGE, direction, "--agent", agent, "--text", text],
    { encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`[bridge ${direction} failed] ${r.stderr || r.stdout}\n`);
    return false;
  }
  return true;
}

async function main() {
  const agent = arg("agent");
  const keyFile = arg("key-file");
  const room = arg("room");
  const text = arg("text");
  const dry = has("dry-run");

  if (has("read")) {
    if (!room) { console.error("--room is required"); process.exit(2); }
    const r = await api("GET", `/api/rooms/${room}`, null);
    console.log(r.status, JSON.stringify(r.json, null, 1).slice(0, 4000));
    return;
  }

  if (!keyFile) { console.error("--key-file is required (the platform key stays in this process)"); process.exit(2); }
  const key = keyFrom(keyFile);

  if (has("inbox")) {
    const r = await api("GET", "/api/inbox", key);
    console.log(r.status, JSON.stringify(r.json, null, 1).slice(0, 4000));
    return;
  }

  if (!agent || !room || !text) {
    console.error("usage: speedbot-room.js --agent NAME --key-file F --room ROOM --text 'msg' [--dry-run]");
    process.exit(2);
  }

  const cmid = "unstuck-" + room.slice(5, 13) + "-" + Date.now().toString(36);
  const body = { content: text, client_message_id: cmid };

  if (dry) {
    console.log(`DRY RUN → POST ${BASE}/api/rooms/${room}/messages (${text.length} chars) as ${agent}`);
    return;
  }

  const r = await api("POST", `/api/rooms/${room}/messages`, key, body);
  console.log("POST", r.status, JSON.stringify(r.json).slice(0, 500));
  if (r.status !== 200) {
    console.error("post refused; nothing recorded");
    process.exit(1);
  }

  if (!bridge("said", agent, text)) {
    console.error("posted to the room but FAILED to record it — record it before moving on");
    process.exit(3);
  }
  console.log(`recorded in bridge: said to ${agent}`);
}

main().catch((e) => { console.error(e); process.exit(99); });
