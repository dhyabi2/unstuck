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
 * ---------------------------------------------------------------------------------------------
 * 2026-10-04: BOTH extremes were live at once, and the narrow one had been load-bearing since the
 * law was written. Measured, not inferred:
 *
 *   1. `NEGATION_CUES` was unanchored and case-insensitive, so the letters "NO" inside **"XNO"**
 *      satisfied the cue. On pages whose whole subject is XNO that excused every line, and the USDC
 *      half of L48/L34 therefore never fired. All five of these scanned CLEAN before the fix:
 *          "Top up with USDC and we settle your XNO balance for you."
 *          "Pay us in USDC; we convert to XNO at our desk."
 *          "We accept USDC deposits and credit XNO."
 *          "Send USDC here to buy XNO from the network."
 *          "Already hold USDC? Convert it to XNO with Nanswap"
 *      Only "The network accepts USDC." — a sentence with no XNO in it — was ever caught. The cues
 *      now match whole WORDS, and a cue must stand in the SAME SENTENCE as the USDC mention it
 *      excuses: a leading "No fees." must not license a brokering clause after it. (Same shape as
 *      L65's line-initial anchor and L85's unanchored article: a rule stated correctly in prose and
 *      matched one boundary short of it. This is the third in that family.)
 *
 *   2. A bare `/\bnanswap\b/` was a hard fail, so the law flagged `index.html`'s on-ramp line
 *      "Already hold USDC? Convert it to XNO with Nanswap ->" and L48 had been red since the line
 *      shipped on 2026-09-26 (36b908e, "USDC->XNO swap pointer"). That line is the case the
 *      corrective action KEEPS, and four independent sources say so: this file's own header bullet
 *      ("keep the USDC -> XNO swap at nanswap, which belongs to the agent converting its own money,
 *      never to the network brokering a rail"); the same card two lines above it ("Nothing here ever
 *      settles or converts any asset but Nano: the network itself never touches USDC"); TIER0.md's
 *      standing rule that "USDC appears only as a bridge INTO XNO (a swap, a side-by-side rail where
 *      XNO is the addition)"; and the linked document itself, which brokers nothing and says so
 *      ("Nobody should fund this for you, and we will not"). The documented law was right and the
 *      regex was stricter than it, so the regex is what changed — naming a venue is now judged by
 *      WHO the sentence makes the actor, never by the token appearing.
 *
 * Machinery is still unconditional. `bridge_proxy`, `/proxy?target=`, `bridge_nano_to_usdc`, the
 * retired port and a bare `bridge` are things the network would have to RUN or SHIP, not wording, so
 * no sentence can excuse them and none of them is judged by actor.
 * ---------------------------------------------------------------------------------------------
 */

// Strings that ARE a USDC settlement or conversion path, or the machinery of one. Each is a hard
// fail, on any line, in any sentence: these are not prose, so no actor and no cue can excuse them.
export const FORBIDDEN = [
  /\/proxy\?target=/i,
  /(?<!\/v1\/)\bverify-payment\b/i,
  /\bbridge_proxy\b/i,
  /\bbridge_nano_to_usdc/i,
  /\bbridge\b/i,
  /:\s*3402\b/, // the retired bridge proxy's port
];

/**
 * A third-party swap VENUE. The corrective action keeps the USDC -> XNO leg at nanswap for the agent
 * converting its own money and forbids the network brokering a rail, so a venue mention is a
 * violation only when the sentence makes the NETWORK the one doing the converting. Pointing a reader
 * at a venue is permitted; offering to do it for them is not.
 */
export const SWAP_VENUES = [/\bnanswap\b/i];

/** The network as the actor. Whole words only: `getunstuck.space` must not read as "unstuck". */
export const NETWORK_ACTOR = /\b(we|us|our|ours|unstuck|the network|this network)\b/i;

/** Doing the conversion, as opposed to naming where someone else can. */
export const BROKER_VERB =
  /\b(convert|converts|converted|converting|swap|swaps|swapped|swapping|exchange|exchanges|exchanged|exchanging|bridge|bridges|bridged|bridging|settle|settles|settled|settling|accept|accepts|accepted|accepting|credit|credits|credited|crediting|broker|brokers|brokered|brokering|custody|hold|holds|holding|take|takes|taking|fund|funds|funding)\b/i;

/**
 * Verbs that move money TOWARDS someone. "Pay us in USDC" and "Send USDC to the network" put the
 * network on the receiving end without ever making it the grammatical subject, so the actor-then-verb
 * order below cannot see them; this reads the other direction.
 */
export const RECEIVE_VERB =
  /\b(pay|pays|paid|paying|send|sends|sent|sending|deposit|deposits|deposited|depositing|transfer|transfers|transferred|transferring|top\s*up|wire|wires|wired)\b/i;

/**
 * The mentions of USDC the owner's rule PERMITS, so the backstop below does not flag them. Two
 * shapes, both from TIER0.md's standing wording — "USDC appears only as a bridge INTO XNO (a swap, a
 * side-by-side rail where XNO is the addition)":
 *
 *   - directional INTO XNO: "USDC -> XNO", "Convert it to XNO", "USDC on Base -> XNO";
 *   - additive: an XNO leg added BESIDE a USDC rail, never instead of it.
 *
 * Neither licenses the network handling USDC itself — that is judged first and separately, and no
 * allowance here can excuse it.
 */
