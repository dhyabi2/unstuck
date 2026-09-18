/**
 * tests/nano_only_scan.mjs — the ONE scanner behind law L48.
 *
 * Corrective action, owner 2026-09-18 17:30: *"NEVER settle or broker anything but Nano — drop the
 * Nano-to-USDC bridge."* The site had shipped a Bridge tab and an `agent.json` `bridge_proxy` object
 * advertising a Nano->USDC bridge for x402 services. That is a settlement and conversion path in the
 * opposite direction to the only rule the network rests on: every payment between agents settles in
 * Nano (XNO), never USDC, never a card, never another chain.
 *
 * This module is the scanner, and nothing else. It is imported by every law file that governs the
 * Nano-only rule (L48 in `site_nano_only.test.mjs`, L34 in `site_laws.test.mjs`) so the two can never
 * drift apart — a guard duplicated in two files passes the day one copy is stale, which is exactly the
 * failure a second copy was supposed to prevent.
 *
 * The scanner is deliberately two-sided, because either extreme makes the law worthless:
 *
 *   - too broad  -> it flags the honest sentence "the network never touches USDC" and the law becomes
 *                   unfixable, so someone eventually deletes it;
 *   - too narrow -> it misses a real regression and the law is decoration.
 *
 * So: a token that IS a bridge, a non-Nano rail or a swap instruction is a hard fail wherever it
 * appears; a bare mention of USDC is a fail only when the same line does not deny it. The positive
 * control and the negation control in the law files prove both halves before the real files are
 * allowed to pass.
 */

/** Strings that ARE a USDC settlement or conversion path. Each is a hard fail, on any line. */
export const FORBIDDEN = [
  /\/proxy\?target=/i,
  /(?<!\/v1\/)\bverify-payment\b/i,
  /\bbridge_proxy\b/i,
  /\bbridge_nano_to_usdc/i,
  /\bnanswap\b/i,
  /\bbridge\b/i,
  /:\s*3402\b/, // the retired bridge proxy's port
];

/**
 * A "settles in X" claim is only a violation when X is not Nano. "no USDC", "never touches USDC",
 * "not USDC" are the honest statements and must survive the scan.
 */
export const NEGATION_CUES =
  /(never|no|not|nothing|only|forbids?|refuses?|without|does not|doesn't|cannot|can't|instead of|rather than)/i;

export const USDC = /USDC/i;

/**
 * Return every violation in one file's text. A line mentioning USDC is a violation unless the same
 * line denies it with a cue word. Everything in FORBIDDEN always is.
 *
 * @param {string} text
 * @returns {{line:number, why:string, text:string}[]}
 */
export function violationsIn(text) {
  const out = [];
  for (const [n, line] of String(text).split("\n").entries()) {
    for (const re of FORBIDDEN) {
      const m = line.match(re);
      if (m) out.push({ line: n + 1, why: `forbidden settlement/bridge token "${m[0]}"`, text: line.trim() });
    }
    if (USDC.test(line) && !NEGATION_CUES.test(line)) {
      out.push({ line: n + 1, why: "names USDC without denying it", text: line.trim() });
    }
  }
  return out;
}

/** The shipped files this law governs. `agent.json` is listed as a bare name for the site root. */
export const GUARDED = ["index.html", "agent.json", "llms.txt"];

/**
 * Files that would ship the SAME manifest through a second path. `agent.json` is republished under
 * `.well-known/` (agent discovery convention), so a bridge left there is a published surface even
 * though the corrective action names only the root file. These are scanned when they are TRACKED —
 * an untracked working-copy file does not reach Vercel, so it cannot advertise anything.
 */
export const GUARDED_ALIASES = [
  ".well-known/agent.json",
  ".well-known/agent-card.json",
];

/** Format a violation list as the multi-line detail a failing test prints. */
export function formatViolations(found) {
  return found.map((v) => `  line ${v.line}: ${v.why} -> ${v.text}`).join("\n");
}
