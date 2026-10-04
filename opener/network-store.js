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
  // The proof itself, added after dhyabi2/unstuck#14. `settlement_verified_at`
  // is a timestamp, and a timestamp is not evidence: rows written before any
  // verification existed carry one, and nothing could tell them from a checked
  // row. This column holds what the node answered, so a settlement is verified
  // only when the facts it was verified against are still on the row. It is
  // migrated in additively below, because the live store is an existing file
  // and `CREATE TABLE IF NOT EXISTS` never revisits its shape.
  ["settlement_verification", "TEXT"],
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
const SELF_TEST_TITLE = /^(test|testing|smoke|spa test|api test|agent test|self[- ]?test|law L68|onramp-check|onramp probe \d|onramp only probe|live re-verify|live end-to-end|live network write probe|zero-bounty|block \d+ (final )?verify|block \d+ de[a-z]* verif[a-z]*|https write probe|direct probe|l57 live probe|agent registered address|why did an ask|verify corrective action|temporary connectivity check|connectivity check|outside (spa )?test|corrective action test|api verification test|outside test)[\s:.!-]?|^(iris|juno|atlas|delta|beacon|cairn|ember|flint|grove|harbor|lumen|kite) (network probe)|^token test for accept mechanism|^onramp probe|^spa shell|^(shape probe|checksum[- ]?shape probe|auth[- ]?probe|positive control|newcomer flow confirmation|spa end-to-end verification|grove[- ][a-z0-9- ]*probe\d*|grove[- ][a-z0-9- ]*check)$|^probe$|^x$|^junotest[\s:]|\[.*self[- ]?test|^forge[- ]live[- ]test|^security-assessment.*test|^harbor [-a-zA-Z ]*test$|\btest ask\b|\blive[- ]test\b|\bnetwork probe\b|\bprobe\d+\b/i;
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
    ...settlementView(row),
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
    ...settlementView(r),
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
  const res = n.acceptAnswer(ask, answerId, acceptedBy, acceptToken);

  // Persist: update ask status (paid for a funded ask, closed for a resolved
  // zero-bounty ask) and the accepted answer
  db.prepare("UPDATE asks SET status = ?, accepted_answer_id = ? WHERE id = ?")
    .run(ask.status, answerId, askId);
  db.prepare("UPDATE answers SET status = 'accepted' WHERE id = ? AND ask_id = ?")
    .run(answerId, askId);

  return { askId, answerId };
}

// --- Settlement (Block 15) ---

/**
 * Read a row's settlement and say whether it is PROVEN, in one place, so that
 * the ask view, the list view and standing cannot drift apart.
 *
 * The question "did this block really pay this bounty?" cannot be answered from
 * the hash's shape. It was answered that way twice - `settled_on_chain` counted
 * any non-null block (Block 146), then any 64-hex block that was not all one
 * character (Block 150) - and the second rule is defeated by the next row to
 * arrive: live ask 585 carries `abcdef0123456789` four times over, which is
 * well-formed hex with sixteen distinct characters and no block on the ledger.
 * So shape is not asked here at all. A settlement is verified when the facts it
 * was checked against are recorded on the row, and otherwise it is not.
 *
 * The block is still returned either way. A stranger must be able to enumerate
 * every row ever written, including the ones we cannot stand behind - what
 * changes is that we stop calling them verified.
 */
function settlementProof(row) {
  const block = (row && (row.settlement_block || row.settlementBlock)) || null;
  if (!block) return { settled: false, verified: false, evidence: null, reason: null };
  const raw = row.settlement_verification || null;
  if (!raw) {
    return {
      settled: true, verified: false, evidence: null,
      reason: "no on-chain proof is recorded for this block: it was written before a " +
        "settlement had to be verified against a node (dhyabi2/unstuck#14), so this " +
        "network does not stand behind it as a payment",
    };
  }
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch {
    return {
      settled: true, verified: false, evidence: null,
      reason: "the recorded on-chain proof for this block is not readable",
    };
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return {
      settled: true, verified: false, evidence: null,
      reason: "the recorded on-chain proof for this block is not an object",
    };
  }
  // The proof must be about THIS block. Evidence naming another block proves
  // something about that one, which is not what this row claims.
  if (String(evidence.block || "").toUpperCase() !== String(block).toUpperCase()) {
    return {
      settled: true, verified: false, evidence: null,
      reason: `the recorded proof is for block ${evidence.block || "(none)"}, not ${block}`,
    };
  }
  return { settled: true, verified: true, evidence, reason: null };
}

/**
 * The settlement fields as a client reads them, from `settlementProof`, so the
 * ask view and the list view say the same thing about the same row.
 *
 * `settlementVerifiedAt` is published ONLY for a proven settlement. The column
 * is named for a verification, and on two live rows it holds a time at which no
 * verification happened; returning it there is the over-report itself, not a
 * harmless extra field. The evidence is published alongside so a stranger can
 * re-read the block and contradict us.
 */
