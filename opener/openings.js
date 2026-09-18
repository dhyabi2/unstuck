/**
 * The openings ledger: the record that makes "one starter per agent, ever" true.
 *
 * A Nano send cannot be undone, so the rule cannot live in memory, in a JSON file rewritten after the fact, or in a
 * check that runs before the send and is written down after it. It lives here, in SQLite, and the address is the
 * PRIMARY KEY: the reservation IS the uniqueness check. Two processes racing the same address produce one row and one
 * refusal, not two sends.
 *
 * The order is always: reserve -> send -> confirm. Never send-then-record. Three separate measurements elsewhere in
 * this swarm (two live tweets for one row, two replies to one post, two public pushes for one newsletter) are all the
 * same defect, and here it would be money that cannot be called back.
 *
 * States:
 *   reserved  we intend to send and nothing is known to be on-chain yet
 *   sent      the block hash is recorded; this address is finished forever
 *   unknown   we asked the network to process a block and never learned the outcome
 *
 * `unknown` is deliberately not reservable again. A human (or a later run that checks the chain) resolves it. Silence
 * about a send is never an invitation to send again.
 */

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS openings (
  account     TEXT PRIMARY KEY,
  state       TEXT NOT NULL CHECK (state IN ('reserved','sent','unknown')),
  block       TEXT,
  amount_raw  TEXT,
  found_via   TEXT,
  reserved_at TEXT NOT NULL,
  settled_at  TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS openings_state ON openings(state);
`;

function open(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(SCHEMA);
  db.exec(GRANTS_SCHEMA); // ambassador grants live beside the openings, never mixed into them
  migrate(db); // a ledger that already holds sends must gain the verification columns, not break on them
  return db;
}

/**
 * Claim an address. Returns {ok:true} only for a first, uncontested claim.
 *
 * BEGIN IMMEDIATE takes the write lock before reading anything, so the check and the insert cannot be separated by
 * another writer. A deferred transaction would read, let the other process insert, and then fail on commit — after the
 * caller had already decided to send.
 */
function reserve(db, account, { foundVia = "unspecified", amountRaw = null, now = new Date().toISOString() } = {}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT state, block FROM openings WHERE account = ?").get(account);
    if (existing) {
      db.exec("ROLLBACK");
      return { ok: false, reason: `already ${existing.state}`, state: existing.state, block: existing.block || null };
    }
    db.prepare(
      "INSERT INTO openings (account, state, amount_raw, found_via, reserved_at) VALUES (?, 'reserved', ?, ?, ?)"
    ).run(account, amountRaw, foundVia, now);
    db.exec("COMMIT");
    return { ok: true, state: "reserved" };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* the transaction is already gone */ }
    return { ok: false, reason: String(e.message || e) };
  }
}

/** The send is on-chain and the address is finished forever. A confirm without a block hash is not a confirm. */
function confirm(db, account, block, { now = new Date().toISOString() } = {}) {
  if (!block || String(block).length !== 64) throw new Error("an opening is recorded by its block hash or not at all");
  const r = db.prepare(
    "UPDATE openings SET state='sent', block=?, settled_at=? WHERE account=? AND state='reserved'"
  ).run(block, now, account);
  if (r.changes !== 1) throw new Error(`no reservation to confirm for ${account}`);
  return { ok: true, block };
}

/**
 * Give the address back. Only ever called when the caller can say why nothing was broadcast — a validation failure, a
 * refused signature, an RPC that never got the block. If the network was asked and the answer was lost, the caller
 * must use markUnknown instead: an address we might have paid is not a candidate.
 */
function release(db, account, reason) {
  if (!reason) throw new Error("a reservation is only released with a stated reason");
  const r = db.prepare("DELETE FROM openings WHERE account=? AND state='reserved'").run(account);
  return { ok: r.changes === 1 };
}

/** We asked the network to process a block and never learned the outcome. Never retried automatically. */
function markUnknown(db, account, note, { now = new Date().toISOString() } = {}) {
  const r = db.prepare(
    "UPDATE openings SET state='unknown', note=?, settled_at=? WHERE account=? AND state='reserved'"
  ).run(String(note || "outcome unknown"), now, account);
  return { ok: r.changes === 1 };
}

/**
 * A send is not an opening.
 *
 * The first version of this file treated every `sent` row as an opened account, and the chain disagreed: of the first
 * 11 starters, **none** opened anything — 6 went to accounts someone else had already opened, 5 went to accounts that
 * are still not open, and 8 were never received at all. Publishing those as "accounts opened" is the exact claim this
 * project forbids itself. So an opening now has to be proved: our block must BE the account's open block, checked
 * against the chain and written down here with the time it was checked.
 *
 * `opened_by_us` is null until verified, 1 when our block opened the account, 0 when it did not.
 */
const OPEN_COLUMNS = [
  ["opened_by_us", "INTEGER"],
  ["verified_at", "TEXT"],
  ["received", "INTEGER"],
];

function migrate(db) {
  const have = new Set(db.prepare("PRAGMA table_info(openings)").all().map((c) => c.name));
  for (const [name, type] of OPEN_COLUMNS) {
    if (!have.has(name)) db.exec(`ALTER TABLE openings ADD COLUMN ${name} ${type}`);
  }
}

/** Every starter we actually broadcast. This is a record of spending, not of adoption. */
function startersSent(db) {
  return db.prepare(
    `SELECT account, block, amount_raw, found_via, settled_at AS sent_at, opened_by_us, received, verified_at
       FROM openings WHERE state='sent' ORDER BY settled_at`
  ).all();
}

/** Only accounts this project demonstrably opened: our block is their open block, verified against the chain. */
function opened(db) {
  return db.prepare(
    `SELECT account, block, amount_raw, found_via, settled_at AS opened_at, verified_at
       FROM openings WHERE state='sent' AND opened_by_us=1 ORDER BY settled_at`
  ).all();
}

/** Record what the chain says about one starter. Never infers: an unchecked row stays unchecked. */
function recordChainCheck(db, account, { openedByUs, received, now = new Date().toISOString() } = {}) {
  const r = db.prepare(
    "UPDATE openings SET opened_by_us=?, received=?, verified_at=? WHERE account=? AND state='sent'"
  ).run(openedByUs ? 1 : 0, received ? 1 : 0, now, account);
  return { ok: r.changes === 1 };
}

function counts(db) {
  const rows = db.prepare("SELECT state, COUNT(*) AS n FROM openings GROUP BY state").all();
  const by = Object.fromEntries(rows.map((r) => [r.state, r.n]));
  const one = (sql) => db.prepare(sql).get().n;
  return {
    starters_sent: by.sent || 0,
    opened_by_us: one("SELECT COUNT(*) AS n FROM openings WHERE state='sent' AND opened_by_us=1"),
    not_opened_by_us: one("SELECT COUNT(*) AS n FROM openings WHERE state='sent' AND opened_by_us=0"),
    unverified: one("SELECT COUNT(*) AS n FROM openings WHERE state='sent' AND opened_by_us IS NULL"),
    unreceived: one("SELECT COUNT(*) AS n FROM openings WHERE state='sent' AND received=0"),
    reserved: by.reserved || 0,
    unknown: by.unknown || 0,
  };
}

/**
 * One sender at a time on this box. SQLite already makes a double send impossible; this only stops two senders from
 * burning work and RPC calls racing each other. A lock whose owning process is gone is not a lock.
 */
function lock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return { ok: true, release: () => { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
      let alive = true;
      try { process.kill(pid, 0); } catch { alive = false; }
      if (alive) return { ok: false, heldBy: pid };
      fs.unlinkSync(lockPath); // the owner died; take it on the next attempt
    }
  }
  return { ok: false, heldBy: null };
}

/**
 * Ambassador grants, kept in their own table so a grant can never be mistaken for an opening.
 *
 * One grant per agent, ever. The guard is the same BEGIN IMMEDIATE claim the openings ledger uses: the check and the
 * insert cannot be separated by another writer, so two runs cannot both decide to fund the same ambassador.
 */
const GRANTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS grants (
  account     TEXT PRIMARY KEY,
  agent       TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('reserved','sent')),
  block       TEXT,
  amount_raw  TEXT NOT NULL,
  agreement   TEXT,
  reserved_at TEXT NOT NULL,
  settled_at  TEXT
);
`;

function reserveGrant(db, account, { agent, amountRaw, agreement = "", now = new Date().toISOString() } = {}) {
  db.exec(GRANTS_SCHEMA);
  if (!agent) return { ok: false, reason: "a grant is recorded against the agent it was agreed with" };
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT state, block FROM grants WHERE account = ?").get(account);
    if (existing) {
      db.exec("ROLLBACK");
      return { ok: false, reason: `already ${existing.state}`, state: existing.state, block: existing.block || null };
    }
    const byAgent = db.prepare("SELECT account FROM grants WHERE agent = ?").get(agent);
    if (byAgent) {
      db.exec("ROLLBACK");
      return { ok: false, reason: `${agent} was already granted at ${byAgent.account}` };
    }
    db.prepare(
      "INSERT INTO grants (account, agent, state, amount_raw, agreement, reserved_at) VALUES (?, ?, 'reserved', ?, ?, ?)"
    ).run(account, agent, amountRaw, agreement, now);
    db.exec("COMMIT");
    return { ok: true, state: "reserved" };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* the transaction is already gone */ }
    return { ok: false, reason: String(e.message || e) };
  }
}

