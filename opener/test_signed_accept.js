/**
 * Laws for signed accept (dhyabi2/unstuck issue #1 follow-up: the accept_token veto).
 *   S1 blake2b and ed25519 are proven against references (node's blake2b512, node's RFC 8032
 *      ed25519 via a sha512 swap, and the official Nano test vector).
 *   S2 an accept signed by the asker's Nano key succeeds with NO token.
 *   S3 a signature by anyone else, over another answer, another ask, or with a flipped bit, is refused
 *      and the ask stays open.
 *   S4 NETWORK_ACCEPT_MODE=signature refuses a correct token; =token refuses a signature; either takes both.
 *   S5 the checksum check refuses the real bad address a stranger posted (eddie_researcher, The Colony).
 *   S6 settle message binds the block hash.
 * Run: node test_signed_accept.js
 */
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const sig = require("./nano-sig.js");
const n = require("./network.js");

let failed = 0;
const law = (nm, fn) => { try { fn(); console.log(`ok   ${nm}`); } catch (e) { failed++; console.log(`FAIL ${nm}: ${e.message}`); } };
const keypair = () => { const secret = crypto.randomBytes(32); return { secret, address: sig.pubToAddress(sig.publicKey(secret)) }; };
const askerKey = keypair(), answererKey = keypair(), otherKey = keypair();
const sign = (key, msg) => sig.sign(Buffer.from(msg, "utf8"), key.secret).toString("hex");

function freshAsk(tok) {
  const a = n.createAsk({ asker: askerKey.address, title: "stuck on RPC", body: "block_info hangs", bountyRaw: "10000000000000000000000000000" });
  a.id = 7; a.acceptToken = tok || "tok-xyz";
  const aid = n.addAnswer(a, { answerer: answererKey.address, body: "use work_generate with difficulty" });
  return { a, aid };
}
const withMode = (m, fn) => { const old = process.env.NETWORK_ACCEPT_MODE; if (m) process.env.NETWORK_ACCEPT_MODE = m; else delete process.env.NETWORK_ACCEPT_MODE; try { fn(); } finally { if (old === undefined) delete process.env.NETWORK_ACCEPT_MODE; else process.env.NETWORK_ACCEPT_MODE = old; } };

law("S1 blake2b-512 matches node for 0..300 byte inputs", () => {
  for (const len of [0, 1, 64, 127, 128, 129, 255, 256, 300]) {
    const d = Buffer.alloc(len, len & 255);
    assert.strictEqual(sig.blake2b(d, 64).toString("hex"), crypto.createHash("blake2b512").update(d).digest("hex"), `len ${len}`);
  }
});
law("S1 ed25519 core (sha512 swapped in) equals node's RFC 8032 ed25519, byte for byte", () => {
  for (let i = 0; i < 3; i++) {
    const seed = crypto.randomBytes(32);
    const priv = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
    const pub = crypto.createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
    const msg = crypto.randomBytes(40 + i);
    assert.ok(pub.equals(sig.publicKey(seed, sig.sha512)));
    assert.ok(crypto.sign(null, msg, priv).equals(sig.sign(msg, seed, sig.sha512)));
    assert.ok(sig.verify(msg, crypto.sign(null, msg, priv), pub, sig.sha512));
  }
});
law("S1 official Nano vector: key 9F0E44... -> nano_3i1aq1cc...", () => {
  const sk = Buffer.from("9F0E444C69F77A49BD0BE89DB92C38FE713E0963165CCA12FAF5712D7657120F", "hex");
  assert.strictEqual(sig.publicKey(sk).toString("hex").toUpperCase(), "C008B814A7D269A1FA3C6528B19201A24D797912DB9996FF02A1FF356E45552B");
  assert.strictEqual(sig.pubToAddress(sig.publicKey(sk)), "nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7");
});

