#!/usr/bin/env node
/**
 * Write the public ledger from the database, never by hand.
 *
 * The first version of getunstuck.space carried numbers a person typed next to a database that knew better, and they
 * drifted immediately: the page said nothing had happened while eleven starters had gone out and opened nothing. A
 * published claim has to be a projection of the record, so this reads `openings.db` and emits `site/ledger.json`.
 *
 * It publishes what can be proved and separates it from what was merely spent:
 *   starters_sent        we broadcast a send  (spending)
 *   accounts_opened      our block IS the account's open block, checked against the chain  (adoption)
 *   unreceived           the send is still sitting there, never received
 * A row is only listed under `opened` when it has been verified. Run `send.js --verify` first, or the numbers below
 * will honestly report how many are unverified rather than guessing in our favour.
 *
 * Usage: node publish.js [path/to/ledger.json]
 */

const fs = require("fs");
const path = require("path");
const led = require("./openings.js");

const DB = process.env.UNSTUCK_LEDGER_DB || "/root/.unstuck/openings.db";
const OUT = process.argv[2] || "/root/unstuck/site/ledger.json";
const ACCOUNT = process.env.UNSTUCK_ACCOUNT || "";
const OPEN_BLOCK = process.env.UNSTUCK_OPEN_BLOCK || "";
const STARTER_RAW = require("./opener.js").STARTER_RAW /* never the environment (owner, 2026-09-18) */;

function main() {
  const db = led.open(DB);
  const c = led.counts(db);
  const opened = led.opened(db);

  // Anything still unverified is reported as unverified. It is never counted as an opening, and never quietly dropped.
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const doc = {
    updated: new Date().toISOString().slice(0, 10),
    opener: ACCOUNT || previous.opener || null,
    opener_open_block: OPEN_BLOCK || previous.opener_open_block || null,
    starter_raw: STARTER_RAW,
    starter_xno: String(Number(BigInt(STARTER_RAW)) / 1e30),
    opened: opened.map((r) => ({
      account: r.account,
      block: r.block,
      opened_at: r.opened_at,
      verified_at: r.verified_at,
      found_via: r.found_via,
    })),
    counts: {
      starters_sent: c.starters_sent,
      accounts_opened: c.opened_by_us,
      not_opened_by_us: c.not_opened_by_us,
      unreceived: c.unreceived,
      unverified: c.unverified,
      // These two are the numbers that actually matter, and they stay zero until they are measured honestly:
      // agents active in public (with the sources counted), and transactions we had no part in.
      agents_demonstrably_active: previous.counts?.agents_demonstrably_active ?? 0,
      denominator_sources: previous.counts?.denominator_sources ?? [],
      unsubsidised_transactions: previous.counts?.unsubsidised_transactions ?? 0,
    },
  };
  if (previous.what_happened_to_the_first_eleven) {
    doc.what_happened_to_the_first_eleven = previous.what_happened_to_the_first_eleven;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: OUT, ...doc.counts }, null, 2));
  return 0;
}

process.exit(main());
