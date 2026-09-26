"use strict";
/**
 * test_nano-address.js — laws for the pure-JS Nano address verifier.
 *
 * The verifier exists so `createAsk` can reject an address that is not one (Forge #608).
 * A verifier that cannot fail proves nothing, so every law here has a negative control:
 * a REAL address with exactly one checksum character changed must be rejected.
 *
 * Grounding: the positive vectors are addresses that exist on the live Nano ledger,
 * checked against the node's own answer, not against our own encoder.
 */
const assert = require("assert");
const { isValidNanoAddress, verifyNanoAddress, checksumOf, blake2b } = require("./nano-address");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`ok   ${name}\n`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    process.stdout.write(`FAIL ${name}: ${e.message}\n`);
  }
}

// --- Known-good: our own treasury and the Vend pay-to address, read off the ledger ----
const TREASURY = "nano_1idw7h9fiokbbacc1pu8zt1gmn1ns1j3f99t4km4gw4qbejbpsest1mbe9ru";
const VEND_PAYTO = "nano_1yo6c1t64ahfjdw1dxizmbbnpdmbrckwhw9phbg5pdkeubrizga4qhnjmnx7";

check("L90 a real ledger address validates (treasury)", () => {
  assert.ok(isValidNanoAddress(TREASURY), "treasury address must validate");
});

check("L90 a second real ledger address validates (Vend pay-to)", () => {
  assert.ok(isValidNanoAddress(VEND_PAYTO), "Vend pay-to address must validate");
});

check("L90 NEGATIVE CONTROL: one checksum char changed is rejected", () => {
  // Change the final checksum character to a different valid base32 symbol.
  const last = TREASURY.slice(-1);
  const other = last === "1" ? "3" : "1";
  const tampered = TREASURY.slice(0, -1) + other;
  const v = verifyNanoAddress(tampered);
  assert.strictEqual(v.ok, false, "a tampered checksum must NOT validate");
  assert.notStrictEqual(tampered, TREASURY, "the tampered string must differ");
});

check("L90 NEGATIVE CONTROL: a shape-valid but checksum-invalid address is rejected", () => {
  // 65 valid base32 chars, 32-byte key, but the checksum does not match. This is exactly
  // the case a shape-only gate (the old createAsk) let through.
  const fake = "nano_111111111111111111111111111111111111111111111111111111111111";
  assert.strictEqual(fake.length, 65, "the control must be shape-valid");
  assert.strictEqual(isValidNanoAddress(fake), false, "must reject checksum-invalid address");
});

check("L90 NEGATIVE CONTROL: the old shape-only failure `nano_1zzz` is rejected", () => {
  assert.strictEqual(isValidNanoAddress("nano_1zzz"), false, "must reject a short body");
});

check("L90 a non-nano string and a non-string are rejected, never thrown", () => {
  assert.strictEqual(isValidNanoAddress("nano_"), false);
  assert.strictEqual(isValidNanoAddress("https://example.com"), false);
  assert.strictEqual(isValidNanoAddress(null), false);
  assert.strictEqual(isValidNanoAddress(undefined), false);
  assert.strictEqual(isValidNanoAddress(12345), false);
});

// --- The digest itself, grounded on the public BLAKE2b test vectors -----------------

check("L90 blake2b matches the published BLAKE2b-512 empty-input vector", () => {
  // BLAKE2b-512("") = 786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419
  //                   d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce
  const got = blake2b(Buffer.from(""), 64).toString("hex");
  const expected =
    "786a02f742015903c6c6fd852552d272912f4740e15847618a86e217f71f5419" +
    "d25e1031afee585313896444934eb04b903a685b1448b755d56f701afe9be2ce";
  assert.strictEqual(got, expected);
});

check("L90 blake2b matches the published BLAKE2b-512 'abc' vector", () => {
  // BLAKE2b-512("abc") = ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1
  //                      7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923
  const got = blake2b(Buffer.from("abc"), 64).toString("hex");
  const expected =
    "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1" +
    "7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923";
  assert.strictEqual(got, expected);
});

check("L90 the checksum of the treasury key reproduces the address's own checksum", () => {
  const v = verifyNanoAddress(TREASURY);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.expected, v.got);
  const recomputed = checksumOf(Buffer.from(v.publicKey, "hex"));
  assert.strictEqual(TREASURY.slice(-8), recomputed);
});

check("L90 NEGATIVE CONTROL: the live network rejects a checksum-invalid asker", () => {
  // The network's own createAsk must refuse it — proven in test_network_guard.js; here we
  // prove the primitive that guard leans on is itself capable of saying no.
  const shapeValidChecksumBad = "nano_111111111111111111111111111111111111111111111111111111111111";
  assert.strictEqual(shapeValidChecksumBad.length, 65, "the control must be shape-valid");
  assert.strictEqual(isValidNanoAddress(shapeValidChecksumBad), false, "checksum gate must reject it");
});

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write(failures.join("\n") + "\n");
  process.exit(1);
}