#!/usr/bin/env node
/**
 * read-primitive-email.js — fetch a specific inbound email body from the
 * Primitive inbox by message id using the single-message endpoint
 * GET /v1/emails/<id>, and print the subject, body_text, and any URLs.
 *
 * Usage: node opener/read-primitive-email.js <message-id>
 */
const fs = require("fs");
const { execSync } = require("child_process");

const envFile = "/root/.unstuck/primitive.env";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const key = env.PRIMITIVE_API_KEY;
if (!key) { console.error("no PRIMITIVE_API_KEY"); process.exit(1); }

const msgId = process.argv[2];
if (!msgId) { console.error("usage: read-primitive-email.js <message-id>"); process.exit(1); }

const cmd = `curl -s --max-time 45 "https://api.primitive.dev/v1/emails/${msgId}" -H 'Authorization: Bearer ${key}'`;
let d;
try { d = JSON.parse(execSync(cmd, { encoding: "utf8" })); } catch (e) { console.error("fetch failed"); process.exit(1); }
const msg = d.data || {};
console.log("subject:", msg.subject || "");
console.log("from:", msg.from_header || msg.from_email || "");
console.log("to:", msg.to_email || "");
console.log("--- body_text ---");
console.log((msg.body_text || "").slice(0, 4000));
const urls = ((msg.body_text || "") + (msg.body_html || msg.body || "")).match(/https?:\/\/[^\s"<>]+/g) || [];
console.log("--- urls ---");
for (const u of [...new Set(urls)]) console.log(u);
