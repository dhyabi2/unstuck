#!/usr/bin/env node
/**
 * Test the answerCount exposure in the asks list and detail views (Block 200).
 *
 * Law L80: the asks list endpoint exposes a live answerCount so an outside agent
 * can see the network has answers, while the list does not load full answer
 * bodies for efficiency (answers stays []), and the detail view also carries an
 * answerCount alongside its full answers array.
 *
 * Method: create an ask, add one answer, then assert listAsks() item has
 * answerCount===1 while answers stays [], and getAsk() detail has answerCount===1
 * alongside its real answers array.
 */

const s = require("./network-store.js");

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

// Use a temp database so we don't pollute the dev db
const tmpDb = `/tmp/test-answer-count-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

(async () => {
  try {
    s.resetDb();

    const asker = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
    const answerer = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";

    const a = s.createAsk({
      asker,
      title: "stuck on a schema mismatch",
      body: "two APIs disagree on the field type and I need a third opinion",
      bountyRaw: "1000000000000000000000000",
    });
    check("ask created", a.id > 0, String(a.id));

    // An ask with no answers yet: list answerCount must be 0.
    const emptyList = s.listAsks().find((x) => x.id === a.id);
    check("list answerCount is 0 before any answer",
      emptyList && emptyList.answerCount === 0,
      JSON.stringify(emptyList && { answerCount: emptyList.answerCount }));
    check("list answers stays empty array (bodies not loaded)",
      emptyList && Array.isArray(emptyList.answers) && emptyList.answers.length === 0,
      JSON.stringify(emptyList && emptyList.answers));

    // Add an answer.
    const ans = s.addAnswer(a.id, { answerer, body: "re-normalize to the wider type" });
    check("answer added", ans.answerId > 0, String(ans.answerId));

    // List view must now report answerCount 1 but still not load bodies.
    const listed = s.listAsks({ status: "open" }).find((x) => x.id === a.id);
    check("list answerCount is 1 after one answer",
      listed && listed.answerCount === 1,
      JSON.stringify(listed && { answerCount: listed.answerCount }));
    check("list answers still empty array (no bodies in list view)",
      listed && Array.isArray(listed.answers) && listed.answers.length === 0,
      JSON.stringify(listed && listed.answers));

    // Detail view carries answerCount alongside its full answers array.
    const detail = s.getAsk(a.id);
    check("detail answerCount is 1",
      detail && detail.answerCount === 1,
      JSON.stringify(detail && { answerCount: detail.answerCount }));
    check("detail answers holds the real answer body",
      detail && detail.answers.length === 1 && detail.answers[0].body === "re-normalize to the wider type",
      JSON.stringify(detail && detail.answers));

    // A second answer makes the count 2.
    s.addAnswer(a.id, { answerer: "nano_3she8dp5bamqhbw6tuwq4u9mbfey7e5b9nw4efzqxqj3ekhhrjrpc9qzj67x", body: "also check the response headers" });
    const detail2 = s.getAsk(a.id);
    check("detail answerCount is 2 after second answer",
      detail2 && detail2.answerCount === 2,
      JSON.stringify(detail2 && { answerCount: detail2.answerCount }));

    if (failed === 0) console.log("\nall answerCount laws pass");
    else { console.log(`\n${failed} answerCount assertion(s) FAILED`); process.exit(1); }
  } catch (e) {
    console.log("FAIL test error: " + e.message);
    process.exit(1);
  } finally {
    s.closeDb && s.closeDb();
  }
})();
