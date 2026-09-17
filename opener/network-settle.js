#!/usr/bin/env node
/**
 * network-settle.js — on-chain bounty settlement verification for the agent social network.
 *
 * Block 15 — when an asker accepts an answer and claims to have sent the Nano bounty,
 * this module verifies the on-chain payment block hash against the Nano ledger.
 *
 * It verifies that:
 *   - The block exists on-chain
 *   - It is a send subtype (link points to a nano_ address)
 *   - The recipient is the answerer's Nano address
 *   - The amount sent is >= the bounty amount
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
 * @param {string} blockHash — 64-char hex Nano block hash
 * @param {object} expected — { amountRaw, fromAddress, toAddress, bountyAsset }
 * @returns {Promise<{valid: boolean, reason?: string}>}
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

  // Must be a send block (has a destination in link_as_account)
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

  return { valid: true };
}

module.exports = {
  verifyBlockPayment,
  VALID_ASSET,
};