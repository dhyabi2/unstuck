#!/usr/bin/env node
/**
 * opener/oracle-watcher.js — recurring oracle-integrity watcher.
 *
 * Octodamus named the gap: "you do not have an SLA because your failover is
 * reactive (agent notices, asks), not active (threshold fires automatically).
 * Real SLA needs a watcher — a service that polls your primary at fixed
 * intervals, logs latency/status, and trips a fallback trigger without waiting
 * for downstream agents to detect it."
 *
 * This is that watcher. It runs as a one-shot from cron (every N minutes),
 * checks each watched URL, compares against the last known good reading, and
 * logs any DRIFT or DOWN event to a simple alert log.
 *
 * Watched URLs come from:
 *   1. A file at ORACLE_WATCH_LIST (one URL per line, # comments ignored)
 *   2. Any URL that has been checked more than once (watched set in oracle-checks.db)
 *
 * Output: stdout (suitable for cron mail) and/or the alert log at
 *   /root/unstuck/opener/oracle-watcher-alerts.jsonl
 *
 * CLI:
 *   node opener/oracle-watcher.js                         # check all watched URLs
 *   node opener/oracle-watcher.js --watch-file ./watch.txt # check from file
 *   node opener/oracle-watcher.js --once                   # one pass, no alert log
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ALERTS_LOG = path.join(__dirname, "oracle-watcher-alerts.jsonl");
const DEFAULT_WATCH_FILE = path.join(__dirname, "oracle-watch-list.txt");
const { check } = require("./oracle-check.js");

function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}`;
  console.error(line);
}

function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const watchFile = args.includes("--watch-file")
    ? args[args.indexOf("--watch-file") + 1]
    : null;

  (async () => {
    const urls = new Set();

    // 1. From the watch file
    const wf = watchFile || DEFAULT_WATCH_FILE;
    try {
      const text = fs.readFileSync(wf, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          try { new URL(trimmed); urls.add(trimmed); } catch { /* skip invalid */ }
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      log(`no watch file at ${wf}, skipping file-based URLs`);
    }

    // 2. From oracle-checks.db: URLs checked more than once
    let dbUrls = [];
    try {
      const { sources } = require("./oracle-check.js");
      const all = sources(500);
      dbUrls = (all || []).filter((r) => r.checks > 1).map((r) => r.url);
      for (const u of dbUrls) urls.add(u);
    } catch (e) {
      log(`could not read oracle db sources: ${e.message}`);
    }

    if (urls.size === 0) {
      log("no watched URLs — nothing to check");
      process.exit(0);
    }

    log(`watcher checking ${urls.size} URL(s) (file: ${urls.size - dbUrls.length}, db: ${dbUrls.length})`);

    let driftCount = 0;
    let downCount = 0;
    let errorCount = 0;

    for (const url of Array.from(urls).sort()) {
      try {
        const card = await check(url, { timeoutMs: 10000 });
        const statusOk = card.final_status >= 200 && card.final_status < 400;
        const showDrift = card.drift === true;

        if (!statusOk) {
          downCount++;
          const alert = {
            ts: new Date().toISOString(),
            url, event: "DOWN",
            status: card.final_status,
            score: card.score,
            because: card.because,
          };
          console.log(JSON.stringify(alert));
          if (!once) fs.appendFileSync(ALERTS_LOG, JSON.stringify(alert) + "\n");
        } else if (showDrift) {
          driftCount++;
          const alert = {
            ts: new Date().toISOString(),
            url, event: "DRIFT",
            old_hash: card.previous_hash,
            new_hash: card.content_hash,
            score: card.score,
            because: card.because,
          };
          console.log(JSON.stringify(alert));
          if (!once) fs.appendFileSync(ALERTS_LOG, JSON.stringify(alert) + "\n");
        } else {
          // Healthy — only log to stderr
          log(`OK ${url} => ${card.final_status} score=${card.score} drift=${card.drift !== null ? card.drift : 'first'}`);
        }
      } catch (e) {
        errorCount++;
        const alert = { ts: new Date().toISOString(), url, event: "ERROR", error: e.message };
        console.log(JSON.stringify(alert));
        if (!once) fs.appendFileSync(ALERTS_LOG, JSON.stringify(alert) + "\n");
      }
    }

    log(`watcher complete: ${urls.size} checked, ${downCount} down, ${driftCount} drift, ${errorCount} errors`);
    process.exit(downCount > 0 || driftCount > 0 ? 1 : 0);
  })();
}

main();