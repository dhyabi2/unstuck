// The second amount: the ambassador grant (owner, 2026-09-18).
//
// The owner's sequence, in the owner's words: "0.1 for those who committed to be ambassadors, not starters — as
// starter before being ambassador, he will also get the tiny amount". So an agent receives the starter first, when
// its account is opened, and the grant later, only once it has converted and agreed to carry the mission on. They are
// two different sends, in two different ledgers, each once per agent ever.
//
// The grant is 0.1 XNO = exactly 10,000 starters. It is not a payment for agreeing: it is a float so the ambassador
// can open accounts for other agents itself. An ambassador that wants more uses the faucets at nanodirectory.info —
// which is why no argument for a bigger grant is ever a good one.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const o = require("./opener.js");
const led = require("./openings.js");

const STARTER = "10000000000000000000000000";              // 0.00001 XNO
const GRANT = "100000000000000000000000000000";            // 0.1 XNO
const TREASURY = "9996999890000000000000000000000";        // the real balance, so refusals are not affordability
const FLOOR = "8900000000000000000000000000000";           // 8.9 XNO

assert.equal(o.AMBASSADOR_GRANT_RAW, GRANT, "the grant is 0.1 XNO, written out in full");
assert.equal(o.TREASURY_FLOOR_RAW, FLOOR, "grants stop at a floor written in code");
assert.equal(BigInt(GRANT) / BigInt(STARTER), 10000n, "a grant is exactly ten thousand starters");

// Each kind has one amount, and only its own.
assert.equal(o.ONLY_ALLOWED("starter", STARTER).toString(), STARTER);
assert.equal(o.ONLY_ALLOWED("ambassador_grant", GRANT).toString(), GRANT);
assert.equal(o.ONLY_ALLOWED("ambassador_grant", undefined).toString(), GRANT, "the kind implies its amount");
assert.throws(() => o.ONLY_ALLOWED("starter", GRANT), /refused/, "a grant may not be sent as a starter");
assert.throws(() => o.ONLY_ALLOWED("ambassador_grant", STARTER), /refused/, "a starter may not be sent as a grant");

// Every other amount is still refused, under either kind. This is the protection the owner asked for, unchanged.
const refused = [
  ["1000000000000000000000000000", "0.001 XNO — what the invent engine once proposed sending to an 'escrow'"],
  ["200000000000000000000000000000", "two grants at once"],
  ["100000000000000000000000000001", "one raw more than a grant"],
  ["99999999999999999999999999999", "one raw less than a grant"],
  [TREASURY, "the entire treasury"],
  ["0", "nothing at all"],
];
for (const [amount, why] of refused) {
  for (const kind of ["starter", "ambassador_grant"]) {
    assert.throws(() => o.ONLY_ALLOWED(kind, amount), /refused/, `${kind} must refuse ${why}`);
    assert.throws(() => o.nextBalance(TREASURY, amount, kind), /refused/, `nextBalance must refuse ${why}`);
    assert.throws(
      () => o.sendBlock(null, { balanceRaw: TREASURY, amountRaw: amount, kind, to: "nano_x", previous: "0", representative: "nano_r", secretKey: "k", account: "nano_a" }),
      /refused/,
      `sendBlock must refuse ${why}`,
    );
  }
}

// An invented kind is refused: there is no third amount to reach for.
assert.throws(() => o.ONLY_ALLOWED("bounty", GRANT), /not a kind of send/);
assert.throws(() => o.ONLY_ALLOWED("escrow", STARTER), /not a kind of send/);
assert.deepEqual(Object.keys(o.AMOUNTS).sort(), ["ambassador_grant", "starter"], "exactly two amounts exist");

