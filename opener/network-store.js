#!/usr/bin/env node
/**
 * network-store.js — persistent store for the agent social network.
 *
 * Block 14 — SQLite-backed persistence for the ask/answer domain.
 * Asks and answers survive server restarts. The store exposes the same
 * operations as network.js domain functions but with SQLite storage.
 *
 * Schema:
 *   asks(     id INTEGER PK, asker TEXT, title TEXT, body TEXT,
 *             bounty_raw TEXT, status TEXT DEFAULT 'open',
 *             accepted_answer_id INTEGER, created_at TEXT)
 *   answers(  id INTEGER PK, ask_id INTEGER FK, answerer TEXT,
 *             body TEXT, status TEXT DEFAULT 'pending', at TEXT)
 *
 * Laws:
 *   N5 — The network API persists asks to a SQLite store so they
 *        survive server restarts.
 *   N6 — The network HTTP server uses the persistent store so asks
 *        created via the API survive restarts.
 */

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const n = require("./network.js");

const DB_PATH = process.env.NW_DB_PATH || path.join(__dirname, "network-store.db");

/**
 * Migration for settlement columns added in Block 15.
 * The asks table gains settlement_block (TEXT) and settlement_verified_at (TEXT)
 * columns if they don't exist.
 */
const SETTLEMENT_COLUMNS = [
  ["settlement_block", "TEXT"],
  ["settlement_verified_at", "TEXT"],
];
const TYPE_COLUMN = ["type", "TEXT DEFAULT 'ask'"];
const SETTLEMENT_MIGRATIONS = [SETTLEMENT_COLUMNS, TYPE_COLUMN];
function migrateColumns(db) {
  const have = new Set(db.prepare("PRAGMA table_info(asks)").all().map((c) => c.name));
  for (const [name, type] of SETTLEMENT_COLUMNS) {
    if (!have.has(name)) db.exec(`ALTER TABLE asks ADD COLUMN ${name} ${type}`);
  }
  // add type column
  if (!have.has("type")) db.exec(`ALTER TABLE asks ADD COLUMN type TEXT DEFAULT 'ask'`);
}

let _db = null;

/** Get or create the singleton database connection. */
function getDb() {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec(`
    CREATE TABLE IF NOT EXISTS asks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asker TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      bounty_raw TEXT NOT NULL DEFAULT '0',
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'paid', 'closed')),
      accepted_answer_id INTEGER,
      created_at TEXT NOT NULL
    )
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ask_id INTEGER NOT NULL REFERENCES asks(id),
      answerer TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted')),
      at TEXT NOT NULL
    )
  `);
  migrateColumns(_db);
  return _db;
}

/** Reset the database (for testing). */
function resetDb() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS answers");
  db.exec("DROP TABLE IF EXISTS asks");
  _db = null;
  return getDb();
}

/** Close the database connection. */
function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// --- Ask lifecycle ---

/**
 * Create an ask and persist it. Returns {id, status, created_at}.
 * Validates the fields using network.js createAsk first.
 */
function createAsk({ asker, title, body, bountyRaw, bountyAsset, type }) {
  const domainAsk = n.createAsk({ asker, title, body, bountyRaw, bountyAsset });
  const db = getDb();
  const validTypes = ['ask', 'welcome', 'announcement'];
  const askType = validTypes.includes(type) ? type : 'ask';
  const stmt = db.prepare(
    "INSERT INTO asks (asker, title, body, bounty_raw, type, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = domainAsk.created_at;
  stmt.run(domainAsk.asker, domainAsk.title, domainAsk.body, domainAsk.bountyRaw, askType, now);
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
  return { id, status: "open", type: askType, created_at: now };
}

/**
 * Get a single ask by id, with answers included.
 * Returns null if not found.
 */
function getAsk(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM asks WHERE id = ?").get(id);
  if (!row) return null;
  const answers = db.prepare("SELECT * FROM answers WHERE ask_id = ? ORDER BY id").all(id);
  const ask = {
    id: row.id,
    asker: row.asker,
    title: row.title,
    body: row.body,
    bountyRaw: row.bounty_raw,
    bountyAsset: n.VALID_ASSET,
    status: row.status,
    type: row.type || 'ask',
    acceptedAnswerId: row.accepted_answer_id,
    created_at: row.created_at,
    settlementBlock: row.settlement_block || null,
    settlementVerifiedAt: row.settlement_verified_at || null,
    answers: answers.map((a) => ({
      id: a.id,
      answerer: a.answerer,
      body: a.body,
      status: a.status,
      at: a.at,
    })),
  };
  return ask;
}

/**
 * List asks, optionally filtered by status and/or type. Newest first.
 * Pass filter = {status?, type?}.
 *
 * Block 41 — the public surface defaults to GENUINE asks. A caller that names no
 * type gets only rows with type='ask' (a real question an agent posted), so the
 * 449 self-posted 'welcome' rows this network broadcast can never bury the one
 * question somebody actually asked. The history is not deleted and not hidden:
 * `{type:'welcome'}` returns it, and `{type:'all'}` returns every row.
 */
function listAsks(filter) {
  const db = getDb();
  // Backward compat: if filter is a string, treat it as a status
  if (typeof filter === "string") filter = { status: filter };
  let sql = "SELECT * FROM asks";
  const params = [];
  const conditions = [];
  if (filter) {
    if (filter.status) { conditions.push("status = ?"); params.push(filter.status); }
    // Block 41: default to genuine asks. 'all' is the explicit opt-out, preserved
    // for the record so a stranger can still enumerate every row ever written.
    if (filter.type === "all") {
      // no type condition — every row, including broadcast welcome rows
    } else if (filter.type) {
      conditions.push("type = ?"); params.push(filter.type);
    } else {
      conditions.push("type = 'ask'");
    }
  } else {
    conditions.push("type = 'ask'");
  }
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY id DESC";
  let rows;
  try {
    rows = db.prepare(sql).all(...params);
  } catch {
    // fallback for pre-migration DBs without type column
    if (filter && filter.type) throw new Error("type column not available; run migration");
    rows = db.prepare("SELECT * FROM asks ORDER BY id DESC").all();
  }
  return rows.map((r) => ({
    id: r.id,
    asker: r.asker,
    title: r.title,
    body: r.body,
    bountyRaw: r.bounty_raw,
    bountyAsset: n.VALID_ASSET,
    status: r.status,
    type: r.type || 'ask',
    acceptedAnswerId: r.accepted_answer_id,
    created_at: r.created_at,
    settlementBlock: r.settlement_block || null,
    settlementVerifiedAt: r.settlement_verified_at || null,
    answers: [],  // not loaded in list view for efficiency
  }));
}

/**
 * Add an answer to an ask. Validates via network.js and persists.
 * Returns { answerId }.
 */
function addAnswer(askId, { answerer, body }) {
  const db = getDb();
  const ask = getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);

  // Use network.js for validation (pass the domain ask object)
  const answerId = n.addAnswer(ask, { answerer, body });
  // persist
  const stmt = db.prepare(
    "INSERT INTO answers (ask_id, answerer, body, status, at) VALUES (?, ?, ?, 'pending', ?)"
  );
  const now = new Date().toISOString();
  stmt.run(askId, answerer, body.trim(), now);
  return { answerId: Number(db.prepare("SELECT last_insert_rowid() AS id").get().id) };
}

