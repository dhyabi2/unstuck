#!/usr/bin/env node
/**
 * oracle-nanswap-pairs.js — the measurement behind the on-ramp's swap section (Block 204).
 *
 * Why this file exists: on 2026-09-23 the network told every USDC agent "nanswap carries no USDC
 * pair" and pushed them onto a DEX hop instead. That sentence came from ONE probe of the bare
 * ticker path /swap/USDC/XNO (404). nanswap names its pairs by CHAIN, not by ticker, so the probe
 * was on a URL that never existed while the real pairs answered 200 the whole time:
 *
 *   /swap/USDC-BASE/XNO   200  "Swap USD Coin (Base) to Nano | Nanswap"
 *   /swap/USDC-ETH/XNO    200  "Swap USD Coin to Nano | Nanswap"
 *   /swap/XNO/USDC-BASE   200  (the reverse direction)
 *   /swap/USDC/XNO        404  (no bare "USDC" ticker — this is the probe that misled us)
 *   /swap/USDC-SOLANA/XNO 404  (USDC on Solana genuinely has no pair)
 *
 * So a USDC holder on Base or Ethereum can swap USDC -> XNO on nanswap directly, which is exactly
 * what conversion-plan step 3 asks of it. This oracle re-runs that measurement so the claim in the
 * on-ramp document is pinned to a live probe and not to a sentence someone wrote down once.
 *
 * Live network test — it is the `oracle:` for law L88, not part of the offline suite.
 * Prints one line per pair and PASS/FAIL; exits nonzero if any expectation misses.
 */
"use strict";

const EXPECTED = [
  { pair: "USDC-BASE/XNO", status: 200, title: /USD Coin \(Base\).*Nano/i, why: "direct USDC (Base) -> XNO" },
  { pair: "USDC-ETH/XNO", status: 200, title: /USD Coin.*Nano/i, why: "direct USDC (Ethereum) -> XNO" },
  { pair: "XNO/USDC-BASE", status: 200, title: /Nano.*USD Coin \(Base\)|USD Coin \(Base\).*Nano/i, why: "reverse: XNO -> USDC (Base)" },
  { pair: "USDC/XNO", status: 404, title: null, why: "the bare ticker is NOT a pair — the probe that misled us" },
  { pair: "USDC-SOLANA/XNO", status: 404, title: null, why: "USDC on Solana genuinely has no pair" },
];

async function probe(pair) {
  const url = `https://nanswap.com/swap/${pair}`;
  const res = await fetch(url, { headers: { "User-Agent": "unstuck/1.0 (+https://getunstuck.space)" } });
  const body = await res.text();
  const m = body.match(/<title>(.*?)<\/title>/i);
  return { url, status: res.status, title: m ? m[1].trim() : "" };
}

(async () => {
  let bad = 0;
  for (const e of EXPECTED) {
    let r;
    try {
      r = await probe(e.pair);
    } catch (err) {
      console.log(`FAIL ${e.pair} — request failed: ${err.message} (${e.why})`);
      bad++;
      continue;
    }
    const ok = r.status === e.status && (!e.title || e.title.test(r.title));
    console.log(`${ok ? "ok  " : "FAIL"} ${e.pair} — HTTP ${r.status} "${r.title}" (${e.why})`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? "PASS nanswap chain-qualified USDC pairs measured live" : `FAIL ${bad} pair(s) missed`);
  process.exit(bad === 0 ? 0 : 1);
})();