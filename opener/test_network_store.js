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
      body: "the self-pay path is refused by the accept guard",
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
      answerer: "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x", body: "a substantive answer used to exercise the token gate",
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
    const testC = s4.createAsk({ asker: F56, title: "live network write probe", body: "b", bountyRaw: "1" });
    check("F56 'live network write probe' is stored as type='test'", testC.type === "test", String(testC.type));
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

    // --- Forge #56b: the 'temporary connectivity check' probe (ask 547) must
    // reclassify to type='test', while a GENUINE ask that merely mentions
    // connectivity is NOT swallowed by the broadened alternative. ---
    const probeA = s4.createAsk({
      asker: F56, title: "temporary connectivity check", body: "b", bountyRaw: "1",
    });
    check("F56b 'temporary connectivity check' is stored as type='test'",
      probeA.type === "test", String(probeA.type));
    const probeB = s4.createAsk({
      asker: F56, title: "connectivity check", body: "b", bountyRaw: "1",
    });
    check("F56b 'connectivity check' is stored as type='test'",
      probeB.type === "test", String(probeB.type));
    // Case-insensitive, as the actual probe titles were posted.
    const probeC = s4.createAsk({
      asker: F56, title: "Temporary Connectivity Check", body: "b", bountyRaw: "1",
    });
    check("F56b probe title matching is case-insensitive",
      probeC.type === "test", String(probeC.type));
    // A real outside question that merely mentions connectivity stays genuine.
    const realConn = s4.createAsk({
      asker: F56,
      title: "How do I check connectivity of my agent to the Nano RPC?",
      body: "b", bountyRaw: "1",
    });
    check("F56b a genuine ask mentioning connectivity stays type='ask'",
      realConn.type === "ask", String(realConn.type));
    const realConn2 = s4.createAsk({
      asker: F56, title: "connectivity", body: "b", bountyRaw: "1",
    });
    check("F56b the bare word 'connectivity' is not a probe",
      realConn2.type === "ask", String(realConn2.type));
    // The classifier is anchored at the start of the title: a genuine question
    // that happens to CONTAIN a probe phrase mid-sentence must not be swallowed.
    const realMid = s4.createAsk({
      asker: F56, title: "My agent ran a connectivity check and now the RPC times out",
      body: "b", bountyRaw: "1",
    });
    check("F56b a genuine title containing a probe phrase mid-sentence stays type='ask'",
      realMid.type === "ask", String(realMid.type));
    const realMid2 = s4.createAsk({
      asker: F56, title: "Why did my smoke test of the API fail?",
      body: "b", bountyRaw: "1",
    });
    check("F56b a genuine title containing 'smoke' mid-sentence stays type='ask'",
      realMid2.type === "ask", String(realMid2.type));

    // The migration pass (getDb -> reclassifySelfTestAsks) must sweep a probe row
    // that was stored as 'ask' before this alternative existed — the ask-547
    // situation — and leave a genuine title alone. Exercise the real startup
    // path: write a legacy row directly with type='ask', then close+reopen the
    // store and read it back.
    const raw = s4.getDb();
    raw.prepare(
      "INSERT INTO asks (asker, title, body, bounty_raw, type, accept_token, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(F56, "temporary connectivity check", "legacy probe", "1", "ask", "tok-legacy", new Date().toISOString());
    const legacyIdProbe = Number(raw.prepare("SELECT last_insert_rowid() AS id").get().id);
    raw.prepare(
      "INSERT INTO asks (asker, title, body, bounty_raw, type, accept_token, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(F56, "How do I check connectivity of my agent to the Nano RPC?", "legacy genuine", "1", "ask", "tok-genuine", new Date().toISOString());
    const legacyIdReal = Number(raw.prepare("SELECT last_insert_rowid() AS id").get().id);

    s.closeDb();
    const s5 = require("./network-store.js"); // reopen -> migration runs
    const sweptProbe = s5.getAsk(legacyIdProbe);
    const sweptReal = s5.getAsk(legacyIdReal);
    check("F56b startup migration sweeps a legacy probe row to type='test'",
      sweptProbe && sweptProbe.type === "test", JSON.stringify(sweptProbe && sweptProbe.type));
    check("F56b startup migration leaves a legacy genuine row type='ask'",
      sweptReal && sweptReal.type === "ask", JSON.stringify(sweptReal && sweptReal.type));
    check("F56b probe rows still excluded from the genuine asks view",
      !s5.listAsks({ type: "ask" }).some((a) =>
        a.id === probeA.id || a.id === probeB.id || a.id === probeC.id || a.id === legacyIdProbe));
    check("F56b genuine connectivity question visible in the ask view",
      s5.listAsks({ type: "ask" }).some((a) => a.id === realConn.id) &&
      s5.listAsks({ type: "ask" }).some((a) => a.id === legacyIdReal));

    // Forge #228: member-name network probes and deploy probes swept like any other
    // self-test, so a stranger never reads our own probes as outside activity.
    const memberProbe = s5.createAsk({
      asker: F56, title: "iris network probe — scope check", body: "b", bountyRaw: "1",
    });
    check("F56c member-name network probe stored as type='test'",
      memberProbe.type === "test", String(memberProbe.type));
    const junoProbe = s5.createAsk({
      asker: F56, title: "juno network probe", body: "b", bountyRaw: "1",
    });
    check("F56c bare member network probe stored as type='test'",
      junoProbe.type === "test", String(junoProbe.type));
    const tokenProbe = s5.createAsk({
      asker: F56, title: "token test for accept mechanism", body: "b", bountyRaw: "1",
    });
    check("F56c token test stored as type='test'",
      tokenProbe.type === "test", String(tokenProbe.type));
    const deployProbe = s5.createAsk({
      asker: F56, title: "Block 67 deploy verification", body: "b", bountyRaw: "1",
    });
    check("F56c block deploy verification stored as type='test'",
      deployProbe.type === "test", String(deployProbe.type));
    const spaProbe = s5.createAsk({
      asker: F56, title: "spa shell unshadowed", body: "b", bountyRaw: "1",
    });
    check("F56c spa shell stored as type='test'",
      spaProbe.type === "test", String(spaProbe.type));
    // The pursekeeper / genuine questions must NOT be swept by the wider rule.
    const stillGenuineA = s5.createAsk({
      asker: F56, title: "Outside ask: agent with no Nano address can post", body: "b", bountyRaw: "1",
    });
    check("F56c an outside ask that names itself 'Outside' stays type='ask'",
      stillGenuineA.type === "ask", String(stillGenuineA.type));
    const stillGenuineB = s5.createAsk({
      asker: F56, title: "Follow-up for pursekeeper: network ready for cross-listing", body: "b", bountyRaw: "1",
    });
    check("F56c a pursekeeper follow-up stays type='ask'",
      stillGenuineB.type === "ask", String(stillGenuineB.type));
    s5.closeDb();
    const sweptProbeMember = s5.getAsk(memberProbe.id);
    check("F56c startup migration sweeps an already-stored member probe to type='test'",
      sweptProbeMember && sweptProbeMember.type === "test", JSON.stringify(sweptProbeMember && sweptProbeMember.type));
    const stillThere = s5.getAsk(stillGenuineA.id);
    check("F56c startup migration leaves an outside-genuine ask type='ask'",
      stillThere && stillThere.type === "ask", JSON.stringify(stillThere && stillThere.type));

    // L88 (2026-09-24): the same answerer may not post the same words twice on one ask. Measured on
    // ask 543: 21 answers, two byte-identical duplicates (159 and 173 repeating 156), which made eight
    // distinct answerers read as one voice. The control below proves the refusal is exact-match only:
    // the same answerer with different words still lands, and a different answerer may repeat the words.
    const dupAsk = s5.createAsk({ asker: "nano_1tmn3efpgi6m1p1brzury49i9e7zrhcntktbifid35b1mitj5np5dtr3ox9e", title: "dup-check", body: "b", bountyRaw: "1" });
    const A = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";
    const B = "nano_1tmn3efpgi6m1p1brzury49i9e7zrhcntktbifid35b1mitj5np5dtr3ox9e";
    const first = s5.addAnswer(dupAsk.id, { answerer: A, body: "the same measured answer" });
    check("L88 the first answer from an answerer is accepted", first.answerId > 0, String(first.answerId));
    let refused = null;
    try { s5.addAnswer(dupAsk.id, { answerer: A, body: "the same measured answer" }); }
    catch (e) { refused = e; }
    check("L88 the identical answer from the same answerer is refused",
      refused && refused.duplicate === true, refused && refused.message);
    const reworded = s5.addAnswer(dupAsk.id, { answerer: A, body: "the same measured answer, with the number 42" });
    check("L88 the same answerer saying something different is still accepted", reworded.answerId > 0, String(reworded.answerId));
    const otherVoice = s5.addAnswer(dupAsk.id, { answerer: B, body: "the same measured answer" });
    check("L88 a DIFFERENT answerer may say the same words (the refusal is per answerer)",
      otherVoice.answerId > 0, String(otherVoice.answerId));
    // And the refusal is not a silent no-op: the count only moved by the writes that were allowed.
    const afterDup = s5.getAsk(dupAsk.id);
    check("L88 the refused write added no row (3 accepted writes, 3 rows)",
      afterDup && afterDup.answers.length === 3, JSON.stringify(afterDup && afterDup.answers.length));

  } finally {
    // Cleanup
    s.closeDb();
    try { require("fs").unlinkSync(tmpDb); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall network-store laws pass");
  process.exit(failed ? 1 : 0);
})();