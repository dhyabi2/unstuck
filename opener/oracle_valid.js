#!/usr/bin/env node
// Oracle for L0 (block 4): find-agents.js must extract ONLY valid Nano addresses.
// This exercises the PRODUCTION discovery code (find-agents.js) so a mutant that
// drops the checkAddress filter / corrupts the regex is caught.
const { execSync } = require("child_process");
const nano = require("nanocurrency");

let out;
try {
  out = execSync("node find-agents.js 2>/dev/null", { encoding: "utf8", timeout: 120000 });
} catch (e) {
  console.error("find-agents.js failed:", e.message);
  process.exit(1);
}
let arr;
try { arr = JSON.parse(out); } catch (e) { console.error("not valid JSON:", e.message); process.exit(1); }
if (!Array.isArray(arr)) { console.error("expected JSON array"); process.exit(1); }

// Every emitted address MUST be a valid Nano address. A mutant that removes the
// checkAddress filter (or corrupts the nano_ regex) will emit an invalid address.
let bad = 0;
for (const e of arr) {
  if (!e.address || !nano.checkAddress(e.address)) {
    console.error("INVALID ADDRESS EMITTED:", e.address);
    bad++;
  }
}
if (bad > 0) process.exit(1);

// A mutant that stubs the network to return zero addresses is ALSO a failure
// (vacuously "valid" but not discovery). Require at least one address.
if (arr.length === 0) { console.error("no addresses discovered"); process.exit(1); }

console.log(`OK: find-agents.js emitted ${arr.length} valid addresses, all pass checkAddress`);
process.exit(0);
