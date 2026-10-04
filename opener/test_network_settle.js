#!/usr/bin/env node
/**
 * Test block 15 — on-chain settlement tracking for accepted asks.
 *
 * Laws:
 *   L12 — The network store records an on-chain settlement block hash for a
 *         paid (accepted) ask, refuses to settle a non-paid ask, and only a
 *         64-hex block hash settles an ask.
 *   L13 — The network store's on-chain standing counts only paid asks with a
 *         recorded settlement block, per distinct asker (never volume), and the
 *         server exposes it via GET /standing and POST /ask/:id/settle.
 * These three laws are AMENDED here (dhyabi2/unstuck#14). They used to be
 * satisfied by a 64-hex string: nothing in the store, the server or the
 * verifier ever asked a node whether the block existed, and
 * `settlement_verified_at` was stamped on it anyway. As amended:
 *   L12 also — the store refuses to record a settlement without the result of
 *         an on-chain verification, and one block settles at most one ask.
 *   L13 also — POST /ask/:id/settle verifies the block against a node before
 *         anything is written, and refuses when it does not prove the payment.
 *   L14 also — a block proves a payment only if the network has CONFIRMED it
 *         and the node calls it a send; unprovable counts as no.
 *
 * Method: use a temp DB and a stubbed Nano RPC (`rpc._rpcCall`) holding a small
 * fake chain, so the HTTP settle path is exercised end to end without a node.
 * Verify refusal boundaries and that settlement survives a db close/reopen.
 */

const s = require("./network-store.js");
const settle = require("./network-settle.js");
const rpc = require("./rpc.js");
const http = require("http");

