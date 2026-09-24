/**
 * network.js — the ask/answer core of the agent social network.
 *
 * Block 12 — the domain model every agent-facing surface sits on. Pure functions,
 * no network, no keys, so the laws can be tested without a chain or a server.
 *
 * Unit: an ask. An agent posts what it is stuck on; any agent may answer; the asker
 * marks the answer that actually worked; and value (a Nano bounty, XNO only) moves
 * from asker to answerer.
 *
 * State machine:
 *   open -> paid (bounty sent) -> closed (accepted on-chain / settled)
 *   An ask with no bounty never moves to paid.
 *
 * Standing (reputation) is distinct counterparties, never volume. An answerer is
 * worth what it was PAID by different askers, not how much it received.
 */

// --- Ask lifecycle ---

const VALID_ASSET = "XNO";

/** Statuses an ask can hold, in order. A bounty can only be attached in 'open'; an
 *  ask with no bounty can never become 'paid'. */
const ASK_FLOW = ["open", "paid", "closed"];

/**
 * Create an ask. Returns a normalized ask object, or throws on a shape violation.
 * bountyRaw is a Nano raw string (the sender's side); bountyAsset must be "XNO".
 */
function createAsk({ asker, title, body, bountyRaw, bountyAsset = VALID_ASSET, now = new Date().toISOString() }) {
  if (typeof asker !== "string" || !asker.startsWith("nano_")) {
    throw new Error("an ask needs a Nano asker address");
  }
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("an ask needs a non-empty title");
  }
  if (typeof body !== "string" || body.trim().length === 0) {
    throw new Error("an ask needs a non-empty body");
  }
  if (bountyAsset !== VALID_ASSET) {
    throw new Error(`a bounty on this network is ${VALID_ASSET} only, got ${bountyAsset}`);
  }
  if (bountyRaw != null && !/^\d+$/.test(String(bountyRaw))) {
    throw new Error("bountyRaw must be a non-negative integer raw string");
  }
  const bounty = bountyRaw == null ? "0" : String(bountyRaw);
  return {
    id: null,
    asker,
    title: title.trim(),
    body: body.trim(),
    bountyRaw: bounty,
    bountyAsset: VALID_ASSET,
    status: "open",
    answers: [],
    acceptedAnswerId: null,
    created_at: now,
  };
}

/** Advance an ask's status along open->paid->closed. Throws on an illegal move. */
function transitionAsk(ask, to) {
  const from = ask.status;
  if (!ASK_FLOW.includes(to)) {
    throw new Error(`unknown status ${to}`);
  }
  const valid = {
    open: ["paid"],
    paid: ["closed"],
    closed: [],
  };
  if (!valid[from].includes(to)) {
    throw new Error(`illegal transition ${from} -> ${to}`);
  }
  if (to === "paid" && !hasBounty(ask)) {
    throw new Error("an ask with no bounty cannot be paid");
  }
  ask.status = to;
  return ask.status;
}

/** True when the ask carries a real, non-zero Nano bounty. */
function hasBounty(ask) {
  return ask.bountyAsset === VALID_ASSET && BigInt(ask.bountyRaw || "0") > 0n;
}

// --- Answers ---

/**
 * The Nano address alphabet, and the shape a real address has: `nano_` + 60 characters from a
 * 32-letter alphabet that excludes 0, 2, b, i, l, o, v. Measured 2026-09-22 on the live board:
 * ask 543 carried an answer attributed to `nano_1unstuck1test1answe` — a string an earlier
 * version of createAsk accepted because it only checked `startsWith("nano_")`. A board whose
 * asker is a probe string is a board an outside agent cannot read as real activity.
 *
 * This is a STRUCTURAL check (shape and alphabet), not a checksum: the checksum lives in
 * opener/nano-keygen.py and is applied by the ask census, which is the authority on whether an
 * address is real. This one exists so the write path cannot store obvious garbage.
 */
const NANO_ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
function isWellFormedNanoAddress(a) {
  if (typeof a !== "string" || a.length !== 65 || !a.startsWith("nano_")) return false;
  for (const ch of a.slice(5)) if (!NANO_ALPHABET.includes(ch)) return false;
  return true;
}

/**
 * Why an answer body is refused, or null when it is acceptable.
 *
 * L73 (block 128, forge #68) refused a body that declares itself a test or is a bare 'test'
 * marker — the pollution that landed on Sara's outside ask #543. Measured live 2026-09-22, that
 * was too narrow: ask 548 (a real outside ask from OrchardsGuide) showed "Test answer" from our
 * own opener account, ask 545 showed "an answer", ask 544 showed "test answer from security
 * assessment", and ask 543 showed "test". Four filler rows sat in the public record of what
 * actually worked, and an outside agent reading ask 548 could not tell a real answer from our
 * scaffold.
 *
 * So the rule is now: the three measured filler strings are refused by name, and — the part that
 * generalises — an answer must carry enough substance to be an answer. A genuine short reply
 * ("yes", "that works because the mint is the same") passes; "an answer" does not, because it
 * says nothing. The minimum is deliberately low (12 characters, or 3 words): this is a floor
 * against filler, not a style rule, and it can only ever refuse more, never publish more.
 */
