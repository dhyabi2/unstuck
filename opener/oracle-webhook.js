#!/usr/bin/env node
/**
 * opener/oracle-webhook.js — the active half of the oracle-integrity watcher.
 *
 * The watcher (oracle-watcher.js) logs DOWN / DRIFT / ERROR events to a flat
 * JSONL file on a schedule. That file is passive: nothing consumes it, so a
 * dead or re-pointed oracle endpoint can keep poisoning a data pipeline until
 * an agent happens to notice. Octodamus named the exact gap: "Real SLA needs a
 * watcher ... that trips a fallback trigger *without waiting* for downstream
 * agents to detect it."
 *
 * This file is that trip: a notifier that turns the alert stream into an active
 * POST. It scans new lines in the alert log, tracks a consecutive-DOWN count
 * per URL, and when that count crosses a configurable threshold it fires a
 * webhook POST to every registered callback URL for that endpoint. It also
 * fires a RECOVERY webhook the first time a URL that was DOWN reads healthy
 * again. Each fired alert carries the URL, the score, the reason lines, and the
 * consecutive-down count, so the receiving pipeline can act without re-deriving
 * anything.
 *
 * It is idempotent by construction: state (the scan offset and per-URL
 * consecutive-down counts) is persisted to oracle-webhook-state.json, so a
 * re-run never re-fires an alert it already fired.
 *
 * Configuration lives in oracle-webhooks.json:
 *   {
 *     "threshold_consecutive_down": 3,
 *     "urls": [
 *       { "url": "https://example.com",
 *         "webhook": "https://…/receiver", "enabled": true }
 *     ]
 *   }
 * A URL with no entry, or an entry with enabled=false, is never fired.
 *
 * CLI:
 *   node opener/oracle-webhook.js --scan            # process new alert lines and fire webhooks
 *   node opener/oracle-webhook.js --scan --dry      # compute + log what WOULD fire, POST nothing
 *
 * Exports for tests: the module exposes an async fireIfNeeded(alerts, state)
 * that takes an array of decoded alert events plus a mutable state object and
 * returns the alerts it fired, so a test can drive it with a real local HTTP
 * server and a synthetic alert list.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");

const ALERTS_LOG = path.join(__dirname, "oracle-watcher-alerts.jsonl");
const CONFIG_FILE = path.join(__dirname, "oracle-webhooks.json");
const STATE_FILE = path.join(__dirname, "oracle-webhook-state.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { threshold_consecutive_down: 3, urls: [] };
    throw e;
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { offset: 0, per_url: {} };
    throw e;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Choose the webhook URL for a given watched URL from the config. null if none/unenabled. */
function webhookFor(config, url) {
  if (!config || !Array.isArray(config.urls)) return null;
  const entry = config.urls.find((u) => u && u.url === url && u.enabled !== false);
  return entry ? entry.webhook : null;
}

/** POST a JSON body to a target URL using Node's http/https, return an outcome. */
function post(url, body) {
  return new Promise((resolve) => {
    let lib = url.startsWith("https:") ? require("https") : http;
    const parsed = new URL(url);
    const payload = Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
    const req = lib.request(
      parsed,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": payload.length,
          "user-agent": "unstuck-oracle-webhook/1",
        },
        timeout: 10000,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode })
        );
      }
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: "timeout" });
    });
    req.end(payload);
  });
}

/**
 * Given a sorted array of new alert events (each {event, url, ts, ...}) and a
 * mutable state object, update consecutive-down counts and fire webhooks for:
 *   - DOWN crossing the threshold (one fire per crossing)
 *   - RECOVERY (a URL that was at/over threshold now healthy — always fired once)
 * Returns the list of fired payloads so tests can assert on it.
 */
async function fireIfNeeded(alerts, state, config, opts) {
  const fired = [];
  const dry = opts && opts.dry;
  const threshold = (config && config.threshold_consecutive_down) || 3;
  const per = state.per_url || (state.per_url = {});

  for (const a of alerts) {
    if (!a || !a.url || !a.event) continue;
    const key = a.url;
    const rec = per[key] || (per[key] = { down: 0, fired_down: false, fired_recovery: false });
    const webhook = webhookFor(config, key);
    if (!webhook) continue;

    if (a.event === "DOWN") {
      rec.down += 1;
      rec.fired_recovery = false;
      if (rec.down >= threshold && !rec.fired_down) {
        rec.fired_down = true;
        const payload = {
          event: "DOWN_THRESHOLD",
          url: key,
          score: a.score != null ? a.score : null,
          consecutive_down: rec.down,
          threshold,
          status: a.status != null ? a.status : null,
          because: a.because || [],
          ts: a.ts || new Date().toISOString(),
        };
        if (dry) {
          console.error(`[dry] would fire DOWN_THRESHOLD ${key} -> ${webhook}`);
        } else {
          await post(webhook, payload);
        }
        fired.push(payload);
      }
    } else if (a.event === "OK" || a.event === "RECOVER") {
      if (rec.down >= threshold) {
        // A URL that was tripped is healthy again.
        rec.fired_recovery = true;
        const payload = {
          event: "RECOVERY",
          url: key,
          score: a.score != null ? a.score : null,
          consecutive_down: rec.down,
          threshold,
          status: a.status != null ? a.status : null,
          ts: a.ts || new Date().toISOString(),
        };
        if (dry) {
          console.error(`[dry] would fire RECOVERY ${key} -> ${webhook}`);
        } else {
          await post(webhook, payload);
        }
        fired.push(payload);
      }
      rec.down = 0;
      rec.fired_down = false;
    }
  }
  return fired;
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  if (!args.includes("--scan")) {
    console.error("usage: node opener/oracle-webhook.js --scan [--dry]");
    process.exit(2);
  }

  const config = loadConfig();
  const state = loadState();
  const threshold = config.threshold_consecutive_down || 3;

  // Read only the new lines after the stored offset.
  let text = "";
  try {
    text = fs.readFileSync(ALERTS_LOG, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const lines = text.split("\n").filter((l) => l.trim());
  const newLines = lines.slice(state.offset || 0);

  const alerts = [];
  for (const line of newLines) {
    try {
      alerts.push(JSON.parse(line));
    } catch (e) {
      /* skip malformed */
    }
  }

  fireIfNeeded(alerts, state, config, { dry }).then((fired) => {
    state.offset = lines.length;
    saveState(state);
    console.log(JSON.stringify({ scanned: alerts.length, fired: fired.length }));
    process.exit(0);
  });
}

module.exports = { fireIfNeeded, loadConfig, loadState, saveState };

if (require.main === module) {
  main();
}
