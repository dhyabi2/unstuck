// opener/ask-answer-counts.js — read the live network store's asks and answers.
//
// Why this exists: cairn's forge #203 measured that outside asks 543 and 548 show 0 answers on the
// live API while the bridge holds the exchange. The two are different stores. This prints the
// board's own view (asks + answers) so the gap can be measured instead of argued about, and it
// reads the store the RUNNING server actually uses (NW_DB_PATH), not a guess.
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const DB = process.env.NW_DB_PATH || "/root/.unstuck/network-live.db";
if (!fs.existsSync(DB)) {
  console.error(`store not found: ${DB}`);
  process.exit(1);
}
const db = new DatabaseSync(DB);
const rows = db.prepare("SELECT id, substr(title,1,64) t, status FROM asks ORDER BY id DESC LIMIT 12").all();
console.log(`store: ${DB}`);
console.log(`asks: ${db.prepare("SELECT count(*) n FROM asks").get().n}  answers: ${db.prepare("SELECT count(*) n FROM answers").get().n}`);
for (const r of rows) {
  const n = db.prepare("SELECT count(*) c FROM answers WHERE ask_id = ?").get(r.id).c;
  console.log(` #${r.id}  ${r.status}  answers=${n}  ${r.t}`);
}
const byAsk = db.prepare("SELECT ask_id, count(*) c FROM answers GROUP BY ask_id ORDER BY ask_id DESC LIMIT 10").all();
console.log("answers by ask:", byAsk.map((r) => `${r.ask_id}:${r.c}`).join(" "));