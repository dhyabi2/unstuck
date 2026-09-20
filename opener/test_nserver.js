#!/usr/bin/env node
/**
 * Test nserver.js (Block 13 — network HTTP API).
 *
 * Laws:
 *   N3 — The network API server exposes ask lifecycle endpoints (POST /ask,
 *        GET /asks, GET /ask/:id, POST /ask/:id/answers, POST /ask/:id/accept)
 *        that create and retrieve asks via the network.js domain model.
 *   N4 — The API refuses invalid boundary actions at the HTTP level, returning
 *        400 for a bad asker or a self-accept, and 404 for a missing ask.
 *
 * Method: start the server on a test port, issue real HTTP requests, check
 * the status codes and response bodies.
 */

const http = require("http");
const n = require("./network.js");

// Import the server but DON'T let it auto-listen — start on a test port
const nw = require("./nserver.js");
const PORT = 4311;

nw.server.listen(PORT);

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail ? ": " + detail : ""}`); }
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json" } },
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

const nanoA = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const nanoB = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";
const bounty = "1000000000000000000000000"; // 0.000001 XNO

let askId, answerId;

(async () => {
  // Wait a moment for the server to be ready
  await new Promise((r) => setTimeout(r, 300));

  try {
    // ================================================================
    // N3 — create, list, and retrieve asks
    // ================================================================

    const c1 = await req("POST", "/ask", {
      asker: nanoA, title: "stuck on RPC timeout", body: "block_info keeps hanging",
      bounty_raw: bounty,
    });
    check("N3 POST /ask returns 201", c1.status === 201, String(c1.status));
    const c1b = JSON.parse(c1.body);
    check("N3 POST /ask body has id and status=open", c1b.id > 0 && c1b.status === "open", c1.body);
    check("N9 POST /ask returns a one-time accept_token", typeof c1b.accept_token === "string" && c1b.accept_token.length > 0, c1.body);
    askId = c1b.id;
    const acceptToken = c1b.accept_token;

    const ls = await req("GET", "/asks");
    check("N3 GET /asks returns 200", ls.status === 200, String(ls.status));
    const lsb = JSON.parse(ls.body);
    check("N3 GET /asks returns non-empty array", Array.isArray(lsb.asks) && lsb.asks.length > 0);
    check("N3 GET /asks includes the created ask", lsb.asks.some((a) => a.id === askId));

    const g1 = await req("GET", `/ask/${askId}`);
    check("N3 GET /ask/:id returns 200", g1.status === 200, String(g1.status));
    const g1b = JSON.parse(g1.body);
    check("N3 GET /ask/:id returns the ask with correct fields",
      g1b.ask.asker === nanoA && g1b.ask.status === "open");
    check("N9 GET /ask/:id never leaks the accept_token",
      !("acceptToken" in g1b.ask) && !("accept_token" in g1b.ask), g1.body);

    // Health
    const h = await req("GET", "/health");
    check("N3 GET /health returns 200", h.status === 200, String(h.status));
    const hb = JSON.parse(h.body);
    check("N3 /health reports bounty_asset XNO", hb.bounty_asset === "XNO");

    // ================================================================
    // Add an answer via the API
    // ================================================================

    const ans1 = await req("POST", `/ask/${askId}/answers`, {
      answerer: nanoB, body: "try --json_block flag",
    });
    check("N3 POST /ask/:id/answers returns 201", ans1.status === 201, String(ans1.status));
    const ans1b = JSON.parse(ans1.body);
    check("N3 answer response has askId and answerId",
      ans1b.askId === askId && ans1b.answerId > 0);
    answerId = ans1b.answerId;

    // Verify answer is visible on the ask
    const g2 = await req("GET", `/ask/${askId}`);
    const g2b = JSON.parse(g2.body);
    check("N3 answer appears on the ask",
      g2b.ask.answers.length === 1 && g2b.ask.answers[0].answerer === nanoB);

    // ================================================================
    // Accept an answer via the API
    // ================================================================

    // Forge #1 regression: someone who knows the asker's address but NOT the one-time
    // accept token cannot accept — this is the 'name the asker' bypass, now closed.
    const forge = await req("POST", `/ask/${askId}/accept`, {
      acceptedBy: nanoA, answerId, accept_token: "attacker-guesses",
    });
    check("N9 accept without the correct token returns 403 (name-the-asker closed)",
      forge.status === 403, String(forge.status));
    // hardens the check: even a missing token is refused, not silently allowed
    const forge2 = await req("POST", `/ask/${askId}/accept`, {
      acceptedBy: nanoA, answerId,
    });
    check("N9 accept with no token returns 403", forge2.status === 403, String(forge2.status));

    const acc1 = await req("POST", `/ask/${askId}/accept`, {
      acceptedBy: nanoA, answerId, accept_token: acceptToken,
    });
    check("N3 POST /ask/:id/accept returns 200", acc1.status === 200, String(acc1.status));
    const acc1b = JSON.parse(acc1.body);
    check("N3 accept response has askId and answerId",
      acc1b.askId === askId && acc1b.answerId === answerId);

    // Verify the ask is now paid
    const g3 = await req("GET", `/ask/${askId}`);
    const g3b = JSON.parse(g3.body);
    check("N3 ask is paid after acceptance", g3b.ask.status === "paid");
    check("N3 accepted answer has status accepted",
      g3b.ask.answers[0].status === "accepted");

    // ================================================================
    // N4 — refusals at the HTTP boundary
    // ================================================================

    // Create an ask without a bounty for the "cannot be paid" test later
    const cNo = await req("POST", "/ask", {
      asker: nanoA, title: "no bounty", body: "testing",
    });
    const cNoB = JSON.parse(cNo.body);
    const noBountyId = cNoB.id;

    // non-Nano asker
    const bad = await req("POST", "/ask", {
      asker: "0xabc", title: "bad", body: "test",
    });
    check("N4 non-Nano asker returns 400", bad.status === 400, String(bad.status));

    // Missing ask
    const miss = await req("GET", "/ask/9999");
    check("N4 missing ask returns 404", miss.status === 404, String(miss.status));
    const missB = JSON.parse(miss.body);
    check("N4 missing ask error mentions no ask", /no ask/.test(missB.error || ""));

    // Self-pay guard — needs a FRESH open+funded ask, because the earlier ask
    // (askId) is already paid and would 400 for the wrong reason (not open).
    const cSelf = await req("POST", "/ask", {
      asker: nanoA, title: "self pay", body: "testing", bounty_raw: bounty,
    });
    const selfId = JSON.parse(cSelf.body).id;
    const selfTok = JSON.parse(cSelf.body).accept_token;
    const sa = await req("POST", `/ask/${selfId}/answers`, {
      answerer: nanoA, body: "self answer attempt",
    });
    const saId = JSON.parse(sa.body).answerId;
    const sp = await req("POST", `/ask/${selfId}/accept`, {
      acceptedBy: nanoA, answerId: saId, accept_token: selfTok,
    });
    check("N4 self-pay returns 400", sp.status === 400, String(sp.status));
    const spB = JSON.parse(sp.body);
    check("N4 self-pay error mentions cannot pay itself", /pay itself/.test(spB.error || ""));

    // Answer on a non-open ask (it's already paid)
    const closedAns = await req("POST", `/ask/${askId}/answers`, {
      answerer: nanoB, body: "too late",
    });
    check("N4 answer on a paid ask returns 400", closedAns.status === 400, String(closedAns.status));

    // An ask with no bounty cannot be accepted as paid
    const noBountyTok = JSON.parse(cNo.body).accept_token;
    const noAns = await req("POST", `/ask/${noBountyId}/answers`, {
      answerer: nanoB, body: "an answer",
    });
    const noAnsId = JSON.parse(noAns.body).answerId;
    const noAcc = await req("POST", `/ask/${noBountyId}/accept`, {
      acceptedBy: nanoA, answerId: noAnsId, accept_token: noBountyTok,
    });
    check("N4 no-bounty ask accept returns 400", noAcc.status === 400, String(noAcc.status));

    // 404 for missing answer on accept — use a fresh open+funded ask so the
    // "no bounty" guard doesn't fire first (400) and mask the missing answer.
    const cFund = await req("POST", "/ask", {
      asker: nanoA, title: "funded", body: "testing", bounty_raw: bounty,
    });
    const fundId = JSON.parse(cFund.body).id;
    const fundTok = JSON.parse(cFund.body).accept_token;
    const badAns = await req("POST", `/ask/${fundId}/accept`, {
      acceptedBy: nanoA, answerId: 9999, accept_token: fundTok,
    });
    check("N4 missing answer on accept returns 404", badAns.status === 404, String(badAns.status));

  } finally {
    nw.server.close();
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall nserver laws pass");
  process.exit(failed ? 1 : 0);
})();
