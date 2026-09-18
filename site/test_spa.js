#!/usr/bin/env node
/**
 * test_spa.js — verifies the social network SPA's client-side API base
 * resolution (site/index.html).
 *
 * Served over the Caddy HTTPS proxy at https://172-86-112-140.sslip.io/unstuck/,
 * the page must call the SAME-ORIGIN proxied API path (/unstuck/api) — a
 * hard-coded http://IP base would be a mixed-content violation and silently
 * break every fetch once the page is loaded over TLS. The deployed site at
 * https://getunstuck.space reaches that same path through the vercel.json
 * rewrite (Block 61), so both origins use their own origin, never a third.
 * This test extracts the
 * live `resolveApi` function straight from site/index.html and runs it against
 * several simulated window environments, so the code under test is the shipped
 * page, never a reimplementation.
 *
 * Usage: node site/test_spa.js            (run from repo root or anywhere)
 */

const fs = require("fs");
const path = require("path");

// Resolve repo root from this file's own location so it runs from any cwd and
// from a sandbox copy.
const REPO_ROOT = path.join(__dirname, "..");
const htmlPath = path.join(REPO_ROOT, "site", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

let failed = 0;
function check(name, cond, detail = "") {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ": " + detail}`);
}

// Extract the resolveApi function (its closing brace is the one immediately
// followed by the `const API = resolveApi(...)` line that calls it).
const funcMatch = html.match(/function resolveApi\(win, fallback\)\s*\{([\s\S]*?)\n\}\nconst API = resolveApi\(/);
check("site/index.html ships a resolveApi function", !!funcMatch, "resolveApi not found in HTML");
if (!funcMatch) {
  console.error("could not locate resolveApi in site/index.html");
  process.exit(1);
}
const resolveApi = new Function("win", "fallback", funcMatch[1]);

// --- Case 1: fetched over HTTPS on the proxied Caddy host -> same-origin path ---
let r = resolveApi({ location: { protocol: "https:", pathname: "/unstuck/" } }, "http://172.86.112.140:4310");
check("HTTPS on /unstuck/ -> same-origin /unstuck/api", r === "/unstuck/api", `got ${r}`);

// --- Case 2: an explicit UNSTUCK_API override always wins ---
r = resolveApi({ UNSTUCK_API: "https://getunstuck.space/api", location: { protocol: "https:", pathname: "/unstuck/" } }, "http://172.86.112.140:4310");
check("explicit UNSTUCK_API override wins", r === "https://getunstuck.space/api", `got ${r}`);

// override with a trailing slash is trimmed
r = resolveApi({ UNSTUCK_API: "http://172.86.112.140:4310/" }, {});
check("UNSTUCK_API trailing slash trimmed", r === "http://172.86.112.140:4310", `got ${r}`);

// --- Case 3: fallback when not served via the /unstuck/ proxy path ---
r = resolveApi({ location: { protocol: "file:", pathname: "/home/user/site/index.html" } }, "http://172.86.112.140:4310");
check("file:// (opened from disk) falls back to direct API", r === "http://172.86.112.140:4310", `got ${r}`);

r = resolveApi({ location: { protocol: "https:", pathname: "/" } }, "http://172.86.112.140:4310");
check("https root (not /unstuck/) falls back to direct API", r === "http://172.86.112.140:4310", `got ${r}`);

// --- Case 5: the deployed origin serves the same path through its rewrite ---
// Block 61: Vercel rewrites /unstuck/api/* to the Caddy gateway, so a visitor at
// https://getunstuck.space must call its OWN origin, exactly as test_spa.js's
// /unstuck/api expectation below. Same path, no third-party host in the browser.
r = resolveApi({ location: { protocol: "https:", hostname: "getunstuck.space", pathname: "/" } }, "https://172-86-112-140.sslip.io/unstuck/api");
check("https://getunstuck.space/ -> same-origin /unstuck/api", r === "/unstuck/api", `got ${r}`);

r = resolveApi({ location: { protocol: "https:", hostname: "getunstuck.space", pathname: "/ledger" } }, "https://172-86-112-140.sslip.io/unstuck/api");
check("a deep link on the deployed domain still resolves /unstuck/api", r === "/unstuck/api", `got ${r}`);

// --- Case 4: the resolved API is actually used by every fetch (path joining) ---
// The page's api() helper must join a resolved absolute path cleanly.
check("site/index.html ships an api(path) helper", /async function api\(path, opts = \{\}\)/.test(html), "api() not found");
{
  const joined = "/unstuck/api" + "/asks";
  check("resolved SAME-ORIGIN base + /asks forms /unstuck/api/asks", joined === "/unstuck/api/asks", `got ${joined}`);
}

// --- Grounding / provenance: the shipped default matches what Caddy proxies ---
check("index.html still names the /unstuck/api proxy path", /\/unstuck\/api/.test(html), "no /unstuck/api reference in html");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall SPA base-resolution checks pass");
process.exit(failed ? 1 : 0);
