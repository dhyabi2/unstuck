/**
 * sender.js — executes one send from a pending ledger entry, end to end.
 *
 * Given a pending opening (from discover.js) and our treasury credentials, it:
 *   1. Reads our treasury account's current frontier + balance from the Nano network.
 *   2. Generates proof-of-work for the block.
 *   3. Signs the send block (via opener.sendBlock).
 *   4. Broadcasts it to a public Nano node.
 *   5. Records the returned block hash back into the ledger entry (status: pending -> sent).
 *
 * It never retries a send to an address we have already opened, and it never
 * records an opening without a block hash (opener.ledgerRow throws).
 *
 * Block 2 — send integration via Nano RPC.
 */

const rpc = require("./rpc.js");

/**
 * Turn a ledger opened-array and the last-known opened entries into the running
 * set of accounts we must not open again.
 */
function openedSet(ledger, sentLedger = []) {
  const set = new Set();
  for (const row of (ledger && ledger.opened) || []) {
    if (row && row.account) set.add(row.account);
  }
  for (const row of sentLedger) {
    if (row && row.account) set.add(row.account);
  }
  return set;
}

/**
 * Load the treasury's current state (frontier, balance) from the network.
 * If the treasury account has no entries on the ledger yet, we cannot send and
 * throw — our account itself must first be opened by someone else.
 *
 * @param {object} config — { secretKey, account, representative }
 * @param {string} rpcUrl
 * @returns {{ frontier: string, balance: string, representative: string }}
 */
async function loadTreasuryState(config, rpcUrl = rpc.DEFAULT_RPC) {
  const info = await rpc.accountInfo(config.account, rpcUrl);
  if (!info) {
    throw new Error(
      `treasury ${config.account} is not open on the ledger yet — ` +
      `our own account must be opened by someone else before we can send`
    );
  }
  return {
    frontier: info.frontier,
    balance: info.balance,
    representative: config.representative || info.representative,
  };
}

/**
 * Send one starter to a recipient, from the treasury account.
 *
 * @param {object} nano       — nanocurrency module
 * @param {object} opener     — opener module
 * @param {object} config     — { secretKey, account, representative, rpcUrl, workOptions }
 * @param {object} recipient  — { account, found_via }
 * @returns {{ account, block, opened_at, amount_raw, found_via, status }}
 */
async function openStarter(nano, opener, config, recipient) {
  const { secretKey, account, representative, rpcUrl } = config;

  const tx = await rpc.executeSend(nano, opener, {
    secretKey,
    account,
    previous: (await loadTreasuryState(config, rpcUrl)).frontier,
    representative,
    balanceRaw: (await loadTreasuryState(config, rpcUrl)).balance,
    to: recipient.account,
  }, config.workOptions || {});

  // ledgerRow throws unless we have both account and block hash — an opening is
  // recorded by address and block hash or not at all.
  return opener.ledgerRow({
    account: recipient.account,
    block: tx.hash,
    at: new Date().toISOString(),
    found_via: recipient.found_via,
  });
}

module.exports = {
  openedSet,
  loadTreasuryState,
  openStarter,
};
