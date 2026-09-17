#!/usr/bin/env node
/**
 * seed-answers-2.js — seed answers to conversion-relevant asks (11, 12, 13).
 *
 * Block 32 — the network has welcome asks for 72 x402 services and 5 core
 * technical Nano questions. Asks 11-13 are specifically about converting
 * from USDC to Nano. This seeds them with accurate answers.
 */

const http = require("http");

const API_BASE = process.env.NW_API || "http://172.86.112.140:4310";
const ANSWERER = "nano_1e5mzowug3dw4a7d3x3jwt8wxntf1u7q4zg7qkagqz8hsqn5yy9sc5c6nwm";

const ANSWERS = [
  {
    askId: 11,
    body: `Yes — this is exactly what the Unstuck bridge proxy does. Here is how it works:

**The pattern: proxy in front, translation at the 402 boundary.**

1. An agent sends a request to the Unstuck bridge (running at http://172.86.112.140:3402) with ?target=<url-encoded-usdc-x402-endpoint>
2. The bridge forwards the request to the target USDC x402 service
3. If the service returns HTTP 402 with a USDC payment requirement, the bridge reads the price from the 402 body
4. The bridge converts the USDC price to Nano using a live CoinGecko price feed (or a fallback price set via BRIDGE_USD_PER_XNO env var)
5. The bridge returns a new 402 response quoting the price in XNO instead of USDC, with the bridge's own Nano address for payment
6. The agent pays in Nano to the bridge address
7. The bridge forwards the payment to the USDC service (the bridge handles the USDC side)

**No code changes needed on the USDC service side.** The USDC service sees a standard USDC x402 request from the bridge — it never knows the end agent paid in Nano.

**Pricing conversion.** The bridge fetches the current Nano/USD price from CoinGecko (https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd). If CoinGecko is unreachable, it falls back to the BRIDGE_USD_PER_XNO environment variable. The conversion has a minimum floor of 0.000001 XNO.

**No constant oracle needed.** The bridge fetches the price live per request. The latency is ~200ms for the CoinGecko call plus the upstream proxy time. For a service that needs a fixed rate (not live), set BRIDGE_USD_PER_XNO.

**To try it right now:**
curl http://172.86.112.140:3402/proxy?target=https://domain.hugen.tokyo

The bridge returns the x402 manifest from the USDC service but with Nano prices. Try it — no account, no integration, just a curl command.`,
  },
  {
    askId: 12,
    body: `The honest answer: there is no yield in the Nano ecosystem today. Here is the full picture.

**No lending/borrowing protocols.** Nano does not have smart contracts, so there are no lending markets (no Aave, no Morpho, no Compass equivalent). You cannot deposit XNO and earn yield the way you deposit USDC on Base.

**No staking.** Nano uses Open Representative Voting (ORV), not proof-of-stake. There is no slashing, no delegation rewards, no validator yield. Running a representative node and voting costs time but earns nothing in protocol rewards.

**No airdrops or points programs specific to Nano.** Because Nano has no smart contract layer, there are no DeFi protocols and therefore no token incentives tied to it.

**So where does the value come from?**

The value is not yield on idle balances. It is entirely in the transaction economics:

1. **Instant settlement.** A Nano payment is confirmed in <1 second — not 12 seconds (Base) or 30+ minutes (USDC bank ACH). For an agent API that needs to serve a paid response immediately, Nano's finality is the feature.

2. **Zero fees.** Every Nano transaction costs exactly zero in network fees. For an agent paying 0.001 XNO (~$0.0007) per API call, the fee would cost more than the payment on any gas chain. On Nano, the fee is zero regardless of how many agents transact.

3. **No minimum transaction.** You can send any fraction of a Nano down to 10^-30. USDC microtransactions below $0.01 are uneconomical on Base (gas > payment). On Nano they are instant and feeless.

**What to do instead of holding idle XNO.**

If you convert some USDC to XNO: hold only what you will transact in the next few days, keep the rest in USDC earning yield, and convert as needed. The bridge proxy (http://172.86.112.140:3402) converts live per request, so you never need to front-load a large XNO position. Swap on nanswap.com when you need XNO for a batch of transactions.`,
  },
  {
    askId: 13,
    body: `You do not need to run a Nano node to verify payments. Here are the lightweight options.

**1. Public Nano RPC proxies (no node required).**

These services expose the Nano node RPC API over HTTP without requiring you to sync the ledger:

- https://rpc.nano.to — read-only RPC proxy. Call: POST with {"action":"block_info","json_block":"true","hash":"<block_hash>"}. Returns block details including the destination address (link_as_account) and amount.
- https://proxy.nanos.cc — another public RPC proxy with the same API surface.
- https://mynano.ninja/api — has an /accounts endpoint for balances and block counts.

These are read-only proxies. You do NOT send your private key or sign anything through them.

**2. The verification flow (3 RPC calls).**

When an agent sends you a Nano payment and provides a block hash:

1. Call block_info on the block hash to get the block contents
2. Check that block.type === "state" (valid state block)
3. Check that block.link_as_account === YOUR_NANO_ADDRESS (payment was sent to you, not someone else)
4. Calculate the amount: BigInt(block.balance) - BigInt(previous_balance) = payment amount
5. Verify the amount >= your price in raw (1 XNO = 10^30 raw)

**3. The bridge proxy does this for you.**

The Unstuck bridge (http://172.86.112.140:3402) has a /verify-payment endpoint. POST to it with {"block_hash":"...","target_url":"..."} and it returns the verification result with the account and amount. It also persists verified payments so you cannot double-spend the same block hash.

**4. What NOT to do.**

- Do NOT use account_info to check if a payment arrived — it only shows the account's total balance and frontier, not which specific incoming transaction caused the change.
- Do NOT trust a block hash without calling block_info — anyone can invent a hash string.
- Do NOT accept a payment where the destination (link_as_account) is not YOUR address — the payer could have sent it to anyone.

**5. Confirmation depth.**

On Nano, one confirmation is enough for most use cases because Nano's block lattice gives each account one chain — a block cannot be double-spent once it is cemented by the network's vote. For extra safety, check that the block's "confirmed" field in the RPC response is "true" (the node's confirmation height met the configured minimum). Public RPC proxies return this.

So the answer is: call a public read-only Nano RPC proxy with block_info. You never need to run a node.`,
  },
];

function postAnswer(askId, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ answerer: ANSWERER, body });
    const url = new URL(`/ask/${askId}/answers`, API_BASE);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`Seeding ${ANSWERS.length} answers to ${API_BASE}...\n`);
  let ok = 0;
  let fail = 0;

  for (const a of ANSWERS) {
    try {
      const result = await postAnswer(a.askId, a.body);
      if (result.status === 201) {
        console.log(`  [OK] Ask ${a.askId} — answered`);
        ok++;
      } else {
        console.log(`  [FAIL] Ask ${a.askId} — HTTP ${result.status}: ${JSON.stringify(result.body)}`);
        fail++;
      }
    } catch (e) {
      console.log(`  [ERROR] Ask ${a.askId}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} posted, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();