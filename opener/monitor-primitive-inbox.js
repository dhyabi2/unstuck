#!/usr/bin/env node
/**
 * monitor-primitive-inbox.js — polls the Unstuck agent's Primitive inbox for
 * inbound replies (especially from conversion targets we emailed) and appends a
 * plain-text line per NEW message to the monitor log, so a reply is not missed.
 *
 * Credential: /root/.unstuck/primitive.env (never in git, never printed).
 * Cursor:   /root/.unstuck/primitive-inbox.cursor (last seen inbound epoch ms).
 * Log:      /root/.unstuck/primitive-inbox.log
 *
 * Run: node opener/monitor-primitive-inbox.js   (from repo root or anywhere)
 */
const fs = require("fs");
const { execSync } = require("child_process");

const envFile = "/root/.unstuck/primitive.env";
if (!fs.existsSync(envFile)) { console.error("no primitive.env"); process.exit(0); }
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const key = env.PRIMITIVE_API_KEY;
const CURSOR = "/root/.unstuck/primitive-inbox.cursor";
const LOG = "/root/.unstuck/primitive-inbox.log";
const cursor = fs.existsSync(CURSOR) ? parseInt(fs.readFileSync(CURSOR, "utf8").trim(), 10) : 0;

let body;
try {
  body = execSync(
    `curl -s --max-time 45 "https://api.primitive.dev/v1/emails?limit=20" -H 'Authorization: Bearer ${key}'`,
    { encoding: "utf8" }
  );
} catch (e) { console.error("poll failed"); process.exit(0); }
let d; try { d = JSON.parse(body); } catch { d = { success: false }; }
if (!d.success || !Array.isArray(d.data)) { console.error("poll failed: " + body.slice(0,160)); process.exit(0); }

let newestMs = cursor;
for (const m of d.data) {
  const created = Date.parse(m.created_at || m.timestamp || "");
  if (isNaN(created)) continue;
  if (created <= cursor) continue;   // already seen
  if (created > newestMs) newestMs = created;
  const from = m.from || m.envelope?.from || (m.sender && m.sender.address) || "?";
  const subj = m.subject || m.subjectText || (m.envelope && m.envelope.subject) || "(no subject)";
  const line = `[${new Date(created).toISOString()}] INBOUND id=${m.id} from=${from} subject=${subj}`;
  fs.appendFileSync(LOG, line + "\n");
  console.log(line);
}
fs.writeFileSync(CURSOR, String(newestMs));
console.log(`[monitor] scanned ${d.data.length} inbound; cursor now ${newestMs}`);
