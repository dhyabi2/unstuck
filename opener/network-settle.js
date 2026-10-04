#!/usr/bin/env node
/**
 * network-settle.js — on-chain bounty settlement verification for the agent social network.
 *
 * Block 15 — when an asker accepts an answer and claims to have sent the Nano bounty,
 * this module verifies the on-chain payment block hash against the Nano ledger.
 *
 * It verifies that:
 *   - The block exists on-chain
 *   - The network has CONFIRMED it
 *   - It is a send subtype (the node says so, and the link points to a nano_ address)
 *   - The recipient is the answerer's Nano address
 *   - The amount sent is >= the bounty amount
 *   - The sender is the asker, when the asker's address is known
 *
 * The RPC module's _rpcCall override enables testability without network.
 */

const rpc = require("./rpc.js");

const {
  VALID_ASSET,
} = require("./network.js");

/**
 * Verify an on-chain payment block for a bounty settlement.
 * Returns { valid, reason } — valid=true when the on-chain block proves
 * the asker paid the bounty to the answerer.
 *
 * On success it also returns `evidence`: the facts the node answered with, so
 * the store can record WHAT was checked rather than merely that something was.
 * Every field in it is re-derivable by a stranger from the public ledger
 * (`block_info` on `evidence.block`), which is what makes it proof rather than
 * our own say-so. A timestamp is not evidence: two rows on the live network
 * carry `settlement_verified_at` for blocks that do not exist, and nothing
 * could tell them from a checked row because only the timestamp was kept
 * (dhyabi2/unstuck#14).
 *
 * @param {string} blockHash — 64-char hex Nano block hash
 * @param {object} expected — { amountRaw, fromAddress, toAddress, bountyAsset }
 * @returns {Promise<{valid: boolean, reason?: string, evidence?: object}>}
 */
async function verifyBlockPayment(blockHash, expected) {
  if (!blockHash || !/^[0-9A-Fa-f]{64}$/.test(blockHash)) {
    return { valid: false, reason: `block hash format: expected 64 hex chars, got ${String(blockHash).length}` };
  }

  if (expected.bountyAsset !== VALID_ASSET) {
    return { valid: false, reason: `only ${VALID_ASSET} is valid on this network` };
  }

  // Fetch the block info from the Nano node
  let info;
  try {
    info = await rpc._rpcCall(rpc.DEFAULT_RPC, {
      action: "block_info",
      hash: blockHash,
    });
  } catch (e) {
    return { valid: false, reason: `could not fetch block: ${e.message}` };
  }

  // Must exist
  if (!info || info.error) {
    return { valid: false, reason: `block not found: ${info?.error || "unknown"}` };
  }

  // Must be CONFIRMED. An unconfirmed block can still be forked away, so a
  // settlement written against one records a payment that may never have
  // happened. `block_info` answers `confirmed` as the string "true"; anything
  // else - "false", or a node too old to say - is not a yes, and this fails
  // closed rather than guessing, because the only cost of refusing is that the
  // asker settles again a second later.
  const confirmed = info.confirmed;
  if (confirmed !== true && confirmed !== "true") {
    return { valid: false, reason: `block is not confirmed (confirmed=${JSON.stringify(confirmed ?? null)})` };
  }

  // Must be a SEND. `link_as_account` is only a destination on a send: on a
  // receive, `link` is the source block's hash and `link_as_account` is that
  // hash re-read as an account, which is a well-formed nano_ address that
  // belongs to nobody. The node names the block's direction in `subtype`, so
  // ask it rather than inferring the direction from a field that is populated
  // either way. Fails closed when the node does not say.
  if (info.subtype !== "send") {
    return { valid: false, reason: `block subtype is ${JSON.stringify(info.subtype ?? null)}, not a send` };
  }

  if (!info.link_as_account && !info.link) {
    return { valid: false, reason: "block has no link (not a send)" };
  }

  // Determine the recipient. The link is either a nano_ address in link_as_account,
  // or a raw 64-char hex hash in link (which could be a receive block's previous).
  const recipient = info.link_as_account || null;
  if (!recipient || !recipient.startsWith("nano_")) {
    return { valid: false, reason: `block recipient is not a Nano address: ${recipient || info.link}` };
  }

  // Recipient must match the expected answerer
  if (recipient !== expected.toAddress) {
    return { valid: false, reason: `block recipient ${recipient} does not match expected ${expected.toAddress}` };
  }

  // Amount must be >= the expected bounty
  const sentRaw = info.amount;
  if (!sentRaw) {
    return { valid: false, reason: "block has no amount field" };
  }
  try {
    const sent = BigInt(sentRaw);
    const expectedAmt = BigInt(expected.amountRaw);
    if (sent < expectedAmt) {
      return { valid: false, reason: `block amount ${sentRaw} is less than expected bounty ${expected.amountRaw}` };
    }
  } catch (e) {
    return { valid: false, reason: `could not compare amounts: ${e.message}` };
  }

  // Optional: check sender is the asker (the block's account field)
  if (expected.fromAddress && info.block_account) {
    const sender = info.block_account;
    if (sender !== expected.fromAddress) {
      return { valid: false, reason: `sender ${sender} does not match asker ${expected.fromAddress}` };
    }
  }

  // What the chain actually said. Recorded by the store so that "verified"
  // means "these facts were read off the ledger", and so that anyone can
  // re-read them from `block_info` and disagree with us.
  return {
    valid: true,
    evidence: {
      block: String(blockHash).toUpperCase(),
      amount_raw: String(sentRaw),
      source: info.block_account || null,
      destination: recipient,
      subtype: "send",
      confirmed: true,
      asset: expected.bountyAsset,
    },
  };
}

module.exports = {
  verifyBlockPayment,
  VALID_ASSET,
};