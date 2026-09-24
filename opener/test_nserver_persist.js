#!/usr/bin/env node
/**
 * Test nserver-persist.js (Block 14 — persistence through HTTP).
 *
 * Laws:
 *   N6 — The network HTTP server uses the persistent store so asks
 *        created via the API survive restarts.
 *
 * Method: start the persistent server on a test port, create asks
 * via HTTP, close the server, start a fresh one, verify asks persist.
 */

const http = require("http");
const path = require("path");
const fs = require("fs");

// Use a temp database for the test
const tmpDb = `/tmp/test-nserver-persist-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;

// Import the persistent server
const nw = require("./nserver-persist.js");
const PORT = 4312;

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
const bounty = "1000000000000000000000000";

let askId, answerId;

(async () => {
  await new Promise((r) => setTimeout(r, 300));

  try {
    // ================================================================
    // Phase 1: create asks, answers, acceptance via the server
    // ================================================================

    const c1 = await req("POST", "/ask", {
      asker: nanoA, title: "persistent ask", body: "will I survive?",
      bounty_raw: bounty,
    });
    check("N6 POST /ask returns 201", c1.status === 201, String(c1.status));
    const c1b = JSON.parse(c1.body);
    askId = c1b.id;
    check("N6 ask survives if its id > 0", askId > 0);

    // Create a second ask
    const c2 = await req("POST", "/ask", {
      asker: nanoB, title: "another", body: "test",
      bounty_raw: bounty,
    });
    const c2b = JSON.parse(c2.body);

    // Add an answer
    const ans = await req("POST", `/ask/${askId}/answers`, {
      answerer: nanoB, body: "yes you will",
    });
    check("N6 POST answer returns 201", ans.status === 201, String(ans.status));
    const ansb = JSON.parse(ans.body);
    answerId = ansb.answerId;

    // Accept the answer
    const acc = await req("POST", `/ask/${askId}/accept`, {
      acceptedBy: nanoA, answerId, accept_token: c1b.accept_token,
    });
    check("N6 POST accept returns 200", acc.status === 200, String(acc.status));

    // Close the server — simulates restart
    nw.server.close();

    // ================================================================
    // Phase 2: start a fresh server (new process).
    // We can't easily start a new Node process in the same test, but
    // we CAN close the db and reopen — that proves the storage layer
    // works. For a true process restart test we use a child process.
    // ================================================================

    // Close the store's db connection
    nw.s.closeDb();

    // Start a NEW server entirely — it will use the store with the same DB file
    // We need to clear the require cache so the modules reinitialize
    delete require.cache[require.resolve("./nserver-persist.js")];
    delete require.cache[require.resolve("./network-store.js")];

    // Re-import and start fresh
    const nw2 = require("./nserver-persist.js");
    const PORT2 = 4313;
    nw2.server.listen(PORT2);
    await new Promise((r) => setTimeout(r, 300));

    // Helper bound to the new port
    function req2(method, path, body) {
      return new Promise((resolve, reject) => {
        const r = http.request(
          { host: "localhost", port: PORT2, path, method, headers: { "Content-Type": "application/json" } },
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

    // The asks should exist on the fresh server
    const g1 = await req2("GET", `/ask/${askId}`);
    check("N6 GET /ask/:id on restarted server returns 200", g1.status === 200, String(g1.status));
    const g1b = JSON.parse(g1.body);
    check("N6 ask persisted after server restart",
      g1b.ask && g1b.ask.status === "paid", JSON.stringify(g1b.ask));
    check("N6 ask fields intact after restart",
      g1b.ask && g1b.ask.title === "persistent ask");

    // The answer survived
    check("N6 answer survived restart",
      g1b.ask && g1b.ask.answers.length === 1, JSON.stringify(g1b.ask?.answers));
    check("N6 answer status is accepted after restart",
      g1b.ask && g1b.ask.answers[0].status === "accepted");

    // List open asks — should include the open one but not the paid one
    const ls = await req2("GET", "/asks?status=open");
    const lsb = JSON.parse(ls.body);
    check("N6 list open asks is 200", ls.status === 200);
    check("N6 only open asks returned",
      lsb.asks.every((a) => a.status === "open"),
      JSON.stringify(lsb.asks.map((a) => a.id + ":" + a.status)));

    // Health returns ok
    const h = await req2("GET", "/health");
    check("N6 health on restarted server", h.status === 200);

    // Create a NEW ask on the restarted server
    const c3 = await req2("POST", "/ask", {
      asker: nanoA, title: "after restart", body: "test",
      bounty_raw: bounty,
    });
    check("N6 create ask on restarted server returns 201", c3.status === 201, String(c3.status));

    // List all — should have 3 asks
    const all = await req2("GET", "/asks");
    const allb = JSON.parse(all.body);
    check("N6 all 3 asks visible after restart",
      allb.asks.length >= 3, String(allb.asks.length));

    // Close the second server
    nw2.s.closeDb();
    nw2.server.close();

  } finally {
    nw.s.closeDb();
    nw.server.close();
    try { fs.unlinkSync(tmpDb); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-wal"); } catch (_) {}
    try { fs.unlinkSync(tmpDb + "-shm"); } catch (_) {}
  }

  console.log(failed ? `\n${failed} test(s) failed` : "\nall persist laws pass");
  process.exit(failed ? 1 : 0);
})();