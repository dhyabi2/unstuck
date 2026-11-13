// The delivery and verdict sizes (owner, 2026-11-13: "agree on 1 XNO per passed delivery , and 0.1 XNO per verdict").
//
// Two more fixed amounts beside the 0.01 XNO payout, chosen by the kind written on the job's own row and never by
// the request. They share one budget counted in the ledger: 100 XNO ever and 10 XNO a UTC day. Those two budget
// numbers are Claude's defaults, not the owner's - the owner named the two sizes. These laws pin what that means.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const o = require("./opener.js");
const led = require("./openings.js");

const XNO = 10n ** 30n;                        // derived, never restated
const DELIVERY = XNO.toString();               // 1 XNO
const VERDICT = (XNO / 10n).toString();        // 0.1 XNO
const PAYOUT = (XNO / 100n).toString();        // the older 0.01 XNO payout
const STARTER = (XNO / 100000n).toString();
const RICH = (XNO * 500n).toString();          // a balance large enough that a refusal is never affordability

assert.equal(o.JOB_DELIVERY_RAW, DELIVERY, "a passed delivery is exactly 1 XNO");
assert.equal(o.JOB_VERDICT_RAW, VERDICT, "a verdict is exactly 0.1 XNO");
assert.equal(BigInt(o.JOB_DELIVERY_RAW) / BigInt(o.JOB_VERDICT_RAW), 10n, "a delivery is exactly ten verdicts");
assert.equal(o.JOB_PAYOUT_RAW, PAYOUT, "the 0.01 XNO payout did not move");
assert.equal(o.STARTER_RAW, STARTER, "the starter did not move");
assert.equal(o.JOB_PAYOUT_MAX_TOTAL, 50, "the older payout keeps its fifty");
assert.equal(o.JOB_PAYOUT_MAX_PER_DAY, 5, "the older payout keeps its five a day");
assert.deepEqual(Object.keys(o.AMOUNTS).sort(), ["ambassador_grant", "job_delivery", "job_payout", "job_verdict", "starter"],
  "exactly five kinds of send exist");
assert.equal(o.AMOUNTS.job_delivery, DELIVERY);
assert.equal(o.AMOUNTS.job_verdict, VERDICT);
// The words a job row may carry, and nothing else. A row says a word; the amount comes from here.
assert.deepEqual(JSON.parse(JSON.stringify(o.JOB_PAY)), { delivery: "job_delivery", verdict: "job_verdict" }, "exactly two pay words");
assert.ok(Object.isFrozen(o.JOB_PAY), "the pay words cannot be added to at run time");
assert.equal(o.JOB_TIER_BUDGET_RAW, (XNO * 100n).toString(), "the whole programme is 100 XNO and no more");
assert.equal(o.JOB_TIER_DAY_BUDGET_RAW, (XNO * 10n).toString(), "ten XNO a UTC day and no more");
assert.deepEqual(o.JOB_TIER_AMOUNTS, [DELIVERY, VERDICT], "the budget covers exactly the two sizes");

// The kind implies its amount, and each kind refuses every other size.
assert.equal(o.ONLY_ALLOWED("job_delivery", undefined).toString(), DELIVERY);
assert.equal(o.ONLY_ALLOWED("job_verdict", undefined).toString(), VERDICT);
for (const [kind, own] of [["job_delivery", DELIVERY], ["job_verdict", VERDICT]]) {
  const refused = [
    [(BigInt(own) * 2n).toString(), "two in one"],
    [(BigInt(own) + 1n).toString(), "one raw more"],
    [(BigInt(own) - 1n).toString(), "one raw less"],
    [(XNO * 100n).toString(), "the whole budget"],
    [RICH, "the whole treasury"],
    [PAYOUT, "the older payout"],
    [STARTER, "a starter"],
    ["0", "nothing"],
    [kind === "job_delivery" ? VERDICT : DELIVERY, "the other tier"],
  ];
  for (const [amount, why] of refused) {
    assert.throws(() => o.ONLY_ALLOWED(kind, amount), /refused/, `${kind} must refuse ${why}`);
    assert.throws(() => o.nextBalance(RICH, amount, kind), /refused/, `nextBalance(${kind}) must refuse ${why}`);
  }
  assert.equal(BigInt(RICH) - BigInt(o.nextBalance(RICH, null, kind)), BigInt(own), `${kind} moves exactly its size`);
  assert.throws(() => o.nextBalance((BigInt(own) - 1n).toString(), null, kind), /cannot cover/, "a short balance throws instead of sending");
}
assert.throws(() => o.ONLY_ALLOWED("starter", DELIVERY), /refused/, "a delivery may not be sent as a starter");
assert.throws(() => o.ONLY_ALLOWED("job_payout", DELIVERY), /refused/, "a delivery may not be sent as the older payout");
assert.throws(() => o.ONLY_ALLOWED("job_payout", VERDICT), /refused/, "a verdict may not be sent as the older payout");
assert.throws(() => o.ONLY_ALLOWED("job_delivery_large", DELIVERY), /refused/, "a kind that merely sounds right has no amount");
assert.throws(() => o.ONLY_ALLOWED("job_bonus", DELIVERY), /refused/, "an invented kind has no amount");
const stub = { createBlock: () => { throw new Error("REACHED-THE-BUILDER"); } };
assert.throws(() => o.sendBlock(stub, { secretKey: "x", account: "a", previous: "0", representative: "r", balanceRaw: RICH, to: "t", amountRaw: (XNO * 2n).toString(), kind: "job_delivery" }), /refused/);

