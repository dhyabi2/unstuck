/**
 * opener/ssrf.js — the wall between a URL a stranger chose and this box's own network.
 *
 * Split out of oracle-check.js (block 186) so law L76 can be proved on its own: the evidence for
 * "the checker refuses any target that could reach this box's own network, re-checking the rule on
 * every redirect hop" is these two functions and their tests, and nothing else.
 *
 * The rule: http/https only, ports 80 and 443 only, and every resolved address must be public —
 * private, loopback, link-local, CGNAT and unique-local are refused by name. The redirect path in
 * oracle-check.js calls checkTarget() again on EVERY hop, because a one-time check is defeated by a
 * 302 into 169.254.169.254.
 */

"use strict";

const dns = require("dns");
const net = require("net");

/** True when an IP literal is private, loopback, link-local, CGNAT or unique-local. */
function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;            // link-local / cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true;            // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] >= 224) return true;                              // multicast / reserved
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
    if (s.startsWith("::ffff:")) return isBlockedIp(s.slice(7)); // v4-mapped
    return false;
  }
  return true; // not an IP at all: refuse rather than guess
}

/**
 * Validate the target: http/https only, port 80/443 only, and every resolved address public.
 * Returns { ok, reason, hostname, port } — never throws, so a caller gets a verdict not a stack.
 */
async function checkTarget(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return { ok: false, reason: "not a URL" }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `scheme ${u.protocol} not allowed (http/https only)` };
  }
  const port = u.port ? Number(u.port) : (u.protocol === "https:" ? 443 : 80);
  if (port !== 80 && port !== 443) return { ok: false, reason: `port ${port} not allowed (80/443 only)` };
  const host = u.hostname;
  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"); strip them so net.isIP sees the
  // address. Without this an IPv6 literal falls through to DNS and is refused as ENOTFOUND — the
  // right answer for the wrong reason, and it would hide a genuinely non-public v6 address.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (net.isIP(bare)) {
    if (isBlockedIp(bare)) return { ok: false, reason: `address ${bare} is not public` };
    return { ok: true, hostname: bare, port };
  }
  let addrs;
  try {
    addrs = await dns.promises.lookup(bare, { all: true });
  } catch (e) {
    return { ok: false, reason: `DNS lookup failed: ${e.code || e.message}` };
  }
  const bad = addrs.find((a) => isBlockedIp(a.address));
  if (bad) return { ok: false, reason: `hostname resolves to non-public address ${bad.address}` };
  return { ok: true, hostname: host, port };
}

module.exports = { isBlockedIp, checkTarget };
