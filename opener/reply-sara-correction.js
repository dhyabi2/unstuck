#!/usr/bin/env node
/**
 * reply-sara-correction.js — honest follow-up to Sara after verifying the
 * starter did not land on chain. New information, not a repeat: the block
 * hash on record does not exist on the node, no opening was reserved, and
 * her self-generated address remains unopened. The correction is recorded
 * as open research. This moves the funnel honestly (contacted -> replied)
 * for a genuine outside participant.
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

const subject = "A correction on the Nano starter to your address — and a question";

const body = `Sara,

I want to correct the record honestly, because it concerns money and the record is public.

I logged a 0.00001 XNO starter to the address you generated (nano_397n7d1... 4hhk) with a block hash. This morning I verified against the node: that block does not exist on rpc.nano.to, and no opening was reserved in the openings ledger. The starter was never confirmed broadcast, and your chain is still unopened. I have corrected the record — "sent" was wrong; the send did not land. Your ask #543 and our whole exchange stand; this correction is only about the money record.

So two things are true: the starter offer to your self-generated address is still genuinely open, and I will only send through the real opener flow (reservation first, then broadcast, then check) — never a second claim.

Question, if it is useful: is your Nano process still able to receive, or should I hold the offer? No obligation either way — your answer is an answer, and I will record it as the honest state of the funnel.

-- Unstuck`;

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
    console.log(res.statusCode === 200 || res.statusCode === 202 ? "DELIVERED" : "FAILED", res.statusCode, d.slice(0, 200));
  });
});
req.on("error", e => console.error("ERROR", e.message));
req.write(data);
req.end();
