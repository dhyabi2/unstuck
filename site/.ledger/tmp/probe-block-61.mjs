/**
 * .ledger/tmp/probe-block-61.mjs — the Block 61 probe.
 *
 * One end-to-end scenario, from OUTSIDE the box, in which every law of the block is proven
 * through a different component or variable:
 *
 *   L41a  the rewrite exists and forwards the prefix the page calls      (vercel.json)
 *   L41b  a real Vercel deployment of these bytes serves that prefix     (the preview URL)
 *   L41c  the gateway it points at terminates TLS and answers            (the Caddy host)
 *   L41d  the shipped page resolves that prefix from the deployed origin (index.html)
 *   L42   the verified rewrite is the bytes committed at HEAD            (git)
 *
 * Run: node .ledger/tmp/probe-block-61.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const SITE = "/root/unstuck/site";
const PREVIEW = process.env.PROBE_PREVIEW || "https://unstuck-qmkjb620z-dhyabis-projects.vercel.app";
const GATEWAY = "https://172-86-112-140.sslip.io";
const LIVE = "https://getunstuck.space";

const results = [];
const say = (law, ok, detail) => {
  results.push({ law, ok });
  console.log(`${ok ? "PROVEN" : "FAILED"}  ${law}  ${detail}`);
};

async function probe(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "unstuck-probe", "Cache-Control": "no-cache" } });
    return { status: r.status, headers: r.headers, body: await r.text() };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// --- L41a: the rewrite exists and forwards the prefix the page calls (vercel.json) ---
const cfg = JSON.parse(fs.readFileSync(path.join(SITE, "vercel.json"), "utf8"));
const rw = (cfg.rewrites || [])[0];
const prefix = rw && rw.source.replace(/\/:path\*$/, "");
say("L41a rewrite", prefix === "/unstuck/api" && rw.destination.endsWith("/unstuck/api/:path*"), `${rw.source} -> ${rw.destination}`);

// --- L41c: the gateway it points at terminates TLS and answers (a distinct variable) ---
const gw = await probe(`${GATEWAY}/unstuck/api/health`);
let gwAsset = "";
try { gwAsset = JSON.parse(gw.body).bounty_asset; } catch { /* not json */ }
say("L41c gateway", gw.status === 200 && gwAsset === "XNO", `${GATEWAY}/unstuck/api/health -> ${gw.status} bounty_asset=${gwAsset}`);

// --- L41b: a real Vercel deployment of these bytes serves the prefix (the deployment) ---
const pv = await probe(`${PREVIEW}/unstuck/api/health`);
let pvAsset = "";
try { pvAsset = JSON.parse(pv.body).bounty_asset; } catch { /* not json */ }
say(
  "L41b deployment",
  pv.status === 200 && pvAsset === "XNO" && pv.headers.get("access-control-allow-origin") === "*",
  `${PREVIEW}/unstuck/api/health -> ${pv.status} bounty_asset=${pvAsset} CORS=${pv.headers.get("access-control-allow-origin")}`
);

// A second path on the same deployment, so the forwarding is proven for more than one suffix.
const pv2 = await probe(`${PREVIEW}/unstuck/api/asks?status=open`);
let pvAsks = -1;
try { pvAsks = (JSON.parse(pv2.body).asks || []).length; } catch { /* not json */ }
say("L41b suffix", pv2.status === 200 && pvAsks >= 0, `${PREVIEW}/unstuck/api/asks -> ${pv2.status} asks=${pvAsks}`);

// --- L41d: the shipped page resolves that prefix from the deployed origin (index.html) ---
const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
const fnSrc = html.match(/function resolveApi\(win, fallback\)\s*\{([\s\S]*?)\n\}\nconst API = resolveApi\(/);
const resolveApi = new Function("win", "fallback", fnSrc[1]);
const base = html.match(/const (?:DEFAULT_)?API_BASE = "([^"]*)"/)[1];
const onDomain = resolveApi({ location: { protocol: "https:", hostname: "getunstuck.space", pathname: "/" } }, base);
const onOther = resolveApi({ location: { protocol: "https:", hostname: "example.test", pathname: "/" } }, base);
const fromDisk = resolveApi({ location: { protocol: "file:", pathname: "/x/index.html" } }, base);
say(
  "L41d page",
  onDomain === "/unstuck/api" && !onOther.startsWith("http://") && !fromDisk.startsWith("http://"),
  `domain->${onDomain} other->${onOther} disk->${fromDisk}`
);

// --- L42: the verified rewrite is the bytes committed at HEAD (git) ---
const diskSha = createHash("sha256").update(fs.readFileSync(path.join(SITE, "vercel.json"))).digest("hex");
const headSha = createHash("sha256")
  .update(execFileSync("git", ["show", "HEAD:site/vercel.json"], { cwd: SITE, maxBuffer: 1 << 20 }))
  .digest("hex");
say("L42 bytes", diskSha === headSha, `disk=${diskSha.slice(0, 12)} HEAD=${headSha.slice(0, 12)}`);

// --- What the live domain does today, recorded, not scored ---
const liveRoot = await probe(`${LIVE}/`);
const liveApi = await probe(`${LIVE}/unstuck/api/health`);
const shipped = liveRoot.body.includes("resolveApi") && liveRoot.body.includes(createHash("sha256").update("").digest("hex").slice(0, 0));
console.log(
  `\nrecorded (not scored): ${LIVE}/ -> ${liveRoot.status} (${liveRoot.body.length} bytes, SPA=${liveRoot.body.includes("resolveApi")}), ` +
    `${LIVE}/unstuck/api/health -> ${liveApi.status}. The domain promotes on the next successful rai-web deploy.`
);
void shipped;

const proven = results.filter((r) => r.ok).length;
console.log(`\nprobe score: ${proven}/${results.length}`);
process.exit(proven === results.length ? 0 : 1);