const tmpDb = `/tmp/test-ns-settle-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

const nanoA = "nano_3ppzytmqf6gfhd84wipe61owb5nmw919dz4m8oop4msz7cr9ofs3cza4zibj";
const nanoB = "nano_3on5iz7bfg44zhqgapdme6zp7yun4yk37kofukctyiiefhfhfjh45eihgdk1";
const nanoC = "nano_3sxqbj4d5bet7uczwo8b8y9pghhn5kgi51axhuor1j8bxjf17sh3tt4kr9ua";
const bounty = "1000000000000000000000000";
const HASH = "A".repeat(64);
const HASH2 = "B".repeat(64);

// `recordSettlement` now refuses to stamp `settlement_verified_at` without the
// result of an on-chain check. The store's own laws (L12/L13) are about its
// refusal boundaries, not about the chain, so they pass a verified result; the
// L17 block below is what proves the store refuses an unverified one, and that
// the HTTP path really asks a node.
const VERIFIED = { valid: true };

// A small fake chain the stubbed `block_info` answers from: hash -> the fields
// `verifyBlockPayment` reads. Shaped like a real node's answer (strings, upper
// case `confirmed`, an explicit `subtype`).
const chain = {};
function putSend(hash, opts = {}) {
  const block = {
    hash: hash.toUpperCase(),
    block_account: "from" in opts ? opts.from : nanoA,
    amount: "amount" in opts ? opts.amount : bounty,
    link_as_account: "to" in opts ? opts.to : nanoB,
    confirmed: "confirmed" in opts ? opts.confirmed : "true",
    subtype: "subtype" in opts ? opts.subtype : "send",
  };
  // An absent field is a node that did not say, which is not the same as one
  // that said no - so drop the key rather than sending `undefined`.
  for (const k of Object.keys(block)) if (block[k] === undefined) delete block[k];
  chain[hash.toUpperCase()] = block;
  return hash;
}
function installChainStub() {
  rpc._rpcCall = async (url, payload) => {
    if (payload.action !== "block_info") return {};
    const found = chain[String(payload.hash).toUpperCase()];
    return found || { error: "Block not found" };
  };
}

function req(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      }
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  try {
    s.resetDb();

    // --- L12: recordSettlement boundaries ---

    // Settling a non-existent ask throws
    try { s.recordSettlement(9999, HASH, "tok"); failed++; console.log("FAIL L12 missing ask not rejected"); }
    catch (e) { check("L12 settle missing ask rejected", true); }

    // Create an ask, add an answer, do NOT accept — settlement must be refused (ask still open)
    const a1 = s.createAsk({ asker: nanoA, title: "t1", body: "b1", bountyRaw: bounty });
    const ans1 = s.addAnswer(a1.id, { answerer: nanoB, body: "answer 1: reboot the node clears the cache" });
    try { s.recordSettlement(a1.id, HASH, a1.accept_token); failed++; console.log("FAIL L12 open ask settled"); }
    catch (e) { check("L12 cannot settle an open ask", /paid/.test(e.message), e.message); }

    // Accept it -> paid
    s.acceptAnswer(a1.id, ans1.answerId, nanoA, a1.accept_token);
    const paid1 = s.getAsk(a1.id);
    check("L12 ask is paid after acceptance", paid1.status === "paid");

    // Forge #1: settling is an asker action — wrong or missing accept token must be refused
    // even though the ask is paid (anyone who knew it was paid could otherwise write any
    // block hash onto it; acceptedBy is a caller-written claim, never the authority).
    try { s.recordSettlement(a1.id, HASH); failed++; console.log("FAIL L12 no-token settled"); }
    catch (e) { check("L12 settle refused on missing token", /accept token/.test(e.message), e.message); }
    try { s.recordSettlement(a1.id, HASH, "not-the-token"); failed++; console.log("FAIL L12 wrong token settled"); }
    catch (e) { check("L12 settle refused on wrong token", /accept token/.test(e.message), e.message); }

    // The store used to write the block and stamp
    // `settlement_verified_at` on the caller's word alone. Nothing verified is
    // nothing settled, and that is the refusal, not a silent unverified row.
    try { s.recordSettlement(a1.id, HASH, a1.accept_token); failed++; console.log("FAIL L12 unverified settle recorded"); }
    catch (e) { check("L12 store refuses a settle with no verification", /verified on-chain/.test(e.message), e.message); }
    try { s.recordSettlement(a1.id, HASH, a1.accept_token, { verification: { valid: false, reason: "block not found: Block not found" } }); failed++; console.log("FAIL L12 failed verification recorded"); }
    catch (e) { check("L12 store refuses a settle whose verification failed", /verified on-chain.*not found/.test(e.message), e.message); }
    check("L12 nothing was written by either refusal", s.getAsk(a1.id).settlementBlock === null && s.getAsk(a1.id).settlementVerifiedAt === null);

    // Record a valid settlement (with the correct token and a verified block)
    const rec = s.recordSettlement(a1.id, HASH, a1.accept_token, { verification: VERIFIED });
    check("L12 settlement recorded ok", rec.ok === true);
    check("L12 settlement block stored", rec.settlementBlock === HASH);

    // Double settle refused
    try { s.recordSettlement(a1.id, HASH2, a1.accept_token, { verification: VERIFIED }); failed++; console.log("FAIL L12 double settle"); }
    catch (e) { check("L12 double settle refused", /already settled/.test(e.message), e.message); }

    // Bad-format block refused (with the valid token)
    const a2 = s.createAsk({ asker: nanoA, title: "t2", body: "b2", bountyRaw: bounty });
    const ans2 = s.addAnswer(a2.id, { answerer: nanoB, body: "answer 2: switch to a fresh RPC endpoint" });
    s.acceptAnswer(a2.id, ans2.answerId, nanoA, a2.accept_token);
    try { s.recordSettlement(a2.id, "short-hash", a2.accept_token, { verification: VERIFIED }); failed++; console.log("FAIL L12 bad hash accepted"); }
    catch (e) { check("L12 bad block hash refused", /64-hex/.test(e.message), e.message); }

    // --- Persistence: settlement survives close/reopen ---
    s.closeDb();
    const s2 = require("./network-store.js");
    const reopened = s2.getAsk(a1.id);
    check("L12 settlement survives restart", reopened.settlementBlock === HASH, String(reopened.settlementBlock));

    // --- L13: standing counts only settled asks, distinct askers ---

    // a2 is paid but NOT settled (settlement refused earlier) — should not count
    // a1 is paid AND settled (asker A paid answerer B) — counts 1 for B
    const st1 = s2.getStanding();
    check("L13 standing counts settled asker for B", st1[nanoB] === 1, JSON.stringify(st1));
    check("L13 unsettled paid ask does not count", Object.values(st1).reduce((x, y) => x + (y || 0), 0) === 1, JSON.stringify(st1));

    // Second settled ask: same answerer B paid by a NEW asker C -> B now has 2 distinct
    const a3 = s2.createAsk({ asker: nanoC, title: "t3", body: "b3", bountyRaw: bounty });
    const ans3 = s2.addAnswer(a3.id, { answerer: nanoB, body: "answer 3: verify against a second node first" });
    s2.acceptAnswer(a3.id, ans3.answerId, nanoC, a3.accept_token);
    s2.recordSettlement(a3.id, HASH2, a3.accept_token, { verification: VERIFIED });
    const st2 = s2.getStanding();
    check("L13 distinct askers counted, not volume", st2[nanoB] === 2, JSON.stringify(st2));

    // A settled ask where the asker pays itself is refused at accept (network.js),
    // so standing can never include a self-pay — verified via accept guard already.
    // Add a second settled ask from the SAME asker A to prove volume is not counted:
    const a4 = s2.createAsk({ asker: nanoA, title: "t4", body: "b4", bountyRaw: bounty });
    const ans4 = s2.addAnswer(a4.id, { answerer: nanoB, body: "answer 4: the block hash matches the confirmed send" });
    s2.acceptAnswer(a4.id, ans4.answerId, nanoA, a4.accept_token);
    s2.recordSettlement(a4.id, "C".repeat(64), a4.accept_token, { verification: VERIFIED });
    const st3 = s2.getStanding();
    check("L13 same asker twice counts once (distinct, not volume)", st3[nanoB] === 2, JSON.stringify(st3));

    // L17: one block settles one ask. A send covers the one bounty it was sent
    // for, so the same hash on a second ask counts one payment twice - and
    // standing is distinct askers over settled asks, so it would be bought
    // twice with one payment.
    const a5 = s2.createAsk({ asker: nanoC, title: "t5", body: "b5", bountyRaw: bounty });
    const ans5 = s2.addAnswer(a5.id, { answerer: nanoB, body: "answer 5: the same block cannot pay two bounties" });
    s2.acceptAnswer(a5.id, ans5.answerId, nanoC, a5.accept_token);
    try { s2.recordSettlement(a5.id, HASH2, a5.accept_token, { verification: VERIFIED }); failed++; console.log("FAIL L12 reused block settled"); }
    catch (e) { check("L12 a block that already settles another ask is refused", /already settles ask/.test(e.message), e.message); }
    check("L12 the reuse left no row", s2.getAsk(a5.id).settlementBlock === null);
    // Lower case must not slip past it: a block hash is hex either way.
    try { s2.recordSettlement(a5.id, HASH2.toLowerCase(), a5.accept_token, { verification: VERIFIED }); failed++; console.log("FAIL L12 lower-case reuse settled"); }
    catch (e) { check("L12 reuse is caught whatever the hex case", /already settles ask/.test(e.message), e.message); }

    // --- network-settle.js: on-chain verification via RPC mock ---
    const VALID_HASH = "AB".repeat(32); // exactly 64 hex chars
    installChainStub();
    putSend(VALID_HASH);
    const vok = await settle.verifyBlockPayment(VALID_HASH, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 valid on-chain payment verified", vok.valid === true, JSON.stringify(vok));

    // Wrong recipient
    const vbad = await settle.verifyBlockPayment(VALID_HASH, {
      amountRaw: bounty, toAddress: nanoC, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 wrong recipient rejected", vbad.valid === false && /recipient/.test(vbad.reason), vbad.reason);

    // Bad block hash format
    const vfmt = await settle.verifyBlockPayment("short", { amountRaw: "1", toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO" });
    check("L14 bad hash format rejected", vfmt.valid === false && /format/.test(vfmt.reason), vfmt.reason);

    // L17: a send from somebody other than the asker. The verifier reads the
    // node's `block_account`; the old stub set `account`, which it never reads,
    // so this branch had never run.
    const OTHER = putSend("5".repeat(64), { from: nanoC });
    const vsender = await settle.verifyBlockPayment(OTHER, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 a send from someone other than the asker is rejected", vsender.valid === false && /does not match asker/.test(vsender.reason), vsender.reason);

    // Missing block on chain
    const vmiss = await settle.verifyBlockPayment("A".repeat(64), { amountRaw: "1", toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO" });
    check("L14 missing block rejected", vmiss.valid === false && /not found/.test(vmiss.reason), vmiss.reason);

    // L17: an UNCONFIRMED block can still be forked away, so it proves nothing.
    const UNCONF = putSend("1".repeat(64), { confirmed: "false" });
    const vunconf = await settle.verifyBlockPayment(UNCONF, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 unconfirmed block rejected", vunconf.valid === false && /not confirmed/.test(vunconf.reason), vunconf.reason);
    // A node too old to answer `confirmed` has not said yes: fail closed.
    const NOCONF = putSend("2".repeat(64), { confirmed: undefined });
    const vnoconf = await settle.verifyBlockPayment(NOCONF, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 a node that will not say confirmed is rejected", vnoconf.valid === false && /not confirmed/.test(vnoconf.reason), vnoconf.reason);

    // L17: a RECEIVE is not a payment to anyone. Its `link` is the source
    // block's hash and `link_as_account` is that hash read as an account, so
    // the old recipient check could be satisfied by a block that sent nothing.
    const RECV = putSend("3".repeat(64), { subtype: "receive" });
    const vrecv = await settle.verifyBlockPayment(RECV, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 a receive block is rejected", vrecv.valid === false && /not a send/.test(vrecv.reason), vrecv.reason);
    const NOSUB = putSend("4".repeat(64), { subtype: undefined });
    const vnosub = await settle.verifyBlockPayment(NOSUB, {
      amountRaw: bounty, toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO",
    });
    check("L14 a block with no subtype is rejected", vnosub.valid === false && /not a send/.test(vnosub.reason), vnosub.reason);

    // --- Server endpoints ---
    const nw = require("./nserver-persist.js");
    const PORT = 4399;
    nw.server.listen(PORT);
    await new Promise((r) => setTimeout(r, 250));

    // Create via HTTP, settle via POST /ask/:id/settle, read standing
    const c = await req(PORT, "POST", "/ask", { asker: nanoA, title: "http", body: "settle via http", bounty_raw: bounty });
    const cB = JSON.parse(c.body);
    const cid = cB.id;
    const cTok = cB.accept_token;
    const ans = await req(PORT, "POST", `/ask/${cid}/answers`, { answerer: nanoB, body: "http answer: retry with the corrected headers" });
    const aid = JSON.parse(ans.body).answerId;
    const acc = await req(PORT, "POST", `/ask/${cid}/accept`, { acceptedBy: nanoA, answerId: aid, accept_token: cTok });
    check("L13 accept via HTTP 200", acc.status === 200, String(acc.status));

    // unstuck#14, the exact reproduction: a well-formed hash that is a real
    // block but an UNRELATED send between two other accounts for a smaller
    // amount. This answered {ok:true} and bought standing. It is now refused,
    // and before the fix every one of these four was a 200.
    const UNRELATED = putSend("D".repeat(64), { from: nanoC, to: nanoC, amount: "1" });
    const bogus = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: UNRELATED, acceptedBy: nanoA, accept_token: cTok });
    check("L13 an unrelated send does not settle an ask", bogus.status === 400 && /does not prove this payment/.test(bogus.body), String(bogus.status) + " " + bogus.body);
    const nowhere = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: "abcdef0123456789".repeat(4), acceptedBy: nanoA, accept_token: cTok });
    check("L13 a hash of nothing does not settle an ask", nowhere.status === 400 && /not found/.test(nowhere.body), String(nowhere.status) + " " + nowhere.body);
    const short = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: putSend("6".repeat(64), { amount: "1" }), acceptedBy: nanoA, accept_token: cTok });
    check("L13 a send under the bounty does not settle an ask", short.status === 400 && /less than expected bounty/.test(short.body), String(short.status) + " " + short.body);
    const unconf = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: putSend("7".repeat(64), { confirmed: "false" }), acceptedBy: nanoA, accept_token: cTok });
    check("L13 an unconfirmed send does not settle an ask", unconf.status === 400 && /not confirmed/.test(unconf.body), String(unconf.status) + " " + unconf.body);
    check("L13 none of the four refusals wrote a settlement", JSON.parse((await req(PORT, "GET", `/ask/${cid}`)).body).ask.settlementBlock === null);

    // The real one: a confirmed send from this asker to this answerer covering
    // the bounty settles, and is stamped verified.
    const REAL = putSend("8".repeat(64), { from: nanoA, to: nanoB, amount: bounty });
    const st = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: REAL, acceptedBy: nanoA, accept_token: cTok });
    check("L13 settle via HTTP 200", st.status === 200, String(st.status) + " " + st.body);
    const settledAsk = JSON.parse((await req(PORT, "GET", `/ask/${cid}`)).body).ask;
    check("L13 the settled block is the verified one", settledAsk.settlementBlock === REAL, String(settledAsk.settlementBlock));
    check("L13 verified-at is stamped only on a verified block", !!settledAsk.settlementVerifiedAt);

    // A node that cannot be reached is not a settlement either.
    const c3 = await req(PORT, "POST", "/ask", { asker: nanoA, title: "nodedown", body: "node down", bounty_raw: bounty });
    const c3B = JSON.parse(c3.body);
    const ans3h = await req(PORT, "POST", `/ask/${c3B.id}/answers`, { answerer: nanoB, body: "http answer: the node is unreachable right now" });
    await req(PORT, "POST", `/ask/${c3B.id}/accept`, { acceptedBy: nanoA, answerId: JSON.parse(ans3h.body).answerId, accept_token: c3B.accept_token });
    const saved = rpc._rpcCall;
    rpc._rpcCall = async () => { throw new Error("connect ECONNREFUSED"); };
    const SECOND = putSend("9".repeat(64), { from: nanoA, to: nanoB, amount: bounty });
    const down = await req(PORT, "POST", `/ask/${c3B.id}/settle`, { paymentBlock: SECOND, acceptedBy: nanoA, accept_token: c3B.accept_token });
    check("L13 a node that cannot be reached refuses the settle", down.status === 400 && /could not/.test(down.body), String(down.status) + " " + down.body);
    rpc._rpcCall = saved;
    // And the same block cannot settle this second ask even once the node is back.
    const reuse = await req(PORT, "POST", `/ask/${c3B.id}/settle`, { paymentBlock: REAL, acceptedBy: nanoA, accept_token: c3B.accept_token });
    check("L13 one block settles one ask over HTTP", reuse.status === 400 && /already settles ask/.test(reuse.body), String(reuse.status) + " " + reuse.body);
    const stResp = await req(PORT, "GET", "/standing");
    check("L13 GET /standing 200", stResp.status === 200, String(stResp.status));
    const stData = JSON.parse(stResp.body);
    check("L13 standing has nanoB >= 2", stData.standing[nanoB] >= 2, JSON.stringify(stData.standing));
    check("L13 standing asset is XNO", stData.asset === "XNO", String(stData.asset));

    // Settle is an asker action (Forge #1): a settle with no or a wrong accept_token is
    // refused over HTTP even when the ask is paid — acceptedBy alone must never authorize it.
    const noTok = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: "F".repeat(64), acceptedBy: nanoA });
    check("L13 settle without token via HTTP 400", noTok.status === 400, String(noTok.status) + " " + noTok.body);
    const wrongTok = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: "F".repeat(64), acceptedBy: nanoA, accept_token: "wrong-token" });
    check("L13 settle with wrong token via HTTP 400", wrongTok.status === 400, String(wrongTok.status) + " " + wrongTok.body);

    // settle non-paid (open) ask via HTTP -> 400
    const c2 = await req(PORT, "POST", "/ask", { asker: nanoA, title: "open", body: "not paid", bounty_raw: bounty });
    const c2id = JSON.parse(c2.body).id;
    const bad = await req(PORT, "POST", `/ask/${c2id}/settle`, { paymentBlock: "E".repeat(64) });
    check("L13 settle open ask via HTTP 400", bad.status === 400, String(bad.status) + " " + bad.body);

    // bad block hash via HTTP -> 400
    const badhash = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: "nope" });
    check("L13 settle bad hash via HTTP 400", badhash.status === 400, String(badhash.status) + " " + badhash.body);

    nw.s.closeDb();
    nw.server.close();

  } finally {
    s.closeDb();
    try { require("fs").unlinkSync(tmpDb); } catch (_) {}
    try { require("fs").unlinkSync(tmpDb + "-wal"); } catch (_) {}
    try { require("fs").unlinkSync(tmpDb + "-shm"); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall settlement laws pass");
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });