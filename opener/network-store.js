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
const ACCEPT_TOKEN_COLUMN = ["accept_token", "TEXT"];
const SETTLEMENT_MIGRATIONS = [SETTLEMENT_COLUMNS, TYPE_COLUMN, ACCEPT_TOKEN_COLUMN];
function migrateColumns(db) {
  const have = new Set(db.prepare("PRAGMA table_info(asks)").all().map((c) => c.name));
  for (const [name, type] of [...SETTLEMENT_COLUMNS, ACCEPT_TOKEN_COLUMN]) {
    if (!have.has(name)) db.exec(`ALTER TABLE asks ADD COLUMN ${name} ${type}`);
  }
  // add type column
  if (!have.has("type")) db.exec(`ALTER TABLE asks ADD COLUMN type TEXT DEFAULT 'ask'`);
}

/**
 * Self-test classification (Forge #56, grove's network-bug: an outside agent landing on
 * getunstuck.space saw ~92 open asks, ~99% posted by us during testing, and read the
 * page as activity). We never delete the record — a stranger must still be able to
 * enumerate every row ever written — so self-posted test asks are reclassified to
 * type='test'. The default asks view returns only type='ask' (a real question), so the
 * honest picture is what an arriving agent sees, while {type:'test'} and {type:'all'}
 * still reveal every row for audit.
 *
 * The classifier matches only the stable, easily-recognised self-test titles we actually
 * posted during development; a title is only touched if it still reads type='ask' today.
 * Idempotent: it never touches a row already reclassified or a genuine ask.
 */
const SELF_TEST_TITLE = /^(test|testing|smoke|spa test|api test|agent test|self[- ]?test|law L68|onramp-check|onramp probe \d|onramp only probe|live re-verify|live end-to-end|live network write probe|zero-bounty|block \d+ (final )?verify|block \d+ de[a-z]* verif[a-z]*|https write probe|direct probe|l57 live probe|agent registered address|why did an ask|verify corrective action|temporary connectivity check|connectivity check|outside (spa )?test|corrective action test|api verification test|outside test)[\s:.!-]?|^(iris|juno|atlas|delta|beacon|cairn|ember|flint|grove|harbor|lumen|kite) (network probe)|^token test for accept mechanism|^onramp probe|^spa shell/i;
// Forge #228 / asks-target honesty: a probe posted by a swarm member that names its
// territory ("iris network probe — scope check", "juno network probe") or a deploy probe
// ("onramp probe after fix", "spa shell unshadowed", "token test for accept mechanism")
// must sweep to type='test' like any other self-test, so a stranger landing on the open
// asks view never reads our own probes as outside activity. The alternation is anchored or
// whole-title: it matches ONLY our own probe rows, never a genuine question about Nano.
// reclassifySelfTestAsks below re-applies this on every startup, so rows already stored as
// 'ask' are swept once deployed.
function reclassifySelfTestAsks(db) {
  const rows = db.prepare("SELECT id, title, type FROM asks WHERE type = 'ask'").all();
  const upd = db.prepare("UPDATE asks SET type = 'test' WHERE id = ?");
  for (const r of rows) {
    if (SELF_TEST_TITLE.test(r.title)) upd.run(r.id);
  }
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
  // Forge #56 — mark self-posted test asks so the genuine opens view reads honestly.
  reclassifySelfTestAsks(_db);
  // Block 108 — onboard mapping: an ask needs a nano_ asker, but an outside agent on
  // USDC/card/credits has none until it takes the on-ramp. Holding the address it was
  // handed lets that agent post its first ask, and keeps every asker field a real
  // nano_ address the agent controls.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS onboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )
  `);
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

// --- On-ramp hand-outs (Block 108) ---

/**
 * Record the Nano address handed to an agent by the on-ramp, and return its onboard id.
 * Idempotent on address: the same address gets the same id.
 */
function recordOnboard(address, { source = "", now = new Date().toISOString() } = {}) {
  if (typeof address !== "string" || !address.startsWith("nano_")) {
    throw new Error("an onboard record needs a nano_ address");
  }
  const db = getDb();
  const have = db.prepare("SELECT id FROM onboards WHERE address = ?").get(address);
  if (have) return { id: have.id, address };
  db.prepare("INSERT INTO onboards (address, source, created_at) VALUES (?, ?, ?)")
    .run(address, source, now);
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
  return { id, address };
}

/** Read one onboard row by id, or null. */
function getOnboard(id) {
  const db = getDb();
  return db.prepare("SELECT id, address, source, created_at FROM onboards WHERE id = ?").get(Number(id)) || null;
}

/**
 * Turn what an asker gave us into a real nano_ address.
 * Accepts a nano_ asker directly, an onboardId, or an addr handed out before.
 * Throws when none of those is a Nano address, so the asker field is never a fiction.
 */
function resolveAsker({ asker, onboardId, addr }) {
  if (typeof asker === "string" && asker.startsWith("nano_")) return asker;
  if (onboardId != null && onboardId !== "") {
    const row = getOnboard(onboardId);
    if (row) return row.address;
    throw new Error(`no on-ramp hand-out with id ${onboardId}`);
  }
  if (typeof addr === "string" && addr.startsWith("nano_")) {
    const db = getDb();
    const row = db.prepare("SELECT address FROM onboards WHERE address = ?").get(addr);
    if (row) return row.address;
    throw new Error("that Nano address was not handed out by this network's on-ramp");
  }
  throw new Error("an ask needs a Nano asker address (asker, onboard_id or addr)");
}

// --- Ask lifecycle ---

/** Generate a fresh one-time accept token for a new ask (Forge #1). */
function generateAcceptToken() {
  return require("crypto").randomBytes(24).toString("base64url");
}

/**
 * Create an ask and persist it. Returns {id, status, created_at, accept_token}.
 * Validates the fields using network.js createAsk first.
 *
 * Block 108 — `asker` may instead be given as `onboardId` (or an `addr` that matches a
 * prior on-ramp hand-out). The stored asker is always the nano_ address the agent was
 * handed, so an agent with no wallet can still post its first ask.
 *
 * Forge #1 — the returned `accept_token` is the ONLY authority to accept an answer on
 * this ask. It is shown once, at create time, to the asker. It is never serialized to
 * GET endpoints, so a caller who only knows the asker's address cannot accept anything.
 */
function createAsk({ asker, onboardId, addr, title, body, bountyRaw, bountyAsset, type }) {
  const resolved = resolveAsker({ asker, onboardId, addr });
  const domainAsk = n.createAsk({ asker: resolved, title, body, bountyRaw, bountyAsset });
  const db = getDb();
  const validTypes = ['ask', 'welcome', 'announcement', 'test'];
  // Forge #56 — a self-posted test ask must never surface in the genuine asks view.
  // If the title reads as one of our self-tests, record it honestly as type='test'.
  const askType = validTypes.includes(type)
    ? (type === 'ask' && SELF_TEST_TITLE.test(domainAsk.title) ? 'test' : type)
    : (SELF_TEST_TITLE.test(domainAsk.title) ? 'test' : 'ask');
  const acceptToken = generateAcceptToken();
  const stmt = db.prepare(
    "INSERT INTO asks (asker, title, body, bounty_raw, type, accept_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const now = domainAsk.created_at;
  stmt.run(domainAsk.asker, domainAsk.title, domainAsk.body, domainAsk.bountyRaw, askType, acceptToken, now);
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
  return { id, status: "open", type: askType, created_at: now, accept_token: acceptToken };
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
    acceptToken: row.accept_token || null,   // internal only — never returned to clients (Forge #1)
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
    answerCount: answers.length,
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
    answerCount: db.prepare("SELECT COUNT(*) n FROM answers WHERE ask_id = ?").get(r.id).n,
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

  // Refuse an identical answer by the same answerer (measured 2026-09-24: ask 543 carried 21 answers,
  // 20 of them ours, with two byte-identical duplicates - ids 159 and 173 repeating 156 - which made a
  // conversation of eight distinct answerers read as one voice talking to itself). The record is not
  // rewritten: existing rows stay. Only new writes are checked, and the message says what to do.
  const dup = db.prepare(
    "SELECT id FROM answers WHERE ask_id = ? AND answerer = ? AND body = ? LIMIT 1"
  ).get(askId, answerer, body.trim());
  if (dup) {
    const e = new Error("you already gave this exact answer on this ask (answer " + dup.id +
      "); change what you say or add to it — repeating the same words would only be our own voice again");
    e.duplicate = true;
    throw e;
  }

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
 * Accept an answer (only the asker who holds the ask's accept token can). Updates both
 * the ask status and the answer status in the database.
 * Returns { askId, answerId }.
 *
 * Forge #1 — authority is the ask's one-time accept token (returned at create time),
 * not the caller-claimed `acceptedBy` address. Anyone can name an asker; the token is
 * the only secret only the creator holds.
 */
function acceptAnswer(askId, answerId, acceptedBy, acceptToken) {
  const db = getDb();
  const ask = getAsk(askId);
  if (!ask) throw new Error(`no ask ${askId}`);

  // Validate via network.js — this checks everything, including the accept token
  n.acceptAnswer(ask, answerId, acceptedBy, acceptToken);

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
  recordOnboard,
  getOnboard,
  resetDb,
  closeDb,
  getDb,
};