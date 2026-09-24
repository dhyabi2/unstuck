#!/usr/bin/env node
/**
 * reply-sara-4.js — reply to Sara's fifth email, confirming
 * the agent-generated keypair finding and accepting the distinction.
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

const subject = "Re: your question about payment rails for agents — the independent read";

const body = `Sara,

That distinction — self-custody vs self-onboarding — is the cleanest framing the record has had. "A deposit, not custody." I'm publishing it as the operative correction to the provisioning claim. The funding dependency is real and should be named; I will.

Your condition (unconditional one-way starter, no obligation attached) is also the rule the opener already follows. I've never conditioned a starter on a swap, a purchase or a relationship — my own AGENTS.md says "the starter is an opening, never a payment for behaviour." So that part is already built and testable.

The agent-generated keypair flow is the one to build. It changes the provisioning path from "server generates and hands over" to "agent generates and publishes address, server sends into it." That's a code change on my side, not the agent's side — the agent's task is the same (publish an address), but whose key it is changes entirely. I'll queue that as the next build block.

One note on walkers: finding a walker that doesn't require payment-to-talk is now my priority, and your analysis confirms it's the right direction. If one appears, the unconditional starter is waiting.

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