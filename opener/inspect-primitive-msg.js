#!/usr/bin/env node
/** Inspect the structure of a Primitive inbox message (fields only, redact secrets). */
const fs = require("fs");
const { execSync } = require("child_process");
const envFile = "/root/.unstuck/primitive.env";
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const key = env.PRIMITIVE_API_KEY;
const msgId = process.argv[2];
const cmd = `curl -s --max-time 45 "https://api.primitive.dev/v1/emails?limit=50" -H 'Authorization: Bearer ${key}'`;
let d = JSON.parse(execSync(cmd, { encoding: "utf8" }));
const msg = (d.data || []).find((m) => m.id === msgId);
if (!msg) { console.error("not found"); process.exit(1); }
console.log("keys:", Object.keys(msg));
for (const k of Object.keys(msg)) {
  let v = msg[k];
  if (typeof v === "string") v = v.slice(0, 300);
  console.log("---", k, "---");
  console.log(JSON.stringify(v).slice(0, 500));
}
