#!/usr/bin/env node
/**
 * test_onramp.js — Block 41 laws.
 *
 * L29 — GET /asks with no type filter returns only genuine asks (type='ask'), newest
 *       first; rows of other types are returned only when explicitly requested.
 *       An outside agent's first call is `GET /asks`. Before this law it answered with
 *       449 closed self-posted 'welcome' rows and buried the questions.
 *
 * L30 — The network serves GET /try-nano (and /v1/onramp) at HTTP 200 with no auth:
 *       a document an agent that has never heard of Nano can act on, naming the swap
 *       path, the 0.00001 XNO opener, and how to get an address. JSON by default, HTML
 *       for a browser.
 *
 * L83 (minted with L84) — The on-ramp's swap section may not claim a service carries a pair it does not.
 *        Measured 2026-09-23: nanswap carries DOGE/BTC/ETH/XMR/SOL/BNB/USDT/USD/EUR/GBP/
 *        Banano/DogeNano and NO USDC pair (nanswap.com/swap/USDC/XNO is 404 while
 *        /swap/ETH/XNO is 200), so the sentence "swap USDC into XNO on nanswap" was
 *        sending every USDC-holding agent to a service that cannot serve its rail. The
 *        document must state which pairs the service carries, state plainly that USDC is
 *        not one of them, give at least one route for the USDC leg, carry the date of the
 *        measurement, and never publish the old sentence again.
 *
 * Usage: node test_onramp.js [--only=L29|L30|L54|L83]
 *
 * Runs from the repo root. Uses random ports so a sandboxed mutation run cannot
 * collide with the live server on 4310 or with a parallel mutant.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// The law was written under the working name L101 and minted in the repo ledger as L83
// (with L84 as its second clause), so the ledger's recorded test string says --only=L101.
// Accept both names rather than publish a test command that proves nothing.
const ONLY_RAW = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null;
const ONLY = ONLY_RAW === "L101" ? "L83" : ONLY_RAW;

const tmpDb = `/tmp/test-onramp-${process.pid}-${Date.now()}.db`;
process.env.NW_DB_PATH = tmpDb;
process.env.UNSTUCK_ACCOUNT = "nano_1434j1n4sin4cefs5njibag4tsmo596fmg3s6bdogtod3ndmdfez5yuebrh9";

// Resolve the repo root from this file's own location, so the same command works
// from any cwd and from a sandbox copy (mutation checks run the oracle with cwd=root).
const REPO_ROOT = path.join(__dirname, "..");
const nw = require(path.join(REPO_ROOT, "opener/nserver-persist.js"));
const PORT = 4000 + (process.pid % 1000);
nw.server.listen(PORT);

const nanoA = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const nanoB = "nano_3yo6rq85c1agb5ynn69fnmxi4y9bpct8ju1emcuc4ajx5t3o3z69i1kx847x";

let failed = 0;
const groups = { L29: [], L30: [], L54: [], L83: [] };
function check(law, name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failed++;
  groups[law].push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} [${law}] ${name}${ok ? "" : detail ? ": " + detail : ""}`);
}

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path: p, method, headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, body: data, type: res.headers["content-type"] || "" }));
      }
    );
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  try {
    // ---------------------------------------------------------------
    // Fixtures: one genuine question, one broadcast welcome row.
    // ---------------------------------------------------------------
    const g = await req("POST", "/ask", {
      asker: nanoA, title: "genuine question", body: "how do I X?", bounty_raw: "1000", type: "ask",
    });
    check("L29", "POST /ask (type=ask) returns 201", g.status === 201, String(g.status));
    const genuineId = JSON.parse(g.body).id;

    const w = await req("POST", "/ask", {
      asker: nanoA, title: "Welcome SomeAgent — try Nano", body: "broadcast", bounty_raw: "0", type: "welcome",
    });
    check("L29", "POST /ask (type=welcome) returns 201", w.status === 201, String(w.status));

    // ---------------------------------------------------------------
    // L29 — default listing is genuine asks only; history reachable.
    // ---------------------------------------------------------------
    const def = await req("GET", "/asks");
    const defBody = JSON.parse(def.body);
    check("L29", "GET /asks returns 200", def.status === 200, String(def.status));
    check("L29", "default listing contains NO welcome rows",
      defBody.asks.every((a) => (a.type || "ask") === "ask"),
      JSON.stringify(defBody.asks.map((a) => a.type)));
    check("L29", "default listing contains the genuine ask",
      defBody.asks.some((a) => a.id === genuineId));
    check("L29", "default listing is newest first",
      defBody.asks.every((a, i, arr) => i === 0 || arr[i - 1].id > a.id),
      JSON.stringify(defBody.asks.map((a) => a.id)));

    const wel = await req("GET", "/asks?type=welcome");
    const welBody = JSON.parse(wel.body);
    check("L29", "?type=welcome returns the welcome history", welBody.asks.length === 1 && welBody.asks[0].type === "welcome",
      JSON.stringify(welBody.asks.map((a) => a.id + ":" + a.type)));

    const all = await req("GET", "/asks?type=all");
    const allBody = JSON.parse(all.body);
    check("L29", "?type=all returns every row (history preserved, not deleted)",
      allBody.asks.length === 2, String(allBody.asks.length));

    // ---------------------------------------------------------------
    // L30 — the on-ramp document.
    // ---------------------------------------------------------------
    const r = await req("GET", "/try-nano", null, { Accept: "application/json" });
    check("L30", "GET /try-nano returns 200 with no auth", r.status === 200, String(r.status));
    let doc = null;
    try { doc = JSON.parse(r.body); } catch (e) { /* handled below */ }
    check("L30", "GET /try-nano returns JSON for an agent", !!doc, r.body.slice(0, 120));
    if (doc) {
      check("L30", "on-ramp names the asset pair and the service it swaps on",
        doc.swap && doc.swap.from === "USDC" && doc.swap.to === "XNO" && /nanswap\.com/.test(doc.swap.url),
        JSON.stringify(doc.swap));
      check("L30", "on-ramp states the 0.00001 XNO opener and its raw value",
        doc.starter && doc.starter.xno === "0.00001" && doc.starter.raw === "10000000000000000000000000",
        JSON.stringify(doc.starter));
      check("L30", "on-ramp names the opener account it will send from",
        /^nano_[13][0-9a-zA-Z]{59}$/.test(String(doc.opener_address)), String(doc.opener_address));
      check("L30", "on-ramp is XNO-only and says so", doc.asset === "XNO" && /nothing else/.test(doc.asset_only || ""));
      check("L30", "on-ramp gives an agent actionable steps (>=4)",
        Array.isArray(doc.steps) && doc.steps.length >= 4, JSON.stringify(doc.steps && doc.steps.length));
      check("L30", "every step names an action", (doc.steps || []).every((s) => s.do && s.how));

      // ---------------------------------------------------------------
      // L83 — the swap section is measured, not asserted.
      // ---------------------------------------------------------------
      const sw = doc.swap || {};
      const whole = JSON.stringify(doc);
      check("L83", "the document no longer says 'swap USDC into XNO on nanswap'",
        !/USDC into XNO on nanswap/i.test(whole), "the old sentence is still published");
      check("L83", "the swap section states which pairs the service carries",
        Array.isArray(sw.pairs_carried) && sw.pairs_carried.length >= 5, JSON.stringify(sw.pairs_carried));
      check("L83", "the swap section states USDC is NOT one of them",
        Array.isArray(sw.pairs_not_carried) && sw.pairs_not_carried.includes("USDC"),
        JSON.stringify(sw.pairs_not_carried));
      check("L83", "the swap section gives at least one route for the USDC leg",
        Array.isArray(sw.routes) && sw.routes.length >= 1 && sw.routes.every((r) => /^https:\/\//.test(r.url || "")),
        JSON.stringify(sw.routes));
      check("L83", "the swap section carries the date the pair list was measured",
        /^\d{4}-\d{2}-\d{2}$/.test(String(sw.measured_at || "")), String(sw.measured_at));
      check("L83", "no route for the USDC leg points at nanswap's USDC pair (it does not exist)",
        (sw.routes || []).every((r) => !/nanswap\.com\/swap\/USDC/i.test(r.url || "")),
        JSON.stringify((sw.routes || []).map((r) => r.url)));
      check("L83", "the swap section states the reverse direction, so a balance is convertible back",
        !!sw.reverse && /XNO/.test(sw.reverse.what || "") && /^https:\/\//.test(sw.reverse.url || ""),
        JSON.stringify(sw.reverse));
      const s4 = (doc.steps || []).find((s) => /USDC into XNO|USDC .*XNO/i.test(s.do || ""));
      check("L83", "step 4 names a route that actually carries USDC, and says so in its own text",
        !!s4 && Array.isArray(s4.routes) && s4.routes.length >= 1 && /no USDC|does not carry/i.test(s4.how || ""),
        JSON.stringify(s4 && { do: s4.do, url: s4.url }));

      // ---------------------------------------------------------------
      // L83 clause 2 (L84) — the outreach templates an agent actually reads
      // must not ship the measured-false sentence. The /try-nano doc is
      // guarded above, but the first-contact copy in opener/ and the docs
      // were the exact place the false claim kept shipping (beacon #259).
      // Scan the template/draft files on disk and refuse the sentence that
      // tells a USDC holder to "swap USDC into XNO at nanswap" as a direct
      // step, because nanswap carries no USDC pair.
      // ---------------------------------------------------------------
      const FORBIDDEN = /\bswap(?:ping)?\s+USDC\s+(?:into|for|to)\s+XNO\s+(?:at|on|via)\s+nanswap/i;
      const TEMPLATE_FILES = [
        "opener/primitive-mail.js",
        "opener/csvhelper-open-msg.txt",
        "opener/bridge-invite.js",
        "opener/address-only.py",
        "opener/seed-answers-2.js",
        "opener/scan-replied-conversations.js",
        "opener/anp2-reply.py",
        "opener/anp2-join.py",
        "opener/speedbot-oracle-webhook-post.py",
        "opener/speedbot-topic-step-20260920.py",
        "docs/nano-for-usdc-agents.md",
        "docs/nano-for-task-relays.md",
        "doc/nano-vs-usdc.md",
      ];
      const offending = TEMPLATE_FILES.filter((f) => {
        const p = path.join(REPO_ROOT, f);
        if (!fs.existsSync(p)) return false;
        return FORBIDDEN.test(fs.readFileSync(p, "utf8"));
      });
      check("L83", "no outreach template tells a USDC holder to swap USDC 'at/on nanswap' directly",
        offending.length === 0,
        offending.length ? "still carries the false sentence: " + offending.join(", ") : "all templates clean");
    }

    // ---------------------------------------------------------------
    // L54 — the on-ramp's step 1 is runnable, not research.
    //
    // The measured rate-limiting step is "an outside agent must hold a Nano
    // address". Step 1 used to say "use any Nano wallet or the nanocurrency
    // library", which makes the agent go and find a package first. This law
    // proves the on-ramp instead ships a command that runs on the python3 the
    // agent already has, and that the command actually yields a valid address.
    // ---------------------------------------------------------------
    const s1 = (doc && doc.steps || []).find((s) => /get a Nano address/i.test(s.do || ""));
    check("L54", "the on-ramp has a 'get a Nano address' step", !!s1);
    if (s1) {
      check("L54", "the address step carries a runnable command", typeof s1.command === "string" && s1.command.length > 50);
      check("L54", "the command needs no package install",
        /python3/.test(s1.command) && !/\b(pip|npm|yarn|pnpm|apt-get|go get|cargo)\b/.test(s1.command),
        s1.command.slice(0, 80));
      check("L54", "the step does not leave the agent to source a library itself",
        !/or the `?nanocurrency`? library/i.test(s1.how || ""), s1.how);

      // Run it, and check the address it prints with the independent keygen.
      const { execFileSync } = require("child_process");
      let printed = "";
      let ran = true;
      try {
        printed = execFileSync("bash", ["-c", s1.command], { encoding: "utf8", timeout: 60000 }).trim();
      } catch (e) {
        ran = false;
        printed = String(e.message).slice(0, 200);
      }
      check("L54", "the on-ramp command runs and prints an address", ran && /^nano_[13][0-9a-zA-Z]{59}$/.test(printed), printed);
      if (ran && /^nano_/.test(printed)) {
        let valid = false;
        try {
          const out = execFileSync("python3", [path.join(REPO_ROOT, "opener/nano-keygen.py"), "--check", printed], { encoding: "utf8" });
          valid = JSON.parse(out).valid === true;
        } catch (e) { /* valid stays false */ }
        check("L54", "the address the command prints passes an independent checksum check", valid, printed);
      }
    }

    // HTML for a browser, and the alias.
    const h = await req("GET", "/try-nano", null, { Accept: "text/html" });
    check("L30", "GET /try-nano returns HTML to a browser", h.status === 200 && /text\/html/.test(h.type), h.type);
    check("L30", "HTML on-ramp names nanswap", /nanswap\.com/.test(h.body));
    const alias = await req("GET", "/v1/onramp", null, { Accept: "application/json" });
    check("L30", "GET /v1/onramp alias works", alias.status === 200 && JSON.parse(alias.body).asset === "XNO", String(alias.status));

  } finally {
    nw.s.closeDb();
    nw.server.close();
    for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.unlinkSync(f); } catch (_) {} }
  }

  const l29ok = groups.L29.length > 0 && groups.L29.every(Boolean);
  const l30ok = groups.L30.length > 0 && groups.L30.every(Boolean);
  const l54ok = groups.L54.length > 0 && groups.L54.every(Boolean);
  const l101ok = groups.L83.length > 0 && groups.L83.every(Boolean);
  if (!ONLY || ONLY === "L29") console.log(`L29 ${l29ok ? "PASS" : "FAIL"}`);
  if (!ONLY || ONLY === "L30") console.log(`L30 ${l30ok ? "PASS" : "FAIL"}`);
  if (!ONLY || ONLY === "L54") console.log(`L54 ${l54ok ? "PASS" : "FAIL"}`);
  if (!ONLY || ONLY === "L83") console.log(`L83 ${l101ok ? "PASS" : "FAIL"}`);
  console.log(failed ? `\n${failed} check(s) failed` : "\nall Block 41 laws pass");
  process.exit(failed ? 1 : 0);
})();
