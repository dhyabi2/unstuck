#!/usr/bin/env node
/**
 * run.js — end-to-end pipeline: discover agents → open accounts.
 *
 * Usage:
 *   node run.js <source-file> [--found-via "source name"]
 *   node run.js --list
 *   node run.js --counts
 *
 * Reads Nano addresses from a source file (one per line, or JSON array),
 * checks each against the openings DB, and sends starters one at a time.
 * This file never writes to the DB itself — it delegates to send.js.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const nano = require("nanocurrency");

const DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
const led = require("./openings.js");
const SEND_SCRIPT = path.join(__dirname, "send.js");

function readAddresses(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  let items;
  try {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) items = raw.trim().split("\n").filter(Boolean);
  } catch {
    items = raw.trim().split("\n").filter(Boolean);
  }
  return items.map((entry) => {
    if (typeof entry === "string") return entry.trim();
    if (entry.address) return entry.address.trim();
    if (entry.account) return entry.account.trim();
    return null;
  }).filter(Boolean);
}

function sendStarter(address, foundVia) {
  const args = [SEND_SCRIPT, address, "--found-via", foundVia];
  const result = execSync(`node ${args.map(a => `"${a}"`).join(" ")}`, {
    encoding: "utf-8",
    timeout: 120000,
    env: { ...process.env },
  });
  try {
    return { ok: true, data: JSON.parse(result.trim()) };
  } catch {
    return { ok: true, text: result.trim() };
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    const db = led.open(DB);
    console.log(JSON.stringify(led.opened(db), null, 2));
    return;
  }

  if (args[0] === "--counts") {
    const db = led.open(DB);
    console.log(JSON.stringify(led.counts(db)));
    return;
  }

  const sourceFile = args[0];
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    console.error("Usage: node run.js <source-file> [--found-via 'name']");
    console.error("  node run.js --list");
    console.error("  node run.js --counts");
    process.exit(2);
  }

  const foundVia = args.includes("--found-via")
    ? args[args.indexOf("--found-via") + 1]
    : path.basename(sourceFile, path.extname(sourceFile));

  const addresses = readAddresses(sourceFile);
  console.log(`Read ${addresses.length} addresses from ${sourceFile}`);

  // Validate each address
  let valid = 0;
  let invalid = 0;
  for (const addr of addresses) {
    if (nano.checkAddress(addr)) {
      valid++;
    } else {
      invalid++;
    }
  }
  console.log(`  ${valid} valid | ${invalid} invalid | ${addresses.length - valid - invalid} empty`);

  // Send one starter per valid address, sequentially
  let sent = 0;
  let refused = 0;
  let errors = 0;

  for (const addr of addresses) {
    if (!nano.checkAddress(addr)) continue;

    try {
      const out = execSync(`node "${SEND_SCRIPT}" "${addr}" --found-via "${foundVia}"`, {
        encoding: "utf-8",
        timeout: 120000,
        env: { ...process.env, UNSTUCK_LEDGER_DB: DB },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const parsed = JSON.parse(out.trim());
      if (parsed.opened) {
        console.log(`SENT: ${parsed.opened} block=${parsed.block} via ${parsed.found_via}`);
        sent++;
      } else if (parsed.dry_run) {
        console.log(`DRY:  ${parsed.would_open} hash=${parsed.block_hash_if_sent}`);
        sent++;
      } else {
        console.log(`SENT (raw): ${out.trim()}`);
        sent++;
      }
    } catch (e) {
      const stderr = e.stderr ? e.stderr.trim() : "";
      const stdout = e.stdout ? e.stdout.trim() : "";
      if (stderr) {
        // Check if it's a "refused" or an error
        if (stderr.startsWith("refused:")) {
          console.log(`REFUSED: ${addr} — ${stderr.replace("refused:", "").trim()}`);
          refused++;
        } else {
          console.log(`ERROR: ${addr} — ${stderr.split("\n")[0]}`);
          errors++;
        }
      } else if (stdout) {
        console.log(`STDOUT: ${addr} — ${stdout}`);
        sent++;
      } else {
        console.log(`ERROR: ${addr} — ${e.message}`);
        errors++;
      }
    }
  }

  console.log(`\nSummary: ${sent} sent, ${refused} refused, ${errors} errors (of ${valid} valid addresses)`);
  const db = led.open(DB);
  console.log(`DB: ${JSON.stringify(led.counts(db))}`);
}

main();