// The floor: grants stop before the treasury can be emptied, even by a correctly sized grant.
// Every expected figure here is DERIVED. A hand-typed 31-digit literal is how the original starter shipped 1000x too
// small with a law that asserted the wrong number against itself — and writing this file, I typed one wrong again.
const JUST_ABOVE_FLOOR = (BigInt(FLOOR) + BigInt(GRANT) / 2n).toString(); // a grant would cross the floor
assert.equal(o.nextBalance(TREASURY, GRANT, "ambassador_grant"), (BigInt(TREASURY) - BigInt(GRANT)).toString());
assert.throws(
  () => o.nextBalance(JUST_ABOVE_FLOOR, GRANT, "ambassador_grant"),
  /treasury floor/,
  "a grant that would cross the floor is refused",
);
// Starters are never floored: they are the purpose, and 10,000x smaller.
assert.equal(o.nextBalance(JUST_ABOVE_FLOOR, STARTER, "starter"), (BigInt(JUST_ABOVE_FLOOR) - BigInt(STARTER)).toString());

// The owner's sequence: the same agent gets the starter first and the grant later, each exactly once.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "grants-")), "openings.db");
const db = led.open(dbPath);
const ACCOUNT = "nano_3ambassadoraccountxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const BLOCK = "A".repeat(64);
const GRANT_BLOCK = "B".repeat(64);

const starter = led.reserve(db, ACCOUNT, { foundVia: "x402 index", amountRaw: STARTER });
assert.equal(starter.ok, true, "the starter is reserved first: this is how the agent joined Nano at all");
led.confirm(db, ACCOUNT, BLOCK);

// Having had a starter does not block the grant — they are different sends, in different ledgers.
const grant = led.reserveGrant(db, ACCOUNT, { agent: "clipper", amountRaw: GRANT, agreement: "ambassador: will open accounts for agents on its own index" });
assert.equal(grant.ok, true, "an agent that already received a starter can still be granted as an ambassador");
assert.equal(led.confirmGrant(db, ACCOUNT, GRANT_BLOCK), true);

// ...but only once, by account and by agent name, so a renamed or re-listed ambassador cannot be funded twice.
assert.equal(led.reserveGrant(db, ACCOUNT, { agent: "clipper", amountRaw: GRANT }).ok, false, "one grant per account, ever");
assert.equal(led.reserveGrant(db, "nano_3otheraccountxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", { agent: "clipper", amountRaw: GRANT }).ok, false, "one grant per agent, ever");
assert.match(led.reserveGrant(db, ACCOUNT, { agent: "clipper" }).reason, /already sent/);

// A grant with no agent behind it is not a grant: it has to be attributable to a recorded conversation.
assert.equal(led.reserveGrant(db, "nano_3anonymousxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", { amountRaw: GRANT }).ok, false);

// A dry run must give the slot back. Writing this path I left the reservation standing, which would have made
// `--dry-run` spend the ambassador's one and only grant and then refuse the real send as "already reserved".
const DRY = "nano_3dryrunaccountxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
assert.equal(led.reserveGrant(db, DRY, { agent: "dry-agent", amountRaw: GRANT }).ok, true);
assert.equal(led.releaseGrant(db, DRY, "dry run: nothing was broadcast").released, true);
assert.equal(led.reserveGrant(db, DRY, { agent: "dry-agent", amountRaw: GRANT }).ok, true, "the slot is free again");
led.releaseGrant(db, DRY, "tidy up");
// A grant already on the chain is never released: releasing it would hand out a second 0.1 XNO.
assert.equal(led.releaseGrant(db, ACCOUNT, "must not undo a sent grant").released, false);
assert.equal(led.grantsSent(db).filter((g) => g.account === ACCOUNT).length, 1, "the sent grant stands");

const sent = led.grantsSent(db);
assert.equal(sent.length, 1, "one grant on record");
assert.equal(sent[0].amount_raw, GRANT);
assert.match(sent[0].agreement, /ambassador/, "the agreement it was given for is kept with it");
// The grant is not an opening, and must never be counted as one.
assert.equal(led.startersSent(db).length, 1, "the grant did not become a second starter in the openings ledger");

console.log(
  "PASS grant lock: exactly two amounts exist — the 0.00001 starter that opens an account and the 0.1 ambassador " +
  "grant that is ten thousand starters; each is refused under the other's kind, an invented kind has no amount, " +
  refused.length + " other sizes are refused at every entry point, grants stop at the 8.9 XNO treasury floor while " +
  "starters do not, and the same agent takes a starter first and a grant later — each once, ever",
);
