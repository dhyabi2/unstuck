#!/usr/bin/env node
/** Law B1 - the public board labels operator-posted asks, filters on request, and counts honestly. */
const http = require("http"), fs = require("fs");
const tmpDb = `/tmp/test-board-origin-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;
process.env.NW_OPERATOR_ADDRESSES = "nano_3aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const nw = require("./nserver-persist.js");
const PORT = 4313;
nw.server.listen(PORT);
let failed = 0;
const check = (n, c, d = "") => { if (c) console.log("ok   " + n); else { failed++; console.log("FAIL " + n + " " + d); } };
const get = (path) => new Promise((ok) => http.get({ host: "localhost", port: PORT, path }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok(JSON.parse(b))); }));
(async () => {
  try {
    const st = nw.s;
    const ours = "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";
    const out = "nano_1aw6peq67p69c3wg1dgeoshqtfwd8gpkghms5n9q8ey8k5ns1brfoa8pj7r6";
    const env = process.env.NW_OPERATOR_ADDRESSES;
    const mk = (asker, title, bounty) => st.createAsk({ asker, title, body: "b", bountyRaw: bounty });
    for (const [a, t, b] of [[ours, "ours", "1000000000000000000000000000"], [out, "a real question", "0"],
      [out, "Probe: does the board work", "0"], [env, "env operator", "0"], [out, "paid outside question", "5000000000000000000000000000"]]) {
      try { mk(a, t, b); } catch (e) { console.log("createAsk failed", e.message); failed++; }
    }
    const all = await get("/asks?status=open");
    check("B1 every ask is labelled", all.asks.length > 0 && all.asks.every((a) => a.origin === "independent" || a.origin === "operator"));
    const by = Object.fromEntries(all.asks.map((a) => [a.title, a.origin]));
    check("B1 our address is operator", by["ours"] === "operator", JSON.stringify(by));
    check("B1 env-listed address is operator", by["env operator"] === "operator");
    check("B1 probe title is operator", by["Probe: does the board work"] === "operator");
    check("B1 outsider question is independent", by["a real question"] === "independent");
    check("B1 counts are honest", all.counts.total === 5 && all.counts.independent === 2 && all.counts.operator === 3 && all.counts.independent_with_bounty === 1, JSON.stringify(all.counts));
    const ind = await get("/asks?status=open&origin=independent");
    check("B1 origin=independent hides operator asks", ind.asks.length === 2 && ind.asks.every((a) => a.origin === "independent"));
    check("B1 counts unchanged by the filter", ind.counts.total === 5);
  } finally {
    nw.s.closeDb(); nw.server.close();
    for (const x of ["", "-wal", "-shm"]) { try { fs.unlinkSync(tmpDb + x); } catch (_) {} }
  }
  console.log(failed ? `\n${failed} failed` : "\nall board-origin laws pass");
  process.exit(failed ? 1 : 0);
})();
