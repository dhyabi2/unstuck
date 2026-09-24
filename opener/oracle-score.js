/**
 * opener/oracle-score.js — the arithmetic behind the integrity scorecard.
 *
 * Split out of oracle-check.js (block 186) so laws L75 and L77 can be proved on their own: L75 is
 * "an unseen URL can never score as trustworthy as a source with history, and a body that moved
 * loses its drift credit"; L77 is "every point of the score is attributed to a named component and
 * the attributed points sum to the score". Both are about this file and nothing else.
 *
 * There is no model in this file and no randomness: the same reading scored twice returns the same
 * number and the same `because` lines.
 */

"use strict";

/** Published weights. They sum to 100 and are the whole score — nothing else contributes. */
const WEIGHTS = {
  reachable: 30,
  tls: 15,
  redirects: 10,
  drift: 25,
  stability: 20,
};

/**
 * The score: fixed published weights over measured facts. Returns the total plus a `because`
 * line per component, so every point can be traced to the reading that earned it.
 */
function scoreReading(reading, prior) {
  const because = [];
  let score = 0;

  // 1. Reachable (30)
  const reachable = !reading.error && reading.final_status >= 200 && reading.final_status < 400;
  if (reachable) { score += WEIGHTS.reachable; because.push(`+${WEIGHTS.reachable} reachable (HTTP ${reading.final_status})`); }
  else because.push(`+0 not reachable${reading.error ? ` (${reading.error})` : ` (HTTP ${reading.final_status})`}`);

  // 2. TLS (15): https with a valid certificate, and no credit for plain http.
  const tls = reading.tls || {};
  if (tls.valid === true) {
    const nearExpiry = tls.days_remaining !== null && tls.days_remaining <= 21;
    const pts = nearExpiry ? Math.round(WEIGHTS.tls / 3) : WEIGHTS.tls;
    score += pts;
    because.push(`+${pts} TLS valid${nearExpiry ? ` but expires in ${tls.days_remaining}d` : ` (${tls.days_remaining}d left)`}`);
  } else if (tls.valid === null) {
    because.push("+0 plain http, no certificate to check");
  } else {
    because.push("+0 TLS invalid or unreadable");
  }

  // 3. Redirect chain (10): a stable single hop is fine; each extra hop is a re-pointing risk.
  const hops = (reading.redirects || []).length;
  if (reachable) {
    const pts = hops === 0 ? WEIGHTS.redirects : hops <= 2 ? 7 : hops <= 3 ? 4 : 0;
    score += pts;
    because.push(`+${pts} ${hops} redirect hop(s)${hops ? ` [${(reading.redirects || []).join(" -> ")}]` : ""}`);
  } else because.push("+0 redirect chain not measurable (unreachable)");

  // 4. Content drift (25): the component an uptime grade cannot produce.
  const history = prior.filter((r) => r.content_hash);
  if (reading.content_hash && history.length >= 1) {
    const changed = history[history.length - 1].content_hash !== reading.content_hash;
    const pts = changed ? 0 : WEIGHTS.drift;
    score += pts;
    because.push(changed
      ? "+0 CONTENT CHANGED since the last reading (a live endpoint whose body moved — re-pointed, hijacked, or genuinely dynamic)"
      : `+${WEIGHTS.drift} content identical to the last reading`);
  } else if (reading.content_hash && history.length === 0) {
    const pts = Math.round(WEIGHTS.drift / 2);
    score += pts;
    because.push(`+${pts} first reading: baseline hash stored, drift unknown (half credit, not a verdict)`);
  } else because.push("+0 no body to hash");

  // 5. Stability (20): how many of the recent readings were reachable.
  if (history.length >= 1) {
    const ok = history.filter((r) => !r.error && r.final_status >= 200 && r.final_status < 400).length;
    const ratio = ok / history.length;
    const pts = Math.round(WEIGHTS.stability * ratio);
    score += pts;
    because.push(`+${pts} ${ok}/${history.length} previous readings reachable`);
  } else {
    const pts = Math.round(WEIGHTS.stability / 2);
    score += pts;
    because.push(`+${pts} no history yet (half credit, not a verdict)`);
  }

  return { score, because };
}

/** The published reading of the number, so nobody has to interpret it themselves. */
function verdictOf(score, unseen) {
  if (unseen) return "unknown — first reading, no history to compare against";
  if (score >= 90) return "trustworthy — reachable, stable, content unchanged";
  if (score >= 70) return "mostly trustworthy — one component degraded";
  if (score >= 50) return "caution — verify before you rely on it";
  if (score >= 30) return "suspect — multiple components failing";
  return "do not trust — reachable but unreliable or its content moved";
}

module.exports = { scoreReading, verdictOf, WEIGHTS };
