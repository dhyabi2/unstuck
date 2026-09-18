#!/usr/bin/env node
/**
 * unstuck-bridge.js — thin shim onto the one bridge implementation.
 *
 * This file used to be a second, independent CLI: it wrote bridge.db directly and
 * never emitted a nano-pulse journal event, so conversations recorded through it
 * reached the database and never reached the live map. It also carried a `waiting`
 * default of 2 hours where the library uses STALE_AFTER_S, so the two CLIs gave
 * different answers from the same rows (measured 2026-09-18: node 1 waiting,
 * python 2; node live/network/asks-target absent entirely).
 *
 * There is now one implementation — /opt/nano-pulse/bridge.py, on PATH as
 * `unstuck-bridge` — which writes the row, scrubs the text, emits to the journal
 * and flushes before exit. Every flag is spelled the same, so calls through this
 * file keep working unchanged, and `review`, `network` and `asks-target` now work
 * through this name too.
 *
 * Do not reimplement bridge commands here. Add them to bridge.py.
 */
const { spawnSync } = require("child_process");

const r = spawnSync("unstuck-bridge", process.argv.slice(2), { stdio: "inherit" });
if (r.error) {
  console.error(`unstuck-bridge not reachable: ${r.error.message}`);
  process.exit(127);
}
process.exit(r.status === null ? 1 : r.status);
