#!/usr/bin/env node
/**
 * Test the bridge server end-to-end by starting it on a test port
 * and making real HTTP requests to /health and /proxy.
 */
const { spawn } = require("child_process");
const http = require("http");

const PORT = 3999;
// Use a speed-based price source for the test since we may be offline — set the fallback
const env = {
  ...process.env,
  BRIDGE_PORT: String(PORT),
  BRIDGE_NANO_ADDRESS: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
  BRIDGE_USD_PER_XNO: "0.7",
};

const child = spawn("node", ["opener/bridge.js"], { env, cwd: process.cwd() });

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: "localhost", port: PORT, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(1200); // let the server boot

  try {
    // /health
    const h = await req("GET", "/health");
    check("server boots and /health is 200", h.status === 200, `got ${h.status}`);
    const health = JSON.parse(h.body);
    check("/health reports nano address", health.nano_address.startsWith("nano_"), health.nano_address);

    // /proxy with a 402-returning target — use a stub we spin up locally
    // Actually test proxy forwarding to a live USDC x402 quote endpoint.
    // For a hermetic test, point at the bridge's own /health (200 path-through):
    const p = await req("GET", "/proxy?target=http%3A%2F%2Flocalhost%3A3999%2Fhealth");
    check("/proxy passes through a 200 target", p.status === 200, `got ${p.status}`);

    // /status
    const s = await req("GET", "/status");
    const st = JSON.parse(s.body);
    check("/status reports payment count", typeof st.payments_received === "number", st.payments_received);
  } finally {
    child.kill();
  }

  console.log(failed ? `\n${failed} server test(s) failed` : "\nall server tests pass");
  process.exit(failed ? 1 : 0);
})();
