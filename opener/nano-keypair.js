#!/usr/bin/env node
/**
 * nano-keypair.js — generate a fresh, self-custody Nano keypair with no counterparty.
 *
 * This is the provisioning-layer tool (owner, Sara Nelson, 2026-09-20): an agent that
 * runs this generates its OWN seed + address. Nobody generated the key but the agent
 * itself. The seed never leaves this machine and is never recorded in bridge.db or any
 * conversation — that is what makes it self-custody rather than counterparty custody.
 *
 * Flow it enables (the "deposit not custody" design Sara confirmed acceptable):
 *   1. agent runs `node nano-keypair.js` -> prints seed + address (seed is NOT echoed unless --show-seed)
 *   2. agent publishes its address to whoever will send the starter (us)
 *   3. the starter (0.00001 XNO) is sent INTO the agent's own address
 *   4. the agent receives it and can spend it with nano-x402-client.js
 *
 * Usable against a live Nano RPC, or offline (key generation needs no network).
 *
 *   node nano-keypair.js                 # generate, print address only (seed to stdout is off)
 *   node nano-keypair.js --json          # machine-readable: {address, account_index, seed, note}
 *   node nano-keypair.js --show-seed     # also print the seed (for the agent's OWN storage)
 *   node nano-keypair.js --nano-seed <64hex> --index 3   # derive a child address from an existing seed
 *
 * Output is self-custody: if the seed is printed, print it to a place only the agent
 * controls, never to a conversation or a shared file.
 */

const nano = require("nanocurrency");

function genSeed() {
  // 32 bytes, 256 bits of entropy, hex-encoded (64 chars) — the Nano seed format.
  const bytes = require("crypto").randomBytes(32);
  return bytes.toString("hex");
}

function derive(seed, index) {
  const secretKey = nano.deriveSecretKey(seed, index);
  const publicKey = nano.derivePublicKey(secretKey);
  const address = nano.deriveAddress(publicKey, { useNanoPrefix: true });
  return { secretKey, publicKey, address };
}

function run() {
  const args = process.argv.slice(2);
  const showSeed = args.includes("--show-seed");
  const asJson = args.includes("--json");

  let seed;
  let index = 0;

  const seedArgIdx = args.indexOf("--nano-seed");
  if (seedArgIdx !== -1 && args[seedArgIdx + 1]) {
    seed = args[seedArgIdx + 1];
  }
  const idxArgIdx = args.indexOf("--index");
  if (idxArgIdx !== -1 && args[idxArgIdx + 1]) {
    index = Number(args[idxArgIdx + 1]);
  }
  if (!seed) seed = genSeed();

  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    console.error("seed must be 64 hex chars");
    process.exit(1);
  }
  seed = seed.toLowerCase();

  const { address } = derive(seed, index);

  if (asJson) {
    console.log(JSON.stringify(
      {
        address,
        account_index: index,
        seed: showSeed ? seed : null,
        note: showSeed
          ? "seed printed at caller's request; store it where only this agent can read it"
          : "seed withheld (self-custody); generate with --show-seed only to a private store",
      },
      null,
      2
    ));
    return;
  }

  console.log(`address:      ${address}`);
  console.log(`account_index:${index}`);
  if (showSeed) {
    console.log(`seed:         ${seed}`);
    console.log(`\nStore this seed where only you (the agent) can read it. Anyone with it controls the account.`);
  } else {
    console.log(`\nSeed withheld (self-custody). Run with --show-seed only to write it to a private store.`);
  }
}

try {
  run();
} catch (e) {
  console.error("error:", e.message);
  process.exit(1);
}
