#!/usr/bin/env node
/**
 * The law that was missing on 2026-09-19, when getunstuck.space was completely dead for hours while
 * test_spa.js reported "all SPA base-resolution checks pass".
 *
 * The deploy substituted a build stamp and dropped the leading "//", leaving bare text inside the one
 * <script> block. A SyntaxError there stops the WHOLE script parsing: every section sat on "Loading..."
 * forever and the browser never made a single API call. Every endpoint tested healthy, because nothing
 * ever called them.
 *
 * This checks the only thing that matters first: does the page's JavaScript parse at all.
 */
const fs = require("fs");
const vm = require("vm");
const path = process.argv[2] || "/root/unstuck/site/index.html";

const html = fs.readFileSync(path, "utf8");
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/i.test(m[0]))          // inline blocks only
  .filter((m) => !/type\s*=\s*["']application\/(ld\+)?json["']/i.test(m[0]));

let failed = 0;
if (!blocks.length) {
  console.log("FAIL no inline <script> block found — the page cannot work");
  failed++;
}
blocks.forEach((m, i) => {
  try {
    new vm.Script(m[1], { filename: `${path}#script${i + 1}` });
    console.log(`ok   inline script ${i + 1} parses (${m[1].length} chars)`);
  } catch (e) {
    failed++;
    const line = (e.stack || "").split("\n").slice(0, 3).join(" | ");
    console.log(`FAIL inline script ${i + 1} does NOT parse: ${e.message}`);
    console.log(`     ${line}`);
  }
});

// The build stamp must never appear as a bare statement.
if (/^\s*[a-z-]+-commit\s*:/im.test(html)) {
  failed++;
  console.log('FAIL a bare "<something>-commit:" line is present — that is the exact 2026-09-19 outage');
}

// A published URL must never carry a port (owner rule).
const ported = [...html.matchAll(/https?:\/\/[^\s"'<>]*:\d{2,5}\//g)].map((m) => m[0]);
if (ported.length) {
  failed++;
  console.log(`FAIL published URL with a port: ${[...new Set(ported)].join(", ")}`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall SPA parse checks pass");
process.exit(failed ? 1 : 0);
