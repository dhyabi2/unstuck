/**
 * The opener: sends exactly one starter to an agent's Nano address, ever.
 *
 * The starter opens an account. It is not a payment for behaviour, so this module has no notion of earning one — it
 * takes an address, refuses it if we have opened it before, and sends. Signing uses the same library and the same call
 * shapes as holdergameDex (`nanocurrency`: deriveSecretKey -> derivePublicKey -> deriveAddress -> signBlock).
 *
 * Everything that decides is a pure function below, so the laws can be tested without a chain, a key or a network.
 */

const STARTER_RAW = "10000000000000000000000"; // 0.00001 XNO
const SEND_DIFFICULTY = "fffffff800000000";

/** A Nano address is checkable offline; we never send to one we cannot check. */
function isAddress(nano, address) {
  return typeof address === "string" && nano.checkAddress(address);
}

/**
 * Why an address may not be opened. Returns null when it may.
 * The ledger is the authority: one starter per agent, ever, and "ever" means what we recorded, not what we remember.
 */
function refusal(nano, address, ledger, self) {
  if (!isAddress(nano, address)) return "not a valid Nano address";
  if (address === self) return "that is our own account";
  if (ledger.opened.some((r) => r.account === address)) return "already opened — a second starter is never sent";
  return null;
}

/** Balance after the send. Throws rather than sending a starter we cannot cover. */
function nextBalance(balanceRaw, starterRaw = STARTER_RAW) {
  const b = BigInt(balanceRaw);
  const s = BigInt(starterRaw);
  if (s <= 0n) throw new Error("starter must be positive");
  if (b < s) throw new Error(`balance ${b} cannot cover the starter ${s}`);
  return (b - s).toString();
}

/**
 * The state block for one starter. `previous` is our account's current frontier — for our very own first send it is
 * the all-zero hash, which is only valid once our account has itself been opened by someone else.
 */
function sendBlock(nano, { secretKey, account, previous, representative, balanceRaw, to, starterRaw = STARTER_RAW }) {
  const balance = nextBalance(balanceRaw, starterRaw);
  const { hash, block } = nano.createBlock(secretKey, {
    work: null,
    previous,
    representative,
    balance,
    link: to,
  });
  return { hash, block, balanceAfter: balance };
}

/** What we write down about an opening. A send we cannot cite by block hash did not happen. */
function ledgerRow({ account, block, at, found_via }) {
  if (!account || !block) throw new Error("an opening is recorded by address and block hash or not at all");
  return { account, block, opened_at: at, amount_raw: STARTER_RAW, found_via: found_via || "unspecified" };
}

/**
 * The honest counts. Anything we funded is excluded from the numerator by construction: this function cannot even see
 * a transaction, only the ones the caller has already classified, and it refuses to fold them together.
 */
function counts({ opened, agentsActive, unsubsidised, sources }) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("a share without its denominator's sources is not publishable");
  }
  return {
    accounts_opened: opened,
    agents_demonstrably_active: agentsActive,
    unsubsidised_transactions: unsubsidised,
    denominator_sources: sources,
    share_opened: agentsActive > 0 ? Math.floor((opened / agentsActive) * 10000) / 10000 : null,
  };
}

module.exports = {
  STARTER_RAW,
  SEND_DIFFICULTY,
  isAddress,
  refusal,
  nextBalance,
  sendBlock,
  ledgerRow,
  counts,
};
