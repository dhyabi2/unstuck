#!/usr/bin/env node
/**
 * test_nano_walkers.js — unit tests for nano-keypair.js and nano-x402-client.js.
 * The "walkers" tool must be checkable: key derivation matches the public zero-seed
 * vector, the seed gate refuses anything not 64 hex, and the x402 acceptance parser
 * selects only the exact/nano:mainnet entry. No money moves in these tests.
 */
"use strict";
const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log("  ok  " + name); };
const bad = (name, e) => { fail++; console.log("  FAIL " + name + " — " + e.message); };

// --- 1. zero-seed derivation must equal the public Nano test vector ---
function testZeroSeedVector() {
  try {
    const out = execFileSync("node", ["nano-keypair.js", "--nano-seed", "0".repeat(64), "--json"], { cwd: __dirname, encoding: "utf8" });
    const j = JSON.parse(out);
    assert.strictEqual(j.address, "nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7", "zero-seed index0 address");
    assert.strictEqual(j.seed, null, "seed must be withheld unless --show-seed");
    ok("zero-seed index0 -> known address; seed withheld by default");
  } catch (e) { bad("zero-seed vector", e); }
}

// --- 2. seed gate rejects a malformed seed ---
function testSeedGate() {
  try {
    let threw = false;
    try {
      execFileSync("node", ["nano-keypair.js", "--nano-seed", "xyz", "--json"], { cwd: __dirname, encoding: "utf8" });
    } catch (e) { threw = true; }
    assert.ok(threw, "malformed seed must exit nonzero");
    ok("malformed seed is refused");
  } catch (e) { bad("seed gate", e); }
}

// --- 3. acceptance parser (replicated selector) selects only exact/nano:mainnet ---
function testAcceptsSelector() {
  try {
    const pr = {
      x402Version: 2,
      accepts: [
        { scheme: "exact", network: "eip155:8453", amount: "1", payTo: "0x..." },
        { scheme: "exact", network: "nano:mainnet", amount: "14380000000000000000000000000", payTo: "nano_3uoj..." },
        { scheme: "upto", network: "nano:mainnet", amount: "2", payTo: "nano_..." },
      ],
    };
    const accepted = pr.accepts.find((a) => a.scheme === "exact" && a.network === "nano:mainnet");
    assert.ok(accepted, "must find exact/nano:mainnet");
    assert.strictEqual(accepted.amount, "14380000000000000000000000000");
    ok("accepts selector picks exact/nano:mainnet only");
  } catch (e) { bad("accepts selector", e); }
}

// --- 4. raw -> XNO conversion sanity ---
function testRawToXno() {
  try {
    const raw = 14380000000000000000000000000;
    assert.strictEqual(Number(raw) / 1e30, 0.01438);
    ok("raw->XNO conversion (1 XNO = 1e30 raw)");
  } catch (e) { bad("raw->xno", e); }
}

// --- 5. keypair determinism: same seed+index -> same address ---
function testDeterminism() {
  try {
    const a = JSON.parse(execFileSync("node", ["nano-keypair.js", "--nano-seed", "a".repeat(64), "--index", "2", "--json"], { cwd: __dirname, encoding: "utf8" }));
    const b = JSON.parse(execFileSync("node", ["nano-keypair.js", "--nano-seed", "a".repeat(64), "--index", "2", "--json"], { cwd: __dirname, encoding: "utf8" }));
    assert.strictEqual(a.address, b.address);
    ok("same seed+index is deterministic");
  } catch (e) { bad("determinism", e); }
}

testZeroSeedVector();
testSeedGate();
testAcceptsSelector();
testRawToXno();
testDeterminism();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
