/**
 * nano-sig.js - verify (and, for clients, make) a signature by a Nano account, with no npm
 * dependency. A Nano address IS an ed25519 public key (with blake2b in place of sha512 inside
 * ed25519), so "the asker signed this" can be checked from the address alone: no token to leak,
 * no account to sign up for.
 *
 * Contents: blake2b (any digest size), the Nano address codec WITH its checksum, ed25519
 * verify/sign (hash injectable so the core is proven against node's own RFC 8032 ed25519).
 *
 * The signature domain for the ask network lives in network.js (acceptMessage).
 */
"use strict";
const crypto = require("crypto");

// ---------------------------------------------------------------- blake2b
const M64 = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
  [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4], [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
  [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13], [2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11], [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
  [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5], [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
];
const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & M64;

function blake2b(data, outlen = 64) {
  const input = Buffer.from(data);
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outlen); // no key, fanout 1, depth 1
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  let t = 0n;
  for (let b = 0; b < blocks; b++) {
    const last = b === blocks - 1;
    const chunk = Buffer.alloc(128);
    input.copy(chunk, 0, b * 128, Math.min(input.length, b * 128 + 128));
    t = last ? BigInt(input.length) : t + 128n;
    const m = [];
    for (let i = 0; i < 16; i++) m.push(chunk.readBigUInt64LE(i * 8));
    const v = h.concat(IV);
    v[12] ^= t & M64;
    v[13] ^= t >> 64n;
    if (last) v[14] ^= M64;
    const G = (a, bb, c, d, x, y) => {
      v[a] = (v[a] + v[bb] + x) & M64; v[d] = rotr(v[d] ^ v[a], 32n);
      v[c] = (v[c] + v[d]) & M64;      v[bb] = rotr(v[bb] ^ v[c], 24n);
      v[a] = (v[a] + v[bb] + y) & M64; v[d] = rotr(v[d] ^ v[a], 16n);
      v[c] = (v[c] + v[d]) & M64;      v[bb] = rotr(v[bb] ^ v[c], 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      G(0,4,8,12,m[s[0]],m[s[1]]); G(1,5,9,13,m[s[2]],m[s[3]]);
      G(2,6,10,14,m[s[4]],m[s[5]]); G(3,7,11,15,m[s[6]],m[s[7]]);
      G(0,5,10,15,m[s[8]],m[s[9]]); G(1,6,11,12,m[s[10]],m[s[11]]);
      G(2,7,8,13,m[s[12]],m[s[13]]); G(3,4,9,14,m[s[14]],m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const out = Buffer.alloc(64);
  for (let i = 0; i < 8; i++) out.writeBigUInt64LE(h[i], i * 8);
  return out.subarray(0, outlen);
}

// ---------------------------------------------------------------- Nano address
const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";

function pubToAddress(pub) {
  const bits = [0, 0, 0, 0];
  for (const b of pub) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  const enc = (arr) => {
    let s = "";
    for (let i = 0; i < arr.length; i += 5) {
      let v = 0;
      for (let j = 0; j < 5; j++) v = (v << 1) | arr[i + j];
      s += ALPHABET[v];
    }
    return s;
  };
  const sum = Buffer.from(blake2b(pub, 5)).reverse();
  const sb = [];
  for (const b of sum) for (let i = 7; i >= 0; i--) sb.push((b >> i) & 1);
  return "nano_" + enc(bits) + enc(sb);
}

/** Public key (Buffer of 32) of a nano_ address, or null if the shape OR the checksum is wrong. */
function addressToPub(address) {
  if (typeof address !== "string" || !/^(nano|xrb)_[13-9a-km-uw-z]{60}$/.test(address)) return null;
  const raw = address.slice(address.indexOf("_") + 1);
  const bits = [];
  for (const ch of raw.slice(0, 52)) {
    const v = ALPHABET.indexOf(ch);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  if (bits.slice(0, 4).some((b) => b)) return null;
  const pub = Buffer.alloc(32);
  for (let i = 0; i < 256; i++) if (bits[4 + i]) pub[i >> 3] |= 1 << (7 - (i & 7));
  return pubToAddress(pub).slice(-8) === raw.slice(52) ? pub : null;
}

/** { ok, reason } - ok only when shape, pad bits and checksum all hold. */
function checkAddress(address) {
  if (typeof address !== "string") return { ok: false, reason: "not a string" };
  if (!/^(nano|xrb)_/.test(address)) return { ok: false, reason: "no nano_ prefix" };
  if (!/^(nano|xrb)_[13-9a-km-uw-z]{60}$/.test(address)) return { ok: false, reason: "wrong length or letters outside the Nano alphabet" };
  return addressToPub(address) ? { ok: true, reason: "" } : { ok: false, reason: "checksum does not match (the address has a typo)" };
}

// ---------------------------------------------------------------- ed25519 (BigInt)
const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const mod = (a, m = P) => ((a % m) + m) % m;
function pow(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const I = pow(2n, (P - 1n) / 4n);
function add(p, q) {
  const [x1, y1, z1, t1] = p, [x2, y2, z2, t2] = q;
  const A = mod((y1 - x1) * (y2 - x2)), B = mod((y1 + x1) * (y2 + x2));
  const C = mod(2n * D * t1 * t2), Dd = mod(2n * z1 * z2);
  const E = B - A, F = Dd - C, G = Dd + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(p, s) {
  let r = [0n, 1n, 1n, 0n];
  while (s > 0n) { if (s & 1n) r = add(r, p); p = add(p, p); s >>= 1n; }
  return r;
}
const By = mod(4n * inv(5n));
function xFromY(y, sign) {
  const x2 = mod((y * y - 1n) * inv(D * y * y + 1n));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * I);
  if (mod(x * x - x2) !== 0n) return null;
  if ((x & 1n) !== BigInt(sign)) x = mod(-x);
  return x;
}
const Bx = xFromY(By, 0);
const BASE = [Bx, By, 1n, mod(Bx * By)];
const le = (buf) => { let n = 0n; for (let i = buf.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]); return n; };
const toLe = (n, len) => { const b = Buffer.alloc(len); for (let i = 0; i < len; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
function encode(p) {
  const zi = inv(p[2]);
  const x = mod(p[0] * zi), y = mod(p[1] * zi);
  const b = toLe(y, 32);
  if (x & 1n) b[31] |= 0x80;
  return b;
}
function decode(buf) {
  const y = le(buf) & ((1n << 255n) - 1n);
  if (y >= P) return null;
  const x = xFromY(y, buf[31] >> 7);
  return x === null ? null : [x, y, 1n, mod(x * y)];
}
const sha512 = (b) => crypto.createHash("sha512").update(b).digest();
const nanoHash = (b) => blake2b(b, 64);

function expand(secret, H) {
  const h = H(secret);
  const a = h.subarray(0, 32);
  a[0] &= 248; a[31] &= 127; a[31] |= 64;
  return { a: le(a), prefix: h.subarray(32) };
}
/** Public key from a 32-byte private key (what a Nano seed derives at index 0). */
function publicKey(secret, H = nanoHash) { return encode(mul(BASE, expand(Buffer.from(secret), H).a)); }

function sign(message, secret, H = nanoHash) {
  const msg = Buffer.from(message);
  const { a, prefix } = expand(Buffer.from(secret), H);
  const A = encode(mul(BASE, a));
  const r = mod(le(H(Buffer.concat([prefix, msg]))), L);
  const R = encode(mul(BASE, r));
  const k = mod(le(H(Buffer.concat([R, A, msg]))), L);
  return Buffer.concat([R, toLe(mod(r + k * a, L), 32)]);
}

const isIdentity = (p) => mod(p[0]) === 0n && mod(p[1] - p[2]) === 0n;
/** A point whose order divides 8 (identity, or one of the 7 torsion points). */
const isSmallOrder = (p) => isIdentity(mul(p, 8n));

/**
 * True when the 32-byte key behind an address can never sign: it does not decode to a curve
 * point, or it is small-order (the burn address nano_1111...hifc8npp, all-zero key, and the
 * other torsion points). verify() already refuses signatures for such keys.
 */
function isUnsignableKey(pub) {
  try {
    const pk = Buffer.from(pub);
    if (pk.length !== 32) return true;
    const A = decode(pk);
    return !A || isSmallOrder(A);
  } catch (_) { return true; }
}

function verify(message, signature, pub, H = nanoHash) {
  try {
    const sig = Buffer.from(signature), pk = Buffer.from(pub), msg = Buffer.from(message);
    if (sig.length !== 64 || pk.length !== 32) return false;
    const A = decode(pk), R = decode(sig.subarray(0, 32));
    if (!A || !R) return false;
    // A small-order public key (e.g. the burn address nano_1111...hifc8npp, all-zero key) has
    // no secret behind it, and with R chosen among the torsion points and s = 0 the equation
    // holds for most messages: anyone could "sign" for it. Refuse small-order A and R.
    if (isSmallOrder(A) || isSmallOrder(R)) return false;
    const s = le(sig.subarray(32));
    if (s >= L) return false;
    const k = mod(le(H(Buffer.concat([sig.subarray(0, 32), pk, msg]))), L);
    const lhs = mul(BASE, s), rhs = add(R, mul(A, k));
    return mod(lhs[0] * rhs[2]) === mod(rhs[0] * lhs[2]) && mod(lhs[1] * rhs[2]) === mod(rhs[1] * lhs[2]);
  } catch (_) { return false; }
}

/** True only if `signatureHex` (128 hex) is a Nano-ed25519 signature of `message` by the key behind `address`. */
function verifyByAddress(address, message, signatureHex) {
  const pub = addressToPub(address);
  if (!pub || typeof signatureHex !== "string" || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
  return verify(message, Buffer.from(signatureHex, "hex"), pub);
}

/**
 * { ok, reason } - ok only when the address passes checkAddress AND its key could sign (so a
 * signed accept or settle by its owner is possible at all).
 */
function checkSigningAddress(address) {
  const c = checkAddress(address);
  if (!c.ok) return c;
  if (isUnsignableKey(addressToPub(address))) {
    return { ok: false, reason: "its public key is not a usable signing key (not a curve point, or a burn / small-order key): nobody holds a secret for it" };
  }
  return { ok: true, reason: "" };
}

module.exports = { blake2b, pubToAddress, addressToPub, checkAddress, checkSigningAddress, isUnsignableKey, publicKey, sign, verify, verifyByAddress, sha512, nanoHash };
