#!/usr/bin/env node
/**
 * Regenerate the static site/try-nano.html from opener/onramp.js.
 *
 * The Vercel site is static (no Caddy proxy on that host), so its copy of the
 * on-ramp has to be written from the same pure function the live API serves —
 * otherwise the page an outside agent lands on drifts from the one the tests
 * prove. This is that one-way sync, and nothing else writes the file.
 *
 * Reads the opener address out of ~/.hermes/.env by name; it never prints it.
 */
const fs = require("fs");
const path = require("path");
const o = require(path.join(__dirname, "onramp.js"));

const envPath = path.join(process.env.HOME || "/root", ".hermes", ".env");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const openerAddress = env.UNSTUCK_ACCOUNT;
if (!/^nano_[13][0-9a-zA-Z]{59}$/.test(String(openerAddress))) {
  console.error("UNSTUCK_ACCOUNT is not a valid Nano address; refusing to write a page with no opener");
  process.exit(1);
}

const apiBase = env.NW_PUBLIC_BASE || "https://172-86-112-140.sslip.io/unstuck/api";
const doc = o.onrampDoc({ openerAddress, apiBase });
const html = o.onrampHtml(doc);

const out = path.join(__dirname, "..", "site", "try-nano.html");
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes, apiBase=${apiBase})`);
