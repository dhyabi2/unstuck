// The third amount: the job payout (owner, 2026-11-10).
//
// Asked "which shape do you approve?", the owner answered "one fixed amount: 0.01 XNO", at most 50 payouts in total
// and 5 a day, requested by the conversation agent and checked by the box. These laws pin what that means in code:
// one size, one payout per job, caps counted in the ledger, never to our own accounts, and nothing a caller can raise.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const o = require("./opener.js");
const led = require("./openings.js");

const XNO = 10n ** 30n;                       // derived, never restated: a law that repeats the constant proves nothing
const PAYOUT = (XNO / 100n).toString();       // 0.01 XNO
const STARTER = (XNO / 100000n).toString();
const GRANT = (XNO / 10n).toString();
const TREASURY2 = (XNO * 99n / 100n).toString();  // about what treasury2 holds, so refusals are not affordability

assert.equal(o.JOB_PAYOUT_RAW, PAYOUT, "a job payout is exactly 0.01 XNO");
assert.equal(BigInt(o.JOB_PAYOUT_RAW) / BigInt(o.STARTER_RAW), 1000n, "a payout is exactly one thousand starters");
assert.equal(o.STARTER_RAW, STARTER, "the starter did not move");
assert.equal(o.AMBASSADOR_GRANT_RAW, GRANT, "the grant did not move");
assert.deepEqual(Object.keys(o.AMOUNTS).sort(), ["ambassador_grant", "job_delivery", "job_payout", "job_verdict", "starter"],
  "exactly five kinds of send exist (2026-11-13: delivery and verdict, laws in test_job_tiers.js)");
assert.equal(o.JOB_PAYOUT_MAX_TOTAL, 50, "fifty payouts, ever");
assert.equal(o.JOB_PAYOUT_MAX_PER_DAY, 5, "five payouts a day");
assert.equal(BigInt(o.JOB_PAYOUT_RAW) * BigInt(o.JOB_PAYOUT_MAX_TOTAL), XNO / 2n, "the whole programme is 0.5 XNO and no more");

// The kind implies its amount, and each kind refuses the others' sizes.
assert.equal(o.ONLY_ALLOWED("job_payout", undefined).toString(), PAYOUT);
assert.equal(o.ONLY_ALLOWED("job_payout", PAYOUT).toString(), PAYOUT);
assert.throws(() => o.ONLY_ALLOWED("starter", PAYOUT), /refused/, "a payout may not be sent as a starter");
assert.throws(() => o.ONLY_ALLOWED("ambassador_grant", PAYOUT), /refused/, "a payout may not be sent as a grant");
const refused = [
  [(XNO / 20n).toString(), "0.05 XNO - five payouts in one"],
  [(XNO / 100n + 1n).toString(), "one raw more"],
  [(XNO / 100n - 1n).toString(), "one raw less"],
  [(XNO / 1000n).toString(), "a tenth of a payout"],
  [STARTER, "a starter"],
  [GRANT, "a grant"],
  [TREASURY2, "the whole treasury"],
  ["0", "nothing"],
];
for (const [amount, why] of refused) {
  assert.throws(() => o.ONLY_ALLOWED("job_payout", amount), /refused/, `a payout must refuse ${why}`);
  assert.throws(() => o.nextBalance(TREASURY2, amount, "job_payout"), /refused/, `nextBalance must refuse ${why}`);
}
assert.throws(() => o.ONLY_ALLOWED("bounty", PAYOUT), /refused/, "an invented kind has no amount");
assert.throws(() => o.ONLY_ALLOWED("job_payout_large", PAYOUT), /refused/, "a kind that merely sounds right has no amount");

// The balance moves by exactly one payout, and a balance that cannot cover it throws instead of sending.
assert.equal(BigInt(TREASURY2) - BigInt(o.nextBalance(TREASURY2, null, "job_payout")), XNO / 100n);
assert.throws(() => o.nextBalance((XNO / 100n - 1n).toString(), null, "job_payout"), /cannot cover/);
// The grant's 8.9 XNO floor still binds grants; treasury2 holds about 1 XNO, so no grant can leave it at all.
assert.throws(() => o.nextBalance(TREASURY2, null, "ambassador_grant"), /refused|floor/);

// sendBlock refuses a wrong size BEFORE it would build anything (the stub would throw differently if reached).
const stub = { createBlock: () => { throw new Error("REACHED-THE-BUILDER"); } };
assert.throws(() => o.sendBlock(stub, { secretKey: "x", account: "a", previous: "0", representative: "r", balanceRaw: TREASURY2, to: "t", amountRaw: (XNO / 20n).toString(), kind: "job_payout" }), /refused/);

// Our own accounts are named, and they are valid-looking addresses rather than placeholders.
assert.ok(o.OUR_ACCOUNTS.length >= 4 && o.OUR_ACCOUNTS.every((a) => /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(a)));

// ---- the ledger: one payout per job, caps counted where the row is reserved ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-lock-"));
const db = led.open(path.join(dir, "openings.db"));
const caps = { maxTotal: o.JOB_PAYOUT_MAX_TOTAL, maxPerDay: o.JOB_PAYOUT_MAX_PER_DAY };
const acct = (i) => "nano_" + "1" + String(i).padStart(59, "3");  // distinct strings; the ledger does not checksum
const H = (c) => c.repeat(64);
const D1 = "2026-11-10T10:00:00.000Z";