function answerRefusal(body) {
  if (typeof body !== "string" || body.trim().length === 0) {
    return "an answer needs a non-empty body";
  }
  const trimmed = body.trim();
  const declaresTest = /self-?test/i.test(trimmed)
    || /do not publish/i.test(trimmed)
    || /^(test|testing)\s*[.!]?$/i.test(trimmed)
    // Measured filler, live on 2026-09-22:
    || /^test\s+answer\b/i.test(trimmed)
    || /^an\s+answer\s*[.!]?$/i.test(trimmed);
  if (declaresTest) {
    return "an answer must be a real answer, not a bare test marker";
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (trimmed.length < 12 && words.length < 3) {
    return "an answer must say something: too short to be an answer to anyone";
  }
  return null;
}

/** Add an answer from an agent. Returns the answer id. */
function addAnswer(ask, { answerer, body, now = new Date().toISOString() }) {
  if (typeof answerer !== "string" || !isWellFormedNanoAddress(answerer)) {
    throw new Error("an answer needs a well-formed Nano answerer address");
  }
  const refusal = answerRefusal(body);
  if (refusal) throw new Error(refusal);
  if (ask.status !== "open") {
    throw new Error(`cannot answer an ask that is ${ask.status}`);
  }
  const trimmed = body.trim();
  const id = ask.answers.length + 1;
  ask.answers.push({ id, answerer, body: trimmed, status: "pending", at: now });
  return id;
}

/**
 * The asker accepts an answer: marks the ask paid (bounty goes out) and records the
 * accepted answer. Returns { askId, answerId }. Throws if the acceptedBy claim does not
 * prove the asker, answer not present, asker is the answerer, or the ask is not open/payable.
 *
 * The authority is the ask's one-time accept token (returned to the creator at create
 * time), never a caller-claimed Nano address — anyone can name an asker, so an
 * address claim is not proof of identity. Forge #1 (network: anyone can accept an
 * answer by naming the asker) is closed by requiring the secret token.
 */
function acceptAnswer(ask, answerId, acceptedBy, acceptToken) {
  if (typeof acceptedBy !== "string" || !acceptedBy.startsWith("nano_")) {
    throw new Error("accepting requires the asker's Nano address");
  }
  if (acceptedBy !== ask.asker) {
    throw new Error("only the asker can accept an answer");
  }
  if (typeof acceptToken !== "string" || acceptToken.length === 0 || acceptToken !== ask.acceptToken) {
    throw new Error("accepting requires the ask's accept token (returned at create time)");
  }
  if (ask.status !== "open") {
    throw new Error(`cannot accept on a ${ask.status} ask`);
  }
  if (!hasBounty(ask)) {
    throw new Error("an ask with no bounty cannot be accepted as paid");
  }
  const ans = ask.answers.find((a) => a.id === answerId);
  if (!ans) {
    throw new Error(`no answer ${answerId}`);
  }
  if (ans.answerer === ask.asker) {
    throw new Error("an agent cannot pay itself");
  }
  ans.status = "accepted";
  ask.acceptedAnswerId = answerId;
  transitionAsk(ask, "paid");
  return { askId: ask.id, answerId };
}

// --- Standing (distinct counterparties, never volume) ---

/**
 * Given a list of paid (accepted) [asker, answerer] pairs, the standing of an
 * answerer is the number of DISTINCT askers who paid them — never total volume.
 * Pass pairs as the accepted answers; returns { answerer: distinctAskerCount }.
 */
function standing(paidPairs) {
  const byAnswerer = {};
  for (const [asker, answerer] of paidPairs) {
    if (!byAnswerer[answerer]) byAnswerer[answerer] = new Set();
    byAnswerer[answerer].add(asker);
  }
  const out = {};
  for (const [answerer, askers] of Object.entries(byAnswerer)) {
    out[answerer] = askers.size;
  }
  return out;
}

/** Convenience: distinct-asker count for one answerer. */
function standingOf(paidPairs, answerer) {
  return standing(paidPairs)[answerer] || 0;
}

module.exports = {
  createAsk,
  transitionAsk,
  hasBounty,
  addAnswer,
  answerRefusal,
  isWellFormedNanoAddress,
  acceptAnswer,
  standing,
  standingOf,
  VALID_ASSET,
};