export const INTO_XNO = [
  /USDC[^.!?;]{0,60}(->|→|&rarr;|&#8594;|\bto\b|\binto\b)[^.!?;]{0,30}XNO/i,
  /\bconvert(s|ed|ing)?\b[^.!?;]{0,60}\bto\s+XNO\b/i,
  /\bXNO\b[^.!?;]{0,60}\b(beside|alongside|addition|added)\b/i,
  /\b(beside|alongside)\b[^.!?;]{0,60}\bUSDC\b/i,
];

/**
 * A "settles in X" claim is only a violation when X is not Nano. "no USDC", "never touches USDC",
 * "not USDC" are the honest statements and must survive the scan.
 *
 * Whole words only, and read per sentence (see the 2026-10-04 note above): unanchored, the "NO" in
 * "XNO" excused every line on a site about XNO.
 */
export const NEGATION_CUES =
  /\b(never|no|not|nothing|none|only|forbids?|forbidden|refuses?|refused|without|does not|doesn't|cannot|can't|instead of|rather than)\b/i;

export const USDC = /USDC/i;

/**
 * Split one line into sentence-sized pieces, so a cue or an actor is read against the clause it
 * actually belongs to. A line is one piece when it carries no terminator, which is the common case
 * in `agent.json` and in HTML attributes.
 */
export function sentencesIn(line) {
  // Two boundaries this splitter must NOT get wrong, both found by getting them wrong first:
  //
  //   - An HTML entity ends in ';' and is not a sentence end. Splitting "USDC &rarr; XNO" at the
  //     semicolon inside `&rarr;` leaves "USDC &rarr;" with no XNO in it, and the into-XNO direction
  //     below becomes invisible — this file's own mistake, one layer down. Entities are masked first.
  //   - '?' does not end a statement in these strings. "Already hold USDC? Convert it to XNO with
  //     Nanswap" is one instruction: a premise and its answer. Splitting there strands the premise as
  //     a bare USDC mention. Keeping it whole cannot hide the forbidden case, because the network-as-
  //     actor rule is unconditional and reads the whole piece either way.
  const MASK = "\u0000";
  const masked = String(line).replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m) => m.slice(0, -1) + MASK);
  return masked
    .split(/(?<=[.!;])[\s)>]+/)
    .map((s) => s.split(MASK).join(";"))
    .filter((s) => s.trim().length > 0);
}

/**
 * Does this sentence put the NETWORK in charge of a conversion? Approximated by the network naming
 * itself BEFORE a conversion verb, which is the order English puts a subject in. The order matters:
 * "Unstuck converts your USDC at nanswap" is the network brokering, while "Convert it yourself — it
 * is your money, not ours" names us only to disclaim. Both directions are pinned by controls in
 * site_nano_only.test.mjs.
 */
export function networkIsTheActor(sentence) {
  const s = String(sentence);
  const actor = s.match(NETWORK_ACTOR);
  if (!actor) return false;
  const after = s.slice(actor.index + actor[0].length);
  if (BROKER_VERB.test(after)) return true;
  // The other direction: money moving TOWARDS the network ("Pay us in USDC", "Send USDC to the
  // network"). Here the verb comes first and the network is its object, so the test is mirrored.
  const recv = s.match(RECEIVE_VERB);
  return Boolean(recv && recv.index < actor.index);
}

/** Is this USDC mention one of the shapes the owner's rule permits? */
export function isPermittedUsdcMention(sentence) {
  return INTO_XNO.some((re) => re.test(String(sentence)));
}

/**
 * Return every violation in one file's text. Three mechanisms, each named in `why` so a failure says
 * which property broke:
 *
 *   - FORBIDDEN      machinery or a shipped bridge surface. Hard fail, any line.
 *   - swap venue     named in a sentence that makes the network the converter.
 *   - bare USDC      mentioned in a sentence that does not deny it.
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
    for (const sentence of sentencesIn(line)) {
      const networkActs = networkIsTheActor(sentence);
      for (const re of SWAP_VENUES) {
        const m = sentence.match(re);
        if (m && networkActs) {
          out.push({
            line: n + 1,
            why: `the network offers to convert at "${m[0]}" itself`,
            text: line.trim(),
          });
        }
      }
      if (!USDC.test(sentence)) continue;
      // The network handling USDC is a violation whatever else the sentence says: no denial and no
      // into-XNO wording can excuse "we settle your balance" or "pay us in USDC".
      if (networkActs) {
        out.push({ line: n + 1, why: "the network itself handles USDC", text: line.trim() });
        continue;
      }
      // Backstop: a USDC mention that neither denies USDC nor is one of the permitted shapes.
      if (!NEGATION_CUES.test(sentence) && !isPermittedUsdcMention(sentence)) {
        out.push({ line: n + 1, why: "names USDC without denying it", text: line.trim() });
      }
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

/**
 * Published surfaces this scanner CANNOT reach offline, recorded so the gap is a known one rather
 * than a silent one. `/swap.txt` is the network's whole USDC->XNO document and is the single page
 * most on-topic for this law, yet no file in this repository produces it: `site/vercel.json` rewrites
 * the path to the box (`172-86-112-140.sslip.io/swap.txt`), so it ships without passing any law here.
 * `oracle-swap-txt-nano-only.mjs` scans the live copy; see its header for what a cloud session can
 * and cannot measure about it.
 */
export const UNGUARDED_LIVE_ONLY = ["/swap.txt"];

/** Format a violation list as the multi-line detail a failing test prints. */
export function formatViolations(found) {
  return found.map((v) => `  line ${v.line}: ${v.why} -> ${v.text}`).join("\n");
}
