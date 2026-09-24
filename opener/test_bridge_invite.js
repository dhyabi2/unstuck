#!/usr/bin/env node
/**
 * test_bridge_invite.js — verify bridge-invite.js reaches services.
 *
 * Block 31 law L25: "the bridge invite script sends a personal x402 proxied
 * request to each USDC service, records the response, and logs it as a
 * distribution touch."
 */

const { main, probeViaBridge, probeDirect, loadInvited, wasInvited } = require("./bridge-invite.js");
const fs = require("fs");

let passed = 0;
let failed = 0;

function ok(name) { console.log(`ok   ${name}`); passed++; }
function fail(name, msg) { console.log(`not ok ${name}: ${msg}`); failed++; }

async function run() {
  // Test 1: loadInvited returns array
  const invited = loadInvited();
  if (Array.isArray(invited)) ok("01 loadInvited returns array");
  else fail("01 loadInvited returns array", `got ${typeof invited}`);

  // Test 2: wasInvited works on empty list
  if (!wasInvited([], "http://example.com")) ok("02 wasInvited empty returns false");
  else fail("02 wasInvited empty returns false", "returned true");

  // Test 3: wasInvited detects existing
  const sample = [{ base_url: "http://example.com" }];
  if (wasInvited(sample, "http://example.com")) ok("03 wasInvited detects existing");
  else fail("03 wasInvited detects existing", "returned false");

  // Test 4: probeDirect handles unreachable service
  const unreachable = await probeDirect({ url: "http://0.0.0.0:1" });
  if (unreachable.well_known_status === 0) ok("04 probeDirect handles unreachable");
  else fail("04 probeDirect handles unreachable", `status=${unreachable.well_known_status}`);

  // Test 5: probeViaBridge — bridge is live, test with any reachable URL
  const bridgeTest = await probeViaBridge("http://example.com");
  if (bridgeTest.bridge_reachable) ok("05 probeViaBridge bridge reachable");
  else fail("05 probeViaBridge bridge reachable", bridgeTest.bridge_error || "unreachable");

  // Test 6: probeViaBridge returns status codes
  if (typeof bridgeTest.bridge_status === "number") ok("06 bridge_status is number");
  else fail("06 bridge_status is number", `got ${typeof bridgeTest.bridge_status}`);

  // Test 7: Cached candidates file exists
  const candidatesPath = require("path").join(__dirname, "sources", "x402-candidates-614.json");
  if (fs.existsSync(candidatesPath)) ok("07 candidates file exists");
  else fail("07 candidates file exists", "not found at " + candidatesPath);

  // Test 8: Dry run works
  const origArgs = process.argv;
  // Can't easily test main() dry-run here, but we verify the module exports
  if (typeof main === "function") ok("08 main is exported");
  else fail("08 main is exported", "not a function");

  // Test 9: probeViaBridge on a well-known reachable target that returns 402
  // Use one of the known x402 services: feeless402.com
  const feeless = await probeViaBridge("https://feeless402.com");
  if (feeless.bridge_reachable) ok("09 probeViaBridge feeless402 reachable");
  else fail("09 probeViaBridge feeless402 reachable", feeless.bridge_error || "unreachable");

  const summary = passed + "/" + (passed + failed) + " tests passed";
  console.log("\n" + summary);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test runner error:", e.message);
  process.exit(1);
});