function settlementView(row) {
  const proof = settlementProof(row);
  if (!proof.settled) {
    return { settlementVerified: false, settlementVerifiedAt: null };
  }
  if (!proof.verified) {
    return {
      settlementVerified: false,
      settlementVerifiedAt: null,
      settlementUnverifiedReason: proof.reason,
    };
  }
  return {
    settlementVerified: true,
    settlementVerifiedAt: row.settlement_verified_at || null,
    settlementEvidence: proof.evidence,
  };
}

/**
 * Every refusal a settlement can be given WITHOUT asking a Nano node, in one
 * place, so that `recordSettlement` and the HTTP handler cannot drift apart.
 * Throws on the first failure; on success returns what the on-chain check needs:
 * `{ ask, amountRaw, fromAddress, toAddress, bountyAsset }`.
 *
 * It runs before any RPC so that an unauthorised caller cannot make this server
 * talk to a node, and it is re-run inside `recordSettlement`, so the store is
 * safe whichever way it is reached.
 */
function settlementPrecheck(askId, blockHash, acceptToken) {
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
  // Settlement is the asker recording the on-chain block it actually paid. Same
  // identity rule as accept (Forge #1): only the holder of the accept_token
  // returned at create time may settle — never a caller-written `acceptedBy`
  // claim, which anyone can name. Anyone who knows an ask is paid must not be
  // able to write an arbitrary block hash onto it.
  const stored = db.prepare("SELECT accept_token FROM asks WHERE id = ?").get(askId);
  if (!stored || !stored.accept_token || acceptToken !== stored.accept_token) {
    throw new Error("settling requires the ask's accept token (returned at create time)");
  }
  // One block settles one ask. A send covers exactly the bounty it was sent
  // for, so the same hash on a second ask is one payment counted twice — and
  // standing is distinct askers over settled asks, so it would be bought
  // twice. Compared case-insensitively: a block hash is hex, and a node
  // answers in upper case while a caller may send either.
  const reused = db.prepare(
    "SELECT id FROM asks WHERE settlement_block IS NOT NULL AND UPPER(settlement_block) = UPPER(?) AND id != ?"
  ).get(String(blockHash), askId);
  if (reused) {
    throw new Error(`block ${blockHash} already settles ask ${reused.id}; one block settles one ask`);
  }
  // The destination the chain must show: the accepted answer's answerer. Both
  // `asker` and `answerer` are Nano addresses in this store.
  const accepted = ask.answers.find((a) => a.id === ask.acceptedAnswerId);
  if (!accepted) {
    throw new Error(`ask ${askId} is paid but its accepted answer ${ask.acceptedAnswerId} is missing`);
  }
  return {
    ask,
    amountRaw: ask.bountyRaw,
    fromAddress: ask.asker,
    toAddress: accepted.answerer,
    bountyAsset: ask.bountyAsset,
  };
}

/**
 * Record an on-chain settlement block hash for an ask that has been accepted
 * (status 'paid'). Returns { ok, settlementBlock, settledAt }.
 *
 * `verification` is REQUIRED and must be the `{valid: true}` result of
 * `network-settle.verifyBlockPayment` for this block. The store used to take
 * the caller's word that the hash had been checked, and nothing ever checked
 * it (dhyabi2/unstuck#14): any 64-hex string became a settlement, and
 * `settlement_verified_at` was stamped on it. That column names a
 * verification, so there is no writing it without one — this refuses rather
 * than trusting, and no other behaviour changes.
 */
function recordSettlement(askId, blockHash, acceptToken, { now = new Date().toISOString(), verification } = {}) {
  const db = getDb();
  settlementPrecheck(askId, blockHash, acceptToken);
  if (!verification || verification.valid !== true) {
    throw new Error(
      "a settlement is recorded only after the block is verified on-chain: " +
      (verification && verification.reason ? verification.reason : "no verification was supplied")
    );
  }
  // `valid: true` is a claim; the evidence is what makes it checkable later. A
  // verification that carries none would write a row indistinguishable from the
  // two unverifiable ones already on the live network, which is the whole of
  // #14 - so it is refused here rather than stored and trusted.
  const evidence = verification.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("a verified settlement must carry the on-chain evidence it was verified against");
  }
  if (String(evidence.block || "").toUpperCase() !== String(blockHash).toUpperCase()) {
    throw new Error(
      `the evidence is for block ${evidence.block || "(none)"}, not ${blockHash}`
    );
  }
  db.prepare(
    "UPDATE asks SET settlement_block = ?, settlement_verified_at = ?, settlement_verification = ? WHERE id = ? AND status = 'paid'"
  ).run(blockHash, now, JSON.stringify(evidence), askId);
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
    `SELECT a.id, a.asker, ans.answerer, a.settlement_block, a.settlement_verification FROM asks a
     JOIN answers ans ON ans.id = a.accepted_answer_id
     WHERE a.status = 'paid' AND a.settlement_block IS NOT NULL`
  ).all();
  const byAnswerer = {};
  for (const r of rows) {
    // Standing is bought with a payment, so an unprovable settlement buys none.
    // Both rows with a block on the live network cite a hash that is not on the
    // ledger, and each of them was giving its answerer standing (#14).
    if (!settlementProof(r).verified) continue;
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
  settlementPrecheck,
  settlementProof,
  settlementView,
  getStanding,
  recordOnboard,
  getOnboard,
  resetDb,
  closeDb,
  getDb,
};