// Caps that are missing fail CLOSED.
for (const bad of [{}, { maxTotal: 50 }, { maxPerDay: 5 }, { maxTotal: 0, maxPerDay: 5 }, { maxTotal: 50, maxPerDay: -1 }, { maxTotal: "50", maxPerDay: "5" }]) {
  const r = led.reserveJob(db, "job-x", acct(900), { agent: "a", amountRaw: PAYOUT, ...bad, now: D1 });
  assert.equal(r.ok, false, "a reservation without both caps is refused");
}
assert.equal(led.reserveJob(db, "", acct(1), { agent: "a", amountRaw: PAYOUT, ...caps, now: D1 }).ok, false, "no job id, no payout");
assert.equal(led.reserveJob(db, "job-1", acct(1), { amountRaw: PAYOUT, ...caps, now: D1 }).ok, false, "no agent, no payout");

// One job, one payout: reserved, sent - and never again, to anyone.
assert.equal(led.reserveJob(db, "job-1", acct(1), { agent: "alpha", amountRaw: PAYOUT, proof: "https://example.org/1", ...caps, now: D1 }).ok, true);
assert.equal(led.reserveJob(db, "job-1", acct(2), { agent: "beta", amountRaw: PAYOUT, ...caps, now: D1 }).ok, false, "a second claim on a reserved job is refused");
assert.equal(led.confirmJob(db, "job-1", H("A")), true);
const again = led.reserveJob(db, "job-1", acct(2), { agent: "beta", amountRaw: PAYOUT, ...caps, now: "2026-12-01T00:00:00.000Z" });
assert.equal(again.ok, false, "a paid job is never paid again, on any later day");
assert.equal(again.block, H("A"));
assert.throws(() => led.confirmJob(db, "job-1", "short"), /block hash/);

// A dry run gives the slot back and spends no cap.
assert.equal(led.reserveJob(db, "job-dry", acct(3), { agent: "gamma", amountRaw: PAYOUT, ...caps, now: D1 }).ok, true);
assert.equal(led.releaseJob(db, "job-dry", "dry run").released, true);
assert.equal(led.reserveJob(db, "job-dry", acct(3), { agent: "gamma", amountRaw: PAYOUT, ...caps, now: D1 }).ok, true, "a released job can be reserved for real");
assert.equal(led.confirmJob(db, "job-dry", H("B")), true);
assert.equal(led.releaseJob(db, "job-dry", "too late").released, false, "a SENT payout cannot be released");

// One payout per account per day.
assert.equal(led.reserveJob(db, "job-same", acct(1), { agent: "alpha", amountRaw: PAYOUT, ...caps, now: D1 }).ok, false, "the same account twice in a day is refused");

// An unknown outcome keeps its row: it counts against the caps and the job is not retried.
assert.equal(led.reserveJob(db, "job-unk", acct(4), { agent: "delta", amountRaw: PAYOUT, ...caps, now: D1 }).ok, true);
assert.equal(led.markJobUnknown(db, "job-unk", "process call failed"), true);
assert.equal(led.reserveJob(db, "job-unk", acct(4), { agent: "delta", amountRaw: PAYOUT, ...caps, now: D1 }).ok, false, "an unknown job is never retried");

// The daily cap: three rows exist on D1 (job-1, job-dry, job-unk). Two more fit; the sixth is refused; tomorrow is a new day.
assert.equal(led.reserveJob(db, "job-4", acct(5), { agent: "e", amountRaw: PAYOUT, ...caps, now: D1 }).ok, true);
assert.equal(led.reserveJob(db, "job-5", acct(6), { agent: "f", amountRaw: PAYOUT, ...caps, now: D1 }).ok, true);
const sixth = led.reserveJob(db, "job-6", acct(7), { agent: "g", amountRaw: PAYOUT, ...caps, now: D1 });
assert.equal(sixth.ok, false);
assert.match(sixth.reason, /daily cap/);
assert.equal(led.reserveJob(db, "job-6", acct(7), { agent: "g", amountRaw: PAYOUT, ...caps, now: "2026-11-11T00:00:01.000Z" }).ok, true, "the next UTC day opens again");

// The total cap: fill to fifty across days, then the fifty-first is refused for ever.
let n = 6, day = 12, inDay = 0;
while (n < o.JOB_PAYOUT_MAX_TOTAL) {
  const now = `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`;
  const r = led.reserveJob(db, `fill-${n}`, acct(100 + n), { agent: `fill${n}`, amountRaw: PAYOUT, ...caps, now });
  assert.equal(r.ok, true, `fill ${n} on day ${day}: ${r.reason}`);
  n++; inDay++;
  if (inDay === o.JOB_PAYOUT_MAX_PER_DAY) { day++; inDay = 0; }
}
const over = led.reserveJob(db, "job-51", acct(999), { agent: "late", amountRaw: PAYOUT, ...caps, now: "2026-12-25T00:00:00.000Z" });
assert.equal(over.ok, false);
assert.match(over.reason, /total cap/);

const sent = led.jobsSent(db);
assert.ok(sent.some((r) => r.job_id === "job-1" && r.state === "sent" && r.block === H("A")));
assert.ok(sent.some((r) => r.job_id === "job-unk" && r.state === "unknown"), "an unknown outcome is listed as spending");
assert.ok(sent.every((r) => r.amount_raw === PAYOUT), "every recorded payout is the one size");

fs.rmSync(dir, { recursive: true, force: true });
console.log("PASS job lock: a job payout is exactly 0.01 XNO (one thousand starters), derived from 1 XNO = 10^30; 8 other sizes are " +
  "refused at ONLY_ALLOWED and nextBalance and before the block builder; an invented kind has no amount; a job is paid once ever; " +
  "a dry run spends nothing; an unknown outcome counts and is never retried; one payout per account per day, five a day, fifty " +
  "ever (0.5 XNO), and missing caps fail closed");