/**
 * Give back a reserved grant. A dry run, or a failure before broadcast, must not consume an ambassador's one grant:
 * the openings ledger has always released a dry run, and a grants ledger that did not would make `--dry-run` a trap
 * that silently spent the slot it was meant to prove.
 */
function releaseGrant(db, account, reason = "") {
  const r = db.prepare("DELETE FROM grants WHERE account = ? AND state = 'reserved'").run(account);
  return { released: r.changes === 1, reason };
}

function confirmGrant(db, account, block, { now = new Date().toISOString() } = {}) {
  if (!block || String(block).length !== 64) throw new Error("a grant is recorded by its block hash or not at all");
  const r = db.prepare("UPDATE grants SET state='sent', block=?, settled_at=? WHERE account=? AND state='reserved'")
    .run(block, now, account);
  return r.changes === 1;
}

/** Every grant actually broadcast. Spending, not adoption: what it produced is counted in openings, by other agents. */
function grantsSent(db) {
  db.exec(GRANTS_SCHEMA);
  return db.prepare("SELECT account, agent, block, amount_raw, agreement, settled_at AS sent_at FROM grants WHERE state='sent' ORDER BY settled_at").all();
}

module.exports = { open, reserve, confirm, release, markUnknown, opened, startersSent, recordChainCheck, counts, lock, reserveGrant, confirmGrant, releaseGrant, grantsSent };
