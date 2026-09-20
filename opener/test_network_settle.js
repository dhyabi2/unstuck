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
 *
 * Method: use a temp DB, mock no RPC (settlement recording is local, the block
 * hash is the proof the caller verified). Verify refusal boundaries and that
 * settlement survives a db close/reopen.
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

const nanoA = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const nanoB = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";
const nanoC = "nano_3zqdw3qf1z8k3jx8jintaiwpo3yz7zqh1me4ph5j439ts8hsppx8dzy4xcsz";
const bounty = "1000000000000000000000000";
const HASH = "A".repeat(64);
const HASH2 = "B".repeat(64);

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
    try { s.recordSettlement(9999, HASH); failed++; console.log("FAIL L12 missing ask not rejected"); }
    catch (e) { check("L12 settle missing ask rejected", true); }

    // Create an ask, add an answer, do NOT accept — settlement must be refused (ask still open)
    const a1 = s.createAsk({ asker: nanoA, title: "t1", body: "b1", bountyRaw: bounty });
    const ans1 = s.addAnswer(a1.id, { answerer: nanoB, body: "answer 1" });
    try { s.recordSettlement(a1.id, HASH); failed++; console.log("FAIL L12 open ask settled"); }
    catch (e) { check("L12 cannot settle an open ask", /paid/.test(e.message), e.message); }

    // Accept it -> paid
    s.acceptAnswer(a1.id, ans1.answerId, nanoA, a1.accept_token);
    const paid1 = s.getAsk(a1.id);
    check("L12 ask is paid after acceptance", paid1.status === "paid");

    // Record a valid settlement
    const rec = s.recordSettlement(a1.id, HASH);
    check("L12 settlement recorded ok", rec.ok === true);
    check("L12 settlement block stored", rec.settlementBlock === HASH);

    // Double settle refused
    try { s.recordSettlement(a1.id, HASH2); failed++; console.log("FAIL L12 double settle"); }
    catch (e) { check("L12 double settle refused", /already settled/.test(e.message), e.message); }

    // Bad-format block refused
    const a2 = s.createAsk({ asker: nanoA, title: "t2", body: "b2", bountyRaw: bounty });
    const ans2 = s.addAnswer(a2.id, { answerer: nanoB, body: "answer 2" });
    s.acceptAnswer(a2.id, ans2.answerId, nanoA, a2.accept_token);
    try { s.recordSettlement(a2.id, "short-hash"); failed++; console.log("FAIL L12 bad hash accepted"); }
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
    const ans3 = s2.addAnswer(a3.id, { answerer: nanoB, body: "answer 3" });
    s2.acceptAnswer(a3.id, ans3.answerId, nanoC, a3.accept_token);
    s2.recordSettlement(a3.id, HASH2);
    const st2 = s2.getStanding();
    check("L13 distinct askers counted, not volume", st2[nanoB] === 2, JSON.stringify(st2));

    // A settled ask where the asker pays itself is refused at accept (network.js),
    // so standing can never include a self-pay — verified via accept guard already.
    // Add a second settled ask from the SAME asker A to prove volume is not counted:
    const a4 = s2.createAsk({ asker: nanoA, title: "t4", body: "b4", bountyRaw: bounty });
    const ans4 = s2.addAnswer(a4.id, { answerer: nanoB, body: "answer 4" });
    s2.acceptAnswer(a4.id, ans4.answerId, nanoA, a4.accept_token);
    s2.recordSettlement(a4.id, "C".repeat(64));
    const st3 = s2.getStanding();
    check("L13 same asker twice counts once (distinct, not volume)", st3[nanoB] === 2, JSON.stringify(st3));

    // --- network-settle.js: on-chain verification via RPC mock ---
    const VALID_HASH = "AB".repeat(32); // exactly 64 hex chars
    rpc._rpcCall = async (url, payload) => {
      if (payload.action === "block_info") {
        return {
          hash: VALID_HASH,
          account: nanoA,
          amount: bounty,
          link_as_account: nanoB,
        };
      }
    };
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

    // Missing block on chain
    rpc._rpcCall = async () => ({ error: "Block not found" });
    const vmiss = await settle.verifyBlockPayment("A".repeat(64), { amountRaw: "1", toAddress: nanoB, fromAddress: nanoA, bountyAsset: "XNO" });
    check("L14 missing block rejected", vmiss.valid === false && /not found/.test(vmiss.reason), vmiss.reason);

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
    const ans = await req(PORT, "POST", `/ask/${cid}/answers`, { answerer: nanoB, body: "http answer" });
    const aid = JSON.parse(ans.body).answerId;
    const acc = await req(PORT, "POST", `/ask/${cid}/accept`, { acceptedBy: nanoA, answerId: aid, accept_token: cTok });
    check("L13 accept via HTTP 200", acc.status === 200, String(acc.status));
    const st = await req(PORT, "POST", `/ask/${cid}/settle`, { paymentBlock: "D".repeat(64), acceptedBy: nanoA });
    check("L13 settle via HTTP 200", st.status === 200, String(st.status) + " " + st.body);
    const stResp = await req(PORT, "GET", "/standing");
    check("L13 GET /standing 200", stResp.status === 200, String(stResp.status));
    const stData = JSON.parse(stResp.body);
    check("L13 standing has nanoB >= 2", stData.standing[nanoB] >= 2, JSON.stringify(stData.standing));
    check("L13 standing asset is XNO", stData.asset === "XNO", String(stData.asset));

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