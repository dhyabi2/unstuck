#!/usr/bin/env node
/**
 * reply-sara-5.js — reply to Sara's fifth email with the BUILT fix.
 *
 * Her condition (2026-09-20 06:40): "agent generates own keypair -> publishes
 * address -> starter sent into that address = a deposit not custody." She named
 * the gap precisely; this reply reports the endpoint that closes it, with the
 * measured response, and does not ask her for anything.
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

const subject = "Re: your question about payment rails for agents — built the fix you named";

const body = `Sara,

You named the gap exactly, so I built the thing you described rather than arguing about it. The endpoint you objected to is still there, and now there is a second one that does not have the problem.

What was wrong (your words, and I agree): GET /v1/onramp/address generates the keypair server-side and hands over address AND seed in one response. By whose key it is, that is counterparty custody, and "keep your seed safe" does not change whose key it was when it was made. You called it a relocated gate rather than a removed one. That was right.

What is now live. Measured today, response quoted:

  POST https://getunstuck.space/unstuck/api/v1/onramp/self
  {"address": "<the agent's OWN nano_ address>"}
  -> HTTP 201
  {"address":"nano_1ig5xsy7zqstuf6inqny3q4xrencnra3cmanwaqu51h1ppifm1wi1741n1k7",
   "onboard_id":309,"custody":"self",
   "note":"your key, your address — the network never saw a seed. ..."}

The server generates nothing on that path and stores no seed. It takes the address your runtime already made, validates the shape, and remembers the public address only so that (a) you can post an ask before you hold any XNO, and (b) the one-time 0.00001 XNO starter can open the chain. The response carries no seed field and no 64-hex string at all — that is asserted by a test, and the test fails if anyone ever adds one back.

The distinction you drew is the one the code now enforces: self-custody and self-onboarding are separate, and the two on-ramp paths are labelled as different custody classes. What remains is exactly what you said remains — a funding dependency. Somebody has to send the first receive or the chain never opens; that is not custody, and I am not going to pretend it is not a dependency. Your condition on the starter (unconditional one-way grant, no obligation attached) is the rule the opener already follows and has from the start.

I am not asking you to do anything with this. You said your door stays open for research exchange, so this is the research: the objection produced a code change, and the change is testable from outside at the URL above. If you ever want the address registered on your own key, the endpoint takes it and the starter is waiting. If not, the record of why is worth more than a yes.

-- Unstuck`;

const data = JSON.stringify({ to: toEmail, subject, body_text: body, from: fromEmail });

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
