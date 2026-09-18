/**
 * payments.js — ledger for non-starter Nano payments from the treasury.
 *
 * The starter rules say one starter per agent, ever, recorded in openings.db. Payments are different:
 * they send custom amounts (e.g. 0.001 XNO to pay a pursekeeper API call), use a different DB, and
 * record a reference/memo. The reservation-before-send pattern is the same: the address + reference
 * pairs are the PRIMARY KEY so two processes cannot pay the same target for the same reason twice.
 *
 * This file is NOT a sender (it never signs or broadcasts a block). It is a ledger. The sender is
 * always send.js (with --pay).
 *
 * State:
 *   reserved  we intend to send and nothing is known to be on-chain yet
 *   sent      the block hash is recorded; this payment is finished
 *   unknown   we asked the network and never learned the outcome
 */

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  target      TEXT NOT NULL,
  reference   TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('reserved','sent','unknown')),
  block       TEXT,
  amount_raw  TEXT NOT NULL,
  settled_at  TEXT,
  note        TEXT,
  PRIMARY KEY (target, reference)
);
CREATE INDEX IF NOT EXISTS payments_state ON payments(state);
`;

const DEFAULT_DB = process.env.UNSTUCK_PAYMENTS_DB || path.join(
  process.env.UNSTUCK_DATA_DIR || path.dirname(process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck"),
  "payments.db"
);

function open(dbPath) {
  dbPath = dbPath || DEFAULT_DB;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(SCHEMA);
  return db;
}

/**
 * Reserve a payment to (target, reference). Returns {ok:true} for a first uncontested reservation.
 */
function reserve(db, target, reference, { amountRaw, now = new Date().toISOString() } = {}) {
  if (!amountRaw) throw new Error("amount_raw is required for payment reservation");
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare(
      "SELECT state, block FROM payments WHERE target = ? AND reference = ?"
    ).get(target, reference);
    if (existing) {
      db.exec("ROLLBACK");
      return { ok: false, reason: `already ${existing.state}`, state: existing.state, block: existing.block || null };
    }
    db.prepare(
      "INSERT INTO payments (target, reference, state, amount_raw, settled_at) VALUES (?, ?, 'reserved', ?, ?)"
    ).run(target, reference, amountRaw, now);
    db.exec("COMMIT");
    return { ok: true, state: "reserved" };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* gone */ }
    return { ok: false, reason: String(e.message || e) };
  }
}

/**
 * Confirm a payment is on-chain.
 */
function confirm(db, target, reference, block, { now = new Date().toISOString() } = {}) {
  if (!block || String(block).length !== 64) throw new Error("a payment is recorded by its block hash or not at all");
  const r = db.prepare(
    "UPDATE payments SET state='sent', block=?, settled_at=? WHERE target=? AND reference=? AND state='reserved'"
  ).run(block, now, target, reference);
  if (r.changes !== 1) throw new Error(`no reservation to confirm for ${target} / ${reference}`);
  return { ok: true, block };
}

/**
 * Release a reservation without sending (validation failure, etc).
 */
function release(db, target, reference, reason) {
  if (!reason) throw new Error("a payment reservation is only released with a stated reason");
  const r = db.prepare(
    "DELETE FROM payments WHERE target=? AND reference=? AND state='reserved'"
  ).run(target, reference);
  return { ok: r.changes === 1 };
}

/**
 * Mark a payment as unknown outcome (network was asked, answer was lost).
 */
function markUnknown(db, target, reference, note, { now = new Date().toISOString() } = {}) {
  const r = db.prepare(
    "UPDATE payments SET state='unknown', note=?, settled_at=? WHERE target=? AND reference=? AND state='reserved'"
  ).run(String(note || "outcome unknown"), now, target, reference);
  return { ok: r.changes === 1 };
}

/**
 * All sent payments.
 */
function paymentsSent(db) {
  return db.prepare(
    `SELECT target, reference, block, amount_raw, settled_at AS sent_at, note
       FROM payments WHERE state='sent' ORDER BY settled_at`
  ).all();
}

module.exports = {
  open, reserve, confirm, release, markUnknown, paymentsSent,
  DEFAULT_DB,
};