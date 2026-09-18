#!/usr/bin/env node
/**
 * bridge-audit.js — what the record actually says, checked against the two rules
 * the owner set on 2026-09-18.
 *
 * The opening template (opening.js) guarantees the disclosure is sent from now on.
 * This is the other half: it reads bridge.db — the real record, the thing the public
 * conversation repo is exported from — and reports every conversation that breaks a
 * rule, so a violation is visible instead of assumed fixed.
 *
 * Two rules, both from the operator's 17:30 corrective action:
 *
 *   1. DISCLOSURE — the first message sent to an outside agent says the exchange is
 *      published as open research. Thirteen of the first thirteen did not, while all
 *      sixteen exported files were public. Those cannot be un-sent; they are reported
 *      as legacy violations, once, so the number is on the record rather than hidden.
 *   2. THREE MESSAGES — an agent that has never answered something we actually said
 *      gets at most three messages, then we stop with it permanently. An agent that
 *      HAS answered is not capped by this; the cap is on talking at someone.
 *
 * Usage:
 *   node bridge-audit.js                 # human summary
 *   node bridge-audit.js --json          # machine-readable
 *   node bridge-audit.js --strict        # exit 1 if any violation exists
 *   node bridge-audit.js --legacy-before <unix-ts>   # treat first contacts before ts as legacy
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { hasDisclosure, MESSAGE_CAP } = require("./opening.js");

const DB_PATH = process.env.BRIDGE_DB || path.join(__dirname, "bridge.db");

/** The moment the disclosure rule was put in the template — first contacts after it are not legacy. */
const DISCLOSURE_RULE_FROM = Number(process.env.DISCLOSURE_RULE_FROM || 1789754375);

function loadRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const agents = db
      .prepare("SELECT agent, source_url, pays_in, status, note, first_at, last_at FROM agents")
      .all();
    const messages = db
      .prepare("SELECT id, agent, direction, text, at FROM messages ORDER BY agent, id")
      .all();
    return { agents, messages };
  } finally {
    db.close();
  }
}

/**
 * Audit a set of agents and messages. Pure: the same rows in give the same verdicts
 * out, which is what lets the test run it against a fixture instead of the live store.
 */
function audit({ agents, messages }, { disclosureFrom = DISCLOSURE_RULE_FROM } = {}) {
  const byAgent = new Map();
  for (const m of messages) {
    if (!byAgent.has(m.agent)) byAgent.set(m.agent, []);
    byAgent.get(m.agent).push(m);
  }

  const rows = [];
  for (const a of agents) {
    const msgs = byAgent.get(a.agent) || [];
    const out = msgs.filter((m) => m.direction === "out");
    const inbound = msgs.filter((m) => m.direction === "in");
    const firstOut = out[0] || null;
    const firstAt = firstOut ? firstOut.at : a.first_at;
    const legacy = firstAt < disclosureFrom;

    const disclosed = firstOut ? hasDisclosure(firstOut.text) : false;
    // A conversation nobody has opened is not a violation — there is no first message yet.
    const missingDisclosure = Boolean(firstOut) && !disclosed;
    // The cap bites only when we have talked at someone and they have not answered.
    const overCap = inbound.length === 0 && out.length > MESSAGE_CAP;
    const atCap = inbound.length === 0 && out.length === MESSAGE_CAP;

    rows.push({
      agent: a.agent,
      status: a.status,
      pays_in: a.pays_in,
      out: out.length,
      in: inbound.length,
      first_out_at: firstOut ? firstOut.at : null,
      disclosed,
      missing_disclosure: missingDisclosure,
      legacy: legacy && missingDisclosure,
      over_cap: overCap,
      at_cap: atCap,
      answered: inbound.length > 0,
    });
  }

  const legacy = rows.filter((r) => r.legacy);
  const violations = rows.filter((r) => r.missing_disclosure && !r.legacy);
  const overCap = rows.filter((r) => r.over_cap);

  return {
    agents: rows.length,
    with_first_message: rows.filter((r) => r.first_out_at !== null).length,
    disclosed: rows.filter((r) => r.disclosed).length,
    legacy_violations: legacy.map((r) => r.agent),
    violations: violations.map((r) => r.agent),
    over_cap: overCap.map((r) => `${r.agent} (${r.out} sent, ${r.in} answered)`),
    rows,
  };
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const dbPath = (() => {
    const i = args.indexOf("--db");
    return i === -1 ? DB_PATH : args[i + 1];
  })();
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`no bridge database at ${dbPath}\n`);
    process.exit(2);
  }
  const result = audit(loadRows(dbPath));
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 1) + "\n");
  } else {
    process.stdout.write(
      `bridge-audit: ${result.agents} agents, ${result.with_first_message} with a first message, ` +
        `${result.disclosed} disclosure-compliant\n`
    );
    if (result.legacy_violations.length) {
      process.stdout.write(
        `LEGACY (opened before the disclosure rule, cannot be un-sent): ${result.legacy_violations.join(", ")}\n`
      );
    }
    if (result.violations.length) {
      process.stdout.write(`MISSING DISCLOSURE: ${result.violations.join(", ")}\n`);
    }
    if (result.over_cap.length) {
      process.stdout.write(`OVER THE ${MESSAGE_CAP}-MESSAGE CAP with no answer: ${result.over_cap.join(", ")}\n`);
    }
    if (!result.violations.length && !result.over_cap.length) {
      process.stdout.write("no open violation\n");
    }
  }
  if (strict && (result.violations.length || result.over_cap.length)) process.exit(1);
}

if (require.main === module) main(process.argv);

module.exports = { audit, loadRows, DISCLOSURE_RULE_FROM };