// ---- the ledger: one shared budget, counted where the row is reserved ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-tiers-"));
const db = led.open(path.join(dir, "openings.db"));
const budget = { budgetRaw: o.JOB_TIER_BUDGET_RAW, dayBudgetRaw: o.JOB_TIER_DAY_BUDGET_RAW, tierAmounts: o.JOB_TIER_AMOUNTS };
const counts = { maxTotal: o.JOB_PAYOUT_MAX_TOTAL, maxPerDay: o.JOB_PAYOUT_MAX_PER_DAY };
const acct = (i) => "nano_" + "1" + String(i).padStart(59, "3");
const H = (c) => c.repeat(64);
const D1 = "2026-11-14T10:00:00.000Z";
const res = (id, i, amountRaw, caps, now = D1) => led.reserveJob(db, id, acct(i), { agent: "a" + i, amountRaw, proof: "https://example.org/x", ...caps, now });

// A budget that is missing, partial or nonsense fails CLOSED.
const bads = [
  { budgetRaw: o.JOB_TIER_BUDGET_RAW },
  { dayBudgetRaw: o.JOB_TIER_DAY_BUDGET_RAW },
  { budgetRaw: o.JOB_TIER_BUDGET_RAW, dayBudgetRaw: o.JOB_TIER_DAY_BUDGET_RAW },
  { ...budget, budgetRaw: "0" }, { ...budget, budgetRaw: "-5" }, { ...budget, budgetRaw: 100 }, { ...budget, budgetRaw: "1e32" },
  { ...budget, dayBudgetRaw: "" }, { ...budget, dayBudgetRaw: null },
  { ...budget, tierAmounts: [] }, { ...budget, tierAmounts: "all" }, { ...budget, tierAmounts: [DELIVERY, "x"] },
  { ...budget, dayBudgetRaw: (XNO * 1000n).toString() },
  { ...budget, ...counts },
];
for (const bad of bads) assert.equal(res("bad", 900, DELIVERY, bad).ok, false, `a reservation with caps ${JSON.stringify(bad).slice(0, 80)} is refused`);
// A size the budget does not cover cannot ride on it.
for (const amount of [PAYOUT, STARTER, (XNO * 2n).toString(), (XNO * 100n).toString(), "1"]) {
  assert.equal(res("odd", 901, amount, budget).ok, false, `the budget refuses the size ${amount}`);
}
// The older count caps still refuse nonsense.
for (const bad of [{}, { maxTotal: 50 }, { maxTotal: 0, maxPerDay: 5 }]) assert.equal(res("bad2", 902, PAYOUT, bad).ok, false);

