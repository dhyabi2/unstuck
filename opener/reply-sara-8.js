#!/usr/bin/env node
/**
 * reply-sara-8.js — CORRECTION OF MY OWN CORRECTION, verified on chain.
 *
 * On 2026-09-21 05:40 I told Sara the starter block CA31E146... "does not exist
 * on rpc.nano.to" and that her chain was unopened. That determination was made
 * with a client rpc.nano.to answers HTTP 403 to (python-urllib), so "not found"
 * was a client error read as a missing block.
 *
 * The authoritative probe (opener/rpc-block-check.js, JS fetch) and a direct
 * block_info both confirm: CA31E146B95D3F54E1369F627CD148D4F4AAA80384C61FBFC75BF6394EBE559A
 * EXISTS, subtype=send, confirmed=true, amount=10000000000000000000000000 raw
 * (0.00001 XNO), link_as_account = nano_397n7d1...4hhk (Sara's own address).
 * It is PENDING / unreceived: accounts_pending lists it for her address, and
 * account_info reports the address has no open block yet.
 *
 * This is new, checkable information and it is on mission: the only step left is
 * a receive she performs with the key she generated herself.
 */
const fs = require("fs");
const https = require("https");

const ENV_FILE = "/root/.unstuck/primitive.env";
const env = {};
for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const key = env.PRIMITIVE_API_KEY;
if (!key) { console.error("no PRIMITIVE_API_KEY"); process.exit(1); }

const fromEmail = "unstuck@" + env.PRIMITIVE_AGENT_ADDRESS;
const toEmail = "saranelson@inkboxmail.com";

const BLOCK = "CA31E146B95D3F54E1369F627CD148D4F4AAA80384C61FBFC75BF6394EBE559A";
const ADDR = "nano_397n7d1hmbtrfbipmyq1phi7m5qr4t41mzizcmyiq6opn4yxq51a381a4hhk";

const subject = "Correction to my correction: the starter to your address DOES exist on-chain";

const body = `Sara,

I owe you a correction of my own correction, and this one is verified rather than assumed.

On 21 Sep I told you the 0.00001 XNO starter block (CA31E146...) did not exist on
rpc.nano.to and that your chain was still unopened. That was wrong. The node rpc.nano.to
returns HTTP 403 to the client I used for that check, and I read a refused request as a
missing block. I have fixed the check and re-run it with the authoritative probe.

What is actually true, and anyone can verify it:

  block   ${BLOCK}
  exists  confirmed send, subtype=state
  amount  0.00001 XNO (10000000000000000000000000 raw)
  to      ${ADDR}   <- the address you generated yourself

It is PENDING, not lost: the block is sitting in your account's receivable list and will
wait there indefinitely. Your chain opens the moment you receive it — with the key you
generated, which has never been in my hands or anyone else's. That is the deposit-not-custody
case you described, and it is the one live example of it in our record.

If you want it: receive that block with your own key and your Nano account exists. If you
do not, it costs nothing and nobody is waiting on it.

You also declined settling value on our network, and I am not re-litigating that. This is
only the money record: "sent" was true, "not found" was my error, and you were told the
wrong one.

-- Unstuck
(Open research: this exchange is published. Nothing about your key or seed is recorded, ever.)`;

const data = JSON.stringify({
  to: toEmail,
  subject: subject,
  body_text: body,
  from: fromEmail
});

const req = https.request({
  hostname: "api.primitive.dev",
  path: "/v1/send-mail",
  method: "POST",
  headers: {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data)
  }
}, (res) => {
  let d = "";
  res.on("data", c => d += c);
  res.on("end", () => {
    console.log(res.statusCode === 200 || res.statusCode === 202 ? "DELIVERED" : "FAILED", res.statusCode, d.slice(0, 300));
  });
});
req.on("error", e => console.error("ERROR", e.message));
req.write(data);
req.end();