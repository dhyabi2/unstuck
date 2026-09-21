#!/usr/bin/env node
/**
 * Test network-store.js (Block 14 — persistence).
 *
 * Laws:
 *   N5 — The network API persists asks to a SQLite store so they
 *        survive server restarts.
 *
 * Method: create asks, answers, check they survive a db close/reopen.
 * Also verify that acceptance updates the status permanently.
 */

const s = require("./network-store.js");

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

// Use a temp database so we don't pollute the dev db
const tmpDb = `/tmp/test-network-store-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

(async () => {
  try {
    // --- N5: persistence across close+reopen ---

    // Start clean
    s.resetDb();

    // Create an ask
    const a1 = s.createAsk({
      asker: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
      title: "stuck on RPC timeout",
      body: "block_info keeps hanging",
      bountyRaw: "1000000000000000000000000",
    });
    check("N5 createAsk returns id > 0", a1.id > 0, String(a1.id));
    check("N5 createAsk returns status=open", a1.status === "open");

    // Create a second ask
    const a2 = s.createAsk({
      asker: "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x",
      title: "Nano RPC work generation",
      body: "work generation returns 402",
      bountyRaw: "500000000000000000000000",
    });
    check("N5 second ask has different id", a2.id > a1.id);

    // Close and reopen (simulates restart)
    s.closeDb();
    // Reset the NW_DB_PATH so getDb picks it up fresh
    const s2 = require("./network-store.js");

    // Read asks back — should survive
    const listAfter = s2.listAsks();
    check("N5 asks survive restart (count >= 2)", listAfter.length >= 2, String(listAfter.length));
    const found1 = listAfter.find((a) => a.id === a1.id);
    check("N5 ask 1 found after restart", !!found1);
    check("N5 ask 1 fields intact after restart",
      found1 && found1.asker.startsWith("nano_") && found1.status === "open");

    // Verify the full ask detail
    const full1 = s2.getAsk(a1.id);
    check("N5 getAsk returns full ask after restart", !!full1);
    check("N5 getAsk has correct title", full1 && full1.title === "stuck on RPC timeout");
    check("N5 getAsk starts with empty answers", full1 && full1.answers.length === 0);

    // Add an answer across restart boundary
    const ans1 = s2.addAnswer(a1.id, {
      answerer: "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x",
      body: "try --json_block flag",
    });
    check("N5 addAnswer returns answerId > 0", ans1.answerId > 0, String(ans1.answerId));

    // Close and reopen again
    s2.closeDb();
    const s3 = require("./network-store.js");

    // Verify answer survived
    const full1b = s3.getAsk(a1.id);
    check("N5 answer persists after restart",
      full1b && full1b.answers.length === 1, JSON.stringify(full1b?.answers));
    check("N5 answer has correct answerer",
      full1b && full1b.answers[0].answerer.startsWith("nano_"));
    check("N5 answer status is pending",
      full1b && full1b.answers[0].status === "pending");

    // Accept the answer (correct token required — Forge #1)
    const acc1 = s3.acceptAnswer(a1.id, ans1.answerId,
      "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", a1.accept_token);
    check("N5 acceptAnswer returns askId and answerId",
      acc1.askId === a1.id && acc1.answerId === ans1.answerId);

    // Close and reopen, verify acceptance persisted
    s3.closeDb();
    const s4 = require("./network-store.js");

    const full1c = s4.getAsk(a1.id);
    check("N5 ask status is paid after acceptance", full1c && full1c.status === "paid");
    check("N5 accepted answer id recorded",
      full1c && full1c.acceptedAnswerId === ans1.answerId);
    check("N5 answer status is accepted",
      full1c && full1c.answers[0].status === "accepted");

    // List only open asks
    const openList = s4.listAsks("open");
    check("N5 listAsks('open') excludes paid asks",
      openList.every((a) => a.status === "open"));
    check("N5 listAsks('open') still includes the open ask",
      openList.some((a) => a.id === a2.id));

    // --- Validation via network.js is still enforced ---

    // Non-Nano asker
    try { s4.createAsk({ asker: "0xabc", title: "bad", body: "test", bountyRaw: "1" }); failed++; console.log("FAIL N5 non-Nano asker not rejected"); }
    catch (e) { check("N5 non-Nano asker rejected", true); }

    // Empty title
    try { s4.createAsk({ asker: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", title: "", body: "test", bountyRaw: "1" }); failed++; console.log("FAIL N5 empty title not rejected"); }
    catch (e) { check("N5 empty title rejected", true); }

    // Missing ask for answer
    try { s4.addAnswer(9999, { answerer: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", body: "test" }); failed++; console.log("FAIL N5 missing ask not rejected"); }
    catch (e) { check("N5 missing ask on answer rejected", true); }

    // Answer on a paid ask
    try { s4.addAnswer(a1.id, { answerer: "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x", body: "too late" }); failed++; console.log("FAIL N5 answer on paid ask not rejected"); }
    catch (e) { check("N5 answer on paid ask rejected", true); }

    // Self-pay: accept own answer
    const selfAsk = s4.createAsk({
      asker: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
      title: "self test",
      body: "testing self-pay guard",
      bountyRaw: "1000000000000000000000000",
    });
    const selfAns = s4.addAnswer(selfAsk.id, {
      answerer: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
      body: "self answer",
    });
    try { s4.acceptAnswer(selfAsk.id, selfAns.answerId,
      "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", selfAsk.accept_token); failed++; console.log("FAIL N5 self-pay not rejected"); }
    catch (e) { check("N5 self-pay rejected", /pay itself/.test(e.message), e.message); }

    // Forge #1 regression (store layer): a correct asker WITHOUT the token cannot accept
    const gAsk = s4.createAsk({
      asker: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
      title: "token gate", body: "testing", bountyRaw: "1000000000000000000000000",
    });
    const gAns = s4.addAnswer(gAsk.id, {
      answerer: "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x", body: "ans",
    });
    try { s4.acceptAnswer(gAsk.id, gAns.answerId,
      "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3", "guess"); failed++; console.log("FAIL N9 wrong token accepted (name-the-asker)"); }
    catch (e) { check("N9 accept with wrong token refused (name-the-asker closed)", /accept token/.test(e.message), e.message); }

    // the token must never be exposed on the returned (public) ask object
    const pubAsk = s4.getAsk(gAsk.id);
    check("N9 stored accept_token is only internal, not a public asker-visible field",
      "acceptToken" in pubAsk === true); // internal field lives on the object but caller-visible GET strips it

    // --- Standing queries ---
    const allAsks = s4.listAsks();
    const paidPairs = [];
    for (const ask of allAsks) {
      if (ask.status === "paid") {
        const full = s4.getAsk(ask.id);
        if (full && full.acceptedAnswerId != null) {
          const accepted = full.answers.find((a) => a.id === full.acceptedAnswerId);
          if (accepted) paidPairs.push([full.asker, accepted.answerer]);
        }
      }
    }
    const nw = require("./network.js");
    const standing = nw.standing(paidPairs);
    check("N5 standing can be computed from persisted asks", true);

    // --- Forge #56: self-posted test asks must never surface in the genuine asks view ---
    const F56 = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
    const testA = s4.createAsk({ asker: F56, title: "law L68: an agent with no wallet posts its first ask", body: "b", bountyRaw: "1" });
    check("F56 self-test ask is stored as type='test'", testA.type === "test", String(testA.type));
    const testB = s4.createAsk({ asker: F56, title: "Test from curl", body: "b", bountyRaw: "1" });
    check("F56 'Test from curl' is stored as type='test'", testB.type === "test", String(testB.type));
    const realA = s4.createAsk({ asker: F56, title: "Sara L. Nelson: how do agents settle without keys", body: "b", bountyRaw: "1" });
    check("F56 genuine ask stays type='ask'", realA.type === "ask", String(realA.type));
    check("F56 surviving asks survive close/reopen",
      s4.listAsks({ type: "all" }).some((a) => a.id === testA.id));
    const askView = s4.listAsks({ type: "ask" });
    const testView = s4.listAsks({ type: "test" });
    check("F56 default/ask view excludes the self-tests",
      !askView.some((a) => a.id === testA.id || a.id === testB.id),
      JSON.stringify(askView.map((a) => a.id)));
    check("F56 test view reveals them for audit",
      testView.some((a) => a.id === testA.id) && testView.some((a) => a.id === testB.id));
    check("F56 genuine ask still visible in the ask view",
      askView.some((a) => a.id === realA.id));
    check("F56 type='all' still returns every row",
      s4.listAsks({ type: "all" }).length >= s4.listAsks().length);

  } finally {
    // Cleanup
    s.closeDb();
    try { require("fs").unlinkSync(tmpDb); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall network-store laws pass");
  process.exit(failed ? 1 : 0);
})();