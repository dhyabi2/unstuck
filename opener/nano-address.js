"use strict";
/**
 * nano-address.js — verify a Nano (XNO) account address with NO wallet library and NO
 * subprocess, so the ask write path can reject an address that is not one.
 *
 * Why this exists (Forge #608, net work 2026-09-26): `createAsk` accepted any string
 * starting with `nano_` — including `nano_1zzz` and a shape-valid but checksum-invalid
 * address like `nano_1111111111111111111111111111111111111111111111111111111111hifc8npp`.
 * The ask board is the network's public record of what actually worked; a row attributed
 * to a string that is not an address anyone can receive on is a row no outside agent can
 * read as real activity. The old gate was shape-only, which cannot catch that case.
 *
 * The previous verifier (nano-onramp-check.js) recomputes the checksum by spawning
 * python3 for hashlib.blake2b(digest_size=5). That is right for a hermetic test but
 * wrong for a hot request path. Node's crypto exposes only blake2b-512 and refuses a
 * 5-byte output length, so the digest is done here in pure JS — the BLAKE2b spec with
 * the single change Nano uses: the digest-length parameter.
 *
 * Tested by test_nano_address.js, which includes a NEGATIVE control: a real address with
 * one checksum character changed must be rejected. A verifier that cannot fail proves
 * nothing.
 *
 * Reference: Nano's address is 260 bits (4 zero pad bits + 256 bits of public key) read
 * 5 bits at a time into the base32 alphabet `13456789abcdefghijkmnopqrstuwxyz`, followed
 * by 8 checksum symbols = base32 of the REVERSED blake2b-5 digest of the raw public key.
 */

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";

// --- BLAKE2b, 64-bit words via BigInt (Nano needs the 5-byte digest) --------------

// BLAKE2b operates on 64-bit words. A 32-bit-only implementation produces a
// valid-looking but WRONG digest (measured: it failed the published vectors and the
// rotation constants are different too). BigInt is used so the arithmetic is the spec's,
// and for a 32-byte key the cost is nothing.
const MASK64 = (1n << 64n) - 1n;

const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

// BLAKE2b sigma permutation: 10 distinct rows, rounds 10 and 11 reuse rows 0 and 1.
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

const ROT = [32n, 24n, 16n, 63n];

function rotr64(x, n) {
  return ((x >> n) | (x << (64n - n))) & MASK64;
}

function g(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & MASK64;
  v[d] = rotr64(v[d] ^ v[a], ROT[0]);
  v[c] = (v[c] + v[d]) & MASK64;
  v[b] = rotr64(v[b] ^ v[c], ROT[1]);
  v[a] = (v[a] + v[b] + y) & MASK64;
  v[d] = rotr64(v[d] ^ v[a], ROT[2]);
  v[c] = (v[c] + v[d]) & MASK64;
  v[b] = rotr64(v[b] ^ v[c], ROT[3]);
}

function readU64LE(buf, off) {
  return buf.readBigUInt64LE(off);
}

/**
 * BLAKE2b of `input`, `outBytes` long. Nano only ever needs 5; the length is a parameter
 * so the negative control can compute the full 64-byte digest the published vectors give.
 */
function blake2b(input, outBytes) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const outLen = outBytes;

  const h = IV.slice();
  // Parameter block: digest length, key length 0, fanout 1, depth 1.
  h[0] = h[0] ^ (0x01010000n | BigInt(outLen));

  let t = 0n; // 128-bit counter, only the low 64 bits are ever used for our inputs
  const total = buf.length;
  const nBlocks = Math.max(1, Math.ceil(total / 128));

  for (let bi = 0; bi < nBlocks; bi++) {
    const start = bi * 128;
    const end = Math.min(start + 128, total);
    const chunk = buf.subarray(start, end);
    const last = bi === nBlocks - 1;

    t += BigInt(chunk.length);

    const block = Buffer.alloc(128);
    chunk.copy(block, 0);
    const m = [];
    for (let i = 0; i < 16; i++) m.push(readU64LE(block, i * 8));

    const v = new Array(16);
    for (let i = 0; i < 8; i++) v[i] = h[i];
    for (let i = 0; i < 8; i++) v[8 + i] = IV[i];
    v[12] = v[12] ^ (t & MASK64);
    if (last) v[14] = ~v[14] & MASK64;

    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      g(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
      g(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
      g(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
      g(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
      g(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
      g(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
      g(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
      g(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
    }

    for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) & MASK64;
  }

  const full = Buffer.alloc(64);
  for (let i = 0; i < 8; i++) full.writeBigUInt64LE(h[i], i * 8);
  return full.subarray(0, outLen);
}

// --- Base32 (Nano's alphabet) -----------------------------------------------------

function base32Encode(bytes) {
  // Nano pads the bit stream to a multiple of 5 with LEADING zero bits.
  const bits = [];
  for (const byte of bytes) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  while (bits.length % 5 !== 0) bits.unshift(0);
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    let v = 0;
    for (let j = 0; j < 5; j++) v = (v << 1) | bits[i + j];
    out += ALPHABET[v];
  }
  return out;
}

function base32Decode(str) {
  // Nano's key is 52 base32 symbols = 260 bits, of which the first 4 are zero pad bits;
  // the remaining 256 bits are the public key. Dropping the 4 pad bits is what makes the
  // decode a 32-byte key — decoding all 260 bits gives a 33-byte buffer with a leading
  // zero byte, which is what produced a wrong checksum before this fix.
  const bits = [];
  for (const ch of str) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`bad base32 character ${ch}`);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  if (bits.length < 4) throw new Error("too short to carry a key");
  for (let i = 0; i < 4; i++) if (bits[i] !== 0) throw new Error("pad bits are not zero");
  const body = bits.slice(4);
  if (body.length % 8 !== 0) throw new Error(`key bits must be a whole number of bytes, got ${body.length}`);
  const bytes = Buffer.alloc(body.length / 8);
  for (let i = 0; i < body.length; i++) {
    if (body[i]) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return bytes;
}

// --- The address check -------------------------------------------------------------

/** The 8 checksum symbols for a raw 32-byte public key. */
function checksumOf(publicKey) {
  const digest = blake2b(publicKey, 5);
  return base32Encode(Buffer.from(digest).reverse());
}

/**
 * True only when `address` is a well-formed Nano account whose checksum matches the key
 * it encodes. This is the whole gate: shape AND checksum, no subprocess, no wallet lib.
 */
function isValidNanoAddress(address) {
  return verifyNanoAddress(address).ok;
}

function verifyNanoAddress(address) {
  if (typeof address !== "string") return { ok: false, reason: "not a string" };
  const raw = address.replace(/^(nano_|xrb_)/, "");
  if (!address.startsWith("nano_") && !address.startsWith("xrb_")) {
    return { ok: false, reason: "missing nano_ prefix" };
  }
  if (raw.length !== 60) return { ok: false, reason: `body must be 60 chars, got ${raw.length}` };
  let pub;
  try {
    pub = base32Decode(raw.slice(0, 52));
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  if (pub.length !== 32) return { ok: false, reason: `key must decode to 32 bytes, got ${pub.length}` };
  const expected = checksumOf(pub);
  const got = raw.slice(52);
  return { ok: expected === got, expected, got, publicKey: pub.toString("hex") };
}

module.exports = { blake2b, checksumOf, isValidNanoAddress, verifyNanoAddress };