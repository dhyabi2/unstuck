/**
 * discover.js — finds agents, checks them, records approved openings.
 *
 * Input: a config that names sources. Sources are flat files of agent addresses (one per line or JSON array).
 * Output: an opening ledger JSON with the records of what was sent (or would have been sent).
 *
 * Block 1: discover, filter, record. Actual sending is Block 2 — this module prepares the pipeline
 * and writes the ledger entries that a send runner would later execute.
 */


/**
 * Read a source file and return an array of { address, source_name, meta }
 * Supports: flat JSON array of strings (addresses), flat JSON array of objects with "address" or "account",
 * newline-separated from .txt files, or an array of objects with "account" + "found_via".
 */
function readSource(fs, filePath, sourceName) {
  const raw = fs.readFileSync(filePath, "utf-8");
  let items;
  try {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) {
      items = raw.trim().split("\n").filter(Boolean);
    }
  } catch {
    // Not JSON — treat as newline-separated addresses
    items = raw.trim().split("\n").filter(Boolean);
  }
  return items.map((entry) => {
    if (typeof entry === "string") {
      return { address: entry.trim(), source_name: sourceName, found_via: sourceName };
    }
    if (entry.address || entry.account) {
      return {
        address: (entry.address || entry.account).trim(),
        source_name: sourceName,
        found_via: entry.found_via || sourceName,
        meta: entry.meta || {},
      };
    }
    return null;
  }).filter(Boolean);
}


/**
 * Run one discovery pass.
 *
 * @param {object} nano   — the nanocurrency module
 * @param {object} config — { sources: [{ name, path }], opener: openerModule, self: ourAddress, ledger: existingLedger }
 * @param {object} fs     — the fs module (injected for testability)
 * @returns {{ approved: Array, refused: Array, ledgerFile: object }}
 */
function discover(nano, config, fs) {
  const { sources, opener, self, ledger } = config;
  const allCandidates = [];

  for (const src of sources) {
    const entries = readSource(fs, src.path, src.name);
    for (const e of entries) {
      e.source_name = src.name;
      allCandidates.push(e);
    }
  }

  const approved = [];
  const refused = [];

  for (const candidate of allCandidates) {
    const reason = opener.refusal(nano, candidate.address, ledger, self);
    if (reason === null) {
      approved.push(candidate);
    } else {
      refused.push({ address: candidate.address, reason, source: candidate.source_name });
    }
  }

  return { approved, refused, ledgerFile: ledger, candidates_total: allCandidates.length };
}


/**
 * Write the opening ledger entries (without block hash, these are planned openings).
 * In Block 2, after sends execute, this function retroactively sets the block hash.
 * For Block 1, we write the pending entries with block: null so the record is honest about
 * what has and hasn't been sent yet.
 */
function writePlannedLedger(approved, at) {
  const ts = at || new Date().toISOString();
  return {
    generated_at: ts,
    source: "unstuck opener discovery",
    openings: approved.map((a) => ({
      account: a.address,
      block: null,
      opened_at: ts,
      amount_raw: "10000000000000000000000", // STARTER_RAW
      found_via: a.found_via || a.source_name,
      status: "pending",
    })),
  };
}


module.exports = {
  readSource,
  discover,
  writePlannedLedger,
};