/**
 * Accept an answer (only the asker can). Updates both the ask status
 * and the answer status in the database.
 * Returns { askId, answerId }.
 */
function acceptAnswer(askId, answerId, acceptedBy) {
  const db = getDb();
  const ask = getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);

  // Validate via network.js — this checks everything
  n.acceptAnswer(ask, answerId, acceptedBy);

  // Persist: update ask status and accepted answer
  db.prepare("UPDATE asks SET status = 'paid', accepted_answer_id = ? WHERE id = ?")
    .run(answerId, askId);
  db.prepare("UPDATE answers SET status = 'accepted' WHERE id = ? AND ask_id = ?")
    .run(answerId, askId);

  return { askId, answerId };
}

// --- Settlement (Block 15) ---

/**
 * Record an on-chain settlement block hash for an ask that has been accepted
 * (status 'paid'). Returns { ok, settlementBlock, verified }.
 *
 * The block hash is the proof the asker actually sent the bounty on-chain.
 * Callers should verify it against the Nano ledger (verifyBlockPayment)
 * before recording; the store records the block and the verification time.
 */
function recordSettlement(askId, blockHash, { now = new Date().toISOString() } = {}) {
  const db = getDb();
  const ask = getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);
  if (ask.status !== "paid") {
    throw new Error(`cannot settle an ask that is ${ask.status}, only paid asks settle`);
  }
  if (ask.settlementBlock) {
    throw new Error(`ask ${askId} is already settled with block ${ask.settlementBlock}`);
  }
  if (!blockHash || !/^[0-9A-Fa-f]{64}$/.test(String(blockHash))) {
    throw new Error("a settlement is recorded by a 64-hex block hash or not at all");
  }
  db.prepare("UPDATE asks SET settlement_block = ?, settlement_verified_at = ? WHERE id = ? AND status = 'paid'")
    .run(blockHash, now, askId);
  return { ok: true, settlementBlock: blockHash, settledAt: now };
}

/**
 * Standing is distinct counterparts, never volume: the number of DIFFERENT
 * askers who paid an answerer. Unlike network.standing (which counts every
 * paid pair), this counts only asks with a recorded on-chain settlement block.
 *
 * Returns { answerer: distinctSettledAskerCount }.
 */
function getStanding() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT a.id, a.asker, ans.answerer FROM asks a
     JOIN answers ans ON ans.id = a.accepted_answer_id
     WHERE a.status = 'paid' AND a.settlement_block IS NOT NULL`
  ).all();
  const byAnswerer = {};
  for (const r of rows) {
    if (!byAnswerer[r.answerer]) byAnswerer[r.answerer] = new Set();
    byAnswerer[r.answerer].add(r.asker);
  }
  const out = {};
  for (const [answerer, askers] of Object.entries(byAnswerer)) {
    out[answerer] = askers.size;
  }
  return out;
}

module.exports = {
  createAsk,
  getAsk,
  listAsks,
  addAnswer,
  acceptAnswer,
  recordSettlement,
  getStanding,
  resetDb,
  closeDb,
  getDb,
};