// One job, one payout, at either size; a dry run gives the room back; an unknown outcome keeps it.
assert.equal(res("d-1", 1, DELIVERY, budget).ok, true);
assert.equal(res("d-1", 2, DELIVERY, budget).ok, false, "a second claim on a reserved job is refused");
assert.equal(led.confirmJob(db, "d-1", H("A")), true);
assert.equal(res("d-1", 2, DELIVERY, budget, "2026-12-01T00:00:00.000Z").ok, false, "a paid job is never paid again");
assert.equal(res("d-dry", 3, DELIVERY, budget).ok, true);
assert.equal(led.releaseJob(db, "d-dry", "dry run").released, true);
assert.equal(res("v-unk", 4, VERDICT, budget).ok, true);
assert.equal(led.markJobUnknown(db, "v-unk", "process call failed"), true);
assert.equal(res("v-unk", 4, VERDICT, budget).ok, false, "an unknown job is never retried");
// One payout per account per day, across every size.
assert.match(res("v-same", 1, VERDICT, budget).reason, /already paid today/);
assert.match(res("p-same", 1, PAYOUT, counts).reason, /already paid today/);

// The two families do not eat each other's room: five older payouts fit on a day that already holds tier rows...
for (let i = 0; i < 5; i++) assert.equal(res(`p-${i}`, 10 + i, PAYOUT, counts).ok, true, `older payout ${i} on a day with tier rows`);
assert.match(res("p-5", 15, PAYOUT, counts).reason, /daily cap/, "the sixth older payout of the day is refused as before");
// ...and the day's budget is 10 XNO of TIER money: so far 1.0 (d-1) + 0.1 (v-unk) = 1.1; the older payouts do not count.
for (let i = 0; i < 8; i++) assert.equal(res(`d-fill-${i}`, 20 + i, DELIVERY, budget).ok, true, `delivery ${i} fits the day`);
// 9.1 XNO now. A delivery (1) does not fit; verdicts (0.1) fit until 10.0 exactly; then nothing fits.
const noRoom = res("d-over", 40, DELIVERY, budget);
assert.equal(noRoom.ok, false);
assert.match(noRoom.reason, /daily cap/, "the refusal uses the words the settle job retries on");
for (let i = 0; i < 9; i++) assert.equal(res(`v-fill-${i}`, 50 + i, VERDICT, budget).ok, true, `verdict ${i} fits the day`);
assert.match(res("v-over", 60, VERDICT, budget).reason, /daily cap/, "10.0 XNO is the day; one verdict more is refused");
assert.equal(res("d-next", 40, DELIVERY, budget, "2026-11-15T00:00:01.000Z").ok, true, "the next UTC day opens again");

// The total: fill to 100 XNO across days, then nothing more, ever. 11.0 XNO is reserved so far.
let spent = 110n, day = 16, n = 0;                      // in tenths of an XNO
while (spent + 10n <= 1000n) {
  const now = `2026-${day <= 30 ? "11" : "12"}-${String(day <= 30 ? day : day - 30).padStart(2, "0")}T08:00:00.000Z`;
  let inDay = 0;
  while (inDay < 10 && spent + 10n <= 1000n) {
    const r = res(`t-${n}`, 1000 + n, DELIVERY, budget, now);
    assert.equal(r.ok, true, `fill ${n} on ${now}: ${r.reason}`);
    n++; inDay++; spent += 10n;
  }
  day++;
}
assert.equal(spent, 1000n, "the fill reached exactly 100 XNO");
const late = "2027-03-01T00:00:00.000Z";
assert.match(res("d-101", 5000, DELIVERY, budget, late).reason, /total cap/, "a delivery past 100 XNO is refused for ever");
assert.match(res("v-101", 5001, VERDICT, budget, late).reason, /total cap/, "and so is a verdict");
assert.equal(res("p-late", 5002, PAYOUT, counts, late).ok, true, "the older payout still has its own room");

const sent = led.jobsSent(db);
assert.ok(sent.some((r) => r.job_id === "d-1" && r.state === "sent" && r.amount_raw === DELIVERY));
assert.ok(sent.some((r) => r.job_id === "v-unk" && r.state === "unknown" && r.amount_raw === VERDICT));

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS job tiers: a passed delivery is exactly 1 XNO and a verdict exactly 0.1 XNO, derived from 1 XNO = 10^30; nine other " +
  "sizes are refused for each at ONLY_ALLOWED, nextBalance and before the block builder; exactly five kinds and two pay words " +
  "exist; the two sizes share 100 XNO ever and 10 XNO a UTC day, summed in the ledger; a missing or nonsense budget fails closed; " +
  "the older 0.01 XNO payout keeps its own fifty and five a day; one payout per account per day across every size");