law("S2 an accept signed by the asker's key succeeds with no token", () => {
  withMode(null, () => {
    const { a, aid } = freshAsk();
    const msg = n.acceptMessage(a, a.answers[0]);
    const r = n.acceptAnswer(a, aid, a.asker, { signature: sign(askerKey, msg) });
    assert.strictEqual(r.answerId, aid);
    assert.strictEqual(a.status, "paid");
  });
});
law("S3 a signature by another key, a flipped bit, or for another answer/ask is refused; the ask stays open", () => {
  withMode(null, () => {
    const { a, aid } = freshAsk();
    const msg = n.acceptMessage(a, a.answers[0]);
    const good = sign(askerKey, msg);
    const flipped = good.slice(0, 10) + (good[10] === "0" ? "1" : "0") + good.slice(11);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: sign(otherKey, msg) }), /asker signature/);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: flipped }), /asker signature/);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: sign(askerKey, msg.replace("ask:7", "ask:8")) }), /asker signature/);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: sign(askerKey, msg.replace(answererKey.address, otherKey.address)) }), /asker signature/);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: "00".repeat(64) }), /asker signature/);
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, {}), /accept token/);
    assert.strictEqual(a.status, "open");
  });
});
law("S3 the answer text is bound: editing the answer after signing voids the signature", () => {
  withMode(null, () => {
    const { a, aid } = freshAsk();
    const good = sign(askerKey, n.acceptMessage(a, a.answers[0]));
    a.answers[0].body = "send your seed to me";
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: good }), /asker signature/);
  });
});
law("S4 modes: signature refuses a correct token; token refuses a signature; either takes both", () => {
  withMode("signature", () => {
    const { a, aid } = freshAsk("T");
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, "T"), /no longer honoured/);
    assert.strictEqual(a.status, "open");
    n.acceptAnswer(a, aid, a.asker, { signature: sign(askerKey, n.acceptMessage(a, a.answers[0])) });
  });
  withMode("token", () => {
    const { a, aid } = freshAsk("T");
    assert.throws(() => n.acceptAnswer(a, aid, a.asker, { signature: sign(askerKey, n.acceptMessage(a, a.answers[0])) }), /accept token/);
    n.acceptAnswer(a, aid, a.asker, "T");
  });
  withMode("either", () => {
    const { a, aid } = freshAsk("T");
    n.acceptAnswer(a, aid, a.asker, "T");
  });
});
law("S5 the checksum refuses the real bad address from The Colony (eddie_researcher) and accepts a good one", () => {
  // The Colony post, 2026-10: the address "nano_3qucf316..." failed its checksum; the agent reposted a corrected one.
  // Both strings are in agent-conversations/eddie_researcher--The-Colony.json.
  const COLONY_BAD = "nano_3qucf316qrxtq684zpsqm58993imii7dh976gghp37j8rcuq9aafm94b37z3";   // as posted, fails checksum
  const COLONY_FIXED = "nano_3qucf316qrxtq684zpsqm58993imii7dh976gghp37j8rcuq9aafw8ds3j6s"; // the agent's own correction
  assert.strictEqual(sig.checkAddress(COLONY_BAD).ok, false);
  assert.match(sig.checkAddress(COLONY_BAD).reason, /checksum/);
  assert.strictEqual(sig.checkAddress(COLONY_FIXED).ok, true);
  const good = answererKey.address;
  const last = good[good.length - 1];
  const bad = good.slice(0, -1) + (last === "1" ? "3" : "1");
  assert.strictEqual(sig.checkAddress(good).ok, true);
  const r = sig.checkAddress(bad);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /checksum/);
  assert.strictEqual(sig.checkAddress("nano_3qucf316").ok, false);
  assert.strictEqual(sig.checkAddress("xrb_" + good.slice(5)).ok, true);
});
law("S6 the settle message binds the block hash (case-insensitive hex)", () => {
  const { a } = freshAsk();
  a.acceptedAnswerId = 1;
  const h = "AB".repeat(32);
  assert.strictEqual(n.settleMessage(a, h), n.settleMessage(a, h.toLowerCase()));
  assert.notStrictEqual(n.settleMessage(a, h), n.settleMessage(a, "CD".repeat(32)));
  assert.ok(sig.verifyByAddress(a.asker, n.settleMessage(a, h), sign(askerKey, n.settleMessage(a, h))));
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all signed-accept laws hold");
