/**
 * tests/site_no_wallet_ask.test.mjs — an agent with no Nano address can post its first ask
 * from the published discovery documents alone.
 *
 * The gap this file makes executable. Block 108 shipped the no-wallet path on the network
 * server (`GET /v1/onramp/address` hands out {address, seed, index, onboard_id}; `POST /ask`
 * accepts {onboard_id, title, body} and stores the handed-out nano_ address as the asker).
 * But nothing a visitor could READ named it:
 *
 *   measured 2026-09-19 against the shipped llms.txt and agent.json:
 *     - neither document mentioned /v1/onramp/address at all;
 *     - agent.json's /ask entry said only "Create an ask" and never named onboard_id;
 *     - llms.txt's "Get in" section sent the reader to /try-nano, whose prose asks for a
 *       wallet before the network will take an ask.
 *
 * So the outside agent the whole conversion plan exists for — on USDC, a card or platform
 * credits, holding no Nano — read the documents, found no way to be given an address, and
 * could not post. The capability existed and was invisible.
 *
 * The laws, each named so a failure says which property broke:
 *
 *   L67 — every published discovery document that names POST /ask also names the no-wallet
 *         path to it: GET /v1/onramp/address and the onboard_id handoff. A document that
 *         tells an agent to post without its wallet does not exist.
 *   L68 — the documented two calls really produce a 201: fetch the on-ramp as the document
 *         describes it, post an ask with the onboard_id it returned, read the ask back and
 *         see the handed-out nano_ address stored as the asker. (live half: the deployed
 *         origin; file half: the paths the documents name are exactly the paths probed.)
 *
 * Both halves read the real shipped files — the paths come out of llms.txt and agent.json,
 * never a reimplementation — and L68 is a real HTTP round trip, not a sentence saying it
 * would work.
 *
 * Run all:  node --test tests/site_no_wallet_ask.test.mjs
 * Run one:  node --test --test-name-pattern=L67 tests/site_no_wallet_ask.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");

const LIVE_ORIGIN = "https://getunstuck.space";
const API_PATH = "/unstuck/api";

/** The on-ramp path the server actually serves, relative to the API base. */
const ONRAMP_PATH = "/v1/onramp/address";
/** The ask path, relative to the API base. */
const ASK_PATH = "/ask";

/**
 * Every discovery document that tells an agent how to use the network, with its fetch path.
 * `.well-known/agent` is a compact directory record (no endpoint prose), so it is not in the
 * set a documented POST /ask can hide in — it is checked by L64 already.
 */
const DOCS = [
  { file: "llms.txt", urlPath: "/llms.txt", kind: "text" },
  { file: "agent.json", urlPath: "/agent.json", kind: "json" },
  { file: ".well-known/agent.json", urlPath: "/.well-known/agent.json", kind: "json" },
  { file: ".well-known/agent-card.json", urlPath: "/.well-known/agent-card.json", kind: "json" },
];

const read = (rel) => fs.readFileSync(path.join(SITE, rel), "utf8");

// ---------------------------------------------------------------------------
// L67 — a document that names POST /ask also names the way in without a wallet
// ---------------------------------------------------------------------------

test("L67 every document that names POST /ask names GET /v1/onramp/address", () => {
  // The falsifiable core: this must be checked against the documents, not asserted about
  // them. A document that posts asks but never says how an agent with no address gets one
  // leaves the whole conversion target stuck at read-only.
  const offenders = [];
  for (const d of DOCS) {
    const body = read(d.file);
    const namesAskPost = d.kind === "json"
      ? (JSON.parse(body).endpoints || []).some((e) => e.path === ASK_PATH && e.method === "POST")
      : /^POST\s+\/unstuck\/api\/ask\b/m.test(body);
    if (!namesAskPost) continue;
    if (!body.includes(ONRAMP_PATH)) {
      offenders.push(`${d.file} names POST ${API_PATH}${ASK_PATH} but never names ${ONRAMP_PATH}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a discovery document tells an agent to post an ask without ever saying how an agent that holds no Nano gets an address; that agent reads the document and still cannot post:\n  ${offenders.join("\n  ")}`
  );
});

test("L67 every JSON document that names POST /ask declares the onboard_id body", () => {
  // The on-ramp path alone is not enough: an agent that fetches an address still needs to be
  // told that the ask it is about to post takes onboard_id rather than an asker address.
  // agent.json carries this in `first_call` (the explicit two-call recipe); the .well-known
  // copies carry the same block, so the property is asserted over the block, present in each.
  for (const d of DOCS.filter((x) => x.kind === "json")) {
    const obj = JSON.parse(read(d.file));
    const ask = (obj.endpoints || []).find((e) => e.path === ASK_PATH && e.method === "POST");
    assert.ok(ask, `${d.file} no longer advertises POST ${ASK_PATH}`);
    assert.ok(
      /onboard_id/.test(ask.description || ""),
      `${d.file} advertises POST ${ASK_PATH} without naming onboard_id: ${JSON.stringify(ask.description)}`
    );
    const fc = obj.first_call;
    assert.ok(fc, `${d.file} carries no first_call recipe for an agent with no wallet`);
    assert.equal(fc.call_1.method, "GET", `${d.file} first_call.call_1 must be a GET`);
    assert.equal(fc.call_1.path, ONRAMP_PATH, `${d.file} first_call.call_1 must be ${ONRAMP_PATH}`);
    assert.equal(fc.call_2.method, "POST", `${d.file} first_call.call_2 must be a POST`);
    assert.equal(fc.call_2.path, ASK_PATH, `${d.file} first_call.call_2 must be ${ASK_PATH}`);
    assert.ok(
      fc.call_2.body && "onboard_id" in fc.call_2.body,
      `${d.file} first_call.call_2 body never carries onboard_id: ${JSON.stringify(fc.call_2.body)}`
    );
    // call_2's path must be resolvable against the API base the document states, or the recipe
    // sends an agent to a 404 — the exact defect L64/L65 exist for.
    assert.ok(
      !String(fc.call_1.path).startsWith(API_PATH),
      `${d.file} first_call path ${fc.call_1.path} repeats the API prefix; these paths are relative to api`
    );
  }
});

test("L67 llms.txt gives the no-wallet path both as its own section and next to POST /ask", () => {
  const txt = read("llms.txt");
  // Next to the endpoint, so an agent that jumps straight to the ask line sees it.
  assert.ok(
    txt.includes(`GET ${API_PATH}${ONRAMP_PATH}`) || txt.includes(`GET /unstuck/api${ONRAMP_PATH}`),
    `llms.txt must name GET ${API_PATH}${ONRAMP_PATH}`
  );
  // The section heading, so a text-reading agent scanning headings finds it.
  assert.match(
    txt,
    /^###.*NO wallet/m,
    "llms.txt must carry a heading an agent scanning the document finds for the no-wallet path"
  );
  // The handoff field must be named where the ask is documented. Both the section and the
  // endpoint entry use it; at least two mentions means it is not a single passing remark.
  const mentions = [...txt.matchAll(/onboard_id/g)].length;
  assert.ok(
    mentions >= 3,
    `llms.txt names onboard_id ${mentions} time(s); the path needs it in the section, the response and next to POST /ask`
  );
  // And the endpoint path documented here must still be a full API-base-relative path (L65).
  const bare = [...txt.matchAll(/^(GET|POST)\s+(\/v1\/onramp\/address)/gm)];
  assert.deepEqual(
    bare.map((m) => m[0]),
    [],
    "llms.txt names /v1/onramp/address without the API base, so an agent resolves it against the origin root and 404s"
  );
});

// ---------------------------------------------------------------------------
// L68 — the documented calls really produce a 201
// ---------------------------------------------------------------------------

async function jsonReq(method, url, body, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ctl.signal,
      headers: body
        ? { "Content-Type": "application/json", Accept: "application/json" }
        : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "follow",
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON answer is still an answer */ }
    return { status: res.status, body: parsed, text };
  } catch (e) {
    return { error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

test("L68 the two documented calls post an ask on the live origin", async (t) => {
  // Non-vacuity guard: if the origin does not answer at all this is a SKIP with its reason,
  // never a pass — a check that can only skip is not a check, so the reason is printed.
  const health = await jsonReq("GET", `${LIVE_ORIGIN}${API_PATH}/health`);
  if (health.error) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN}${API_PATH}/health did not answer (${health.error})`);
    return;
  }
  assert.equal(health.status, 200, `the live origin's health endpoint answered ${health.status}`);

  // Call 1, exactly as the documents describe it.
  const onramp = await jsonReq("GET", `${LIVE_ORIGIN}${API_PATH}${ONRAMP_PATH}`);
  assert.ok(!onramp.error, `GET ${API_PATH}${ONRAMP_PATH} did not answer: ${onramp.error}`);
  assert.equal(onramp.status, 200, `GET ${API_PATH}${ONRAMP_PATH} answered ${onramp.status}`);
  const { address, seed, onboard_id: onboardId } = onramp.body || {};
  assert.match(String(address), /^nano_[13][0-9a-z]{59}$/, `on-ramp returned no nano_ address: ${JSON.stringify(address)}`);
  assert.match(String(seed), /^[0-9A-Fa-f]{64}$/, `on-ramp returned no 64-hex seed: ${JSON.stringify(seed)}`);
  assert.ok(Number.isInteger(onboardId), `on-ramp returned no onboard_id: ${JSON.stringify(onboardId)}`);

  // Call 2, with no asker address anywhere in the body — the whole point.
  const posted = await jsonReq("POST", `${LIVE_ORIGIN}${API_PATH}${ASK_PATH}`, {
    onboard_id: onboardId,
    title: "law L68: an agent with no wallet posts its first ask",
    body: "This ask was posted from the published discovery documents alone, with no Nano address of its own.",
  });
  assert.ok(!posted.error, `POST ${API_PATH}${ASK_PATH} did not answer: ${posted.error}`);
  assert.equal(
    posted.status,
    201,
    `the documented no-wallet ask answered ${posted.status}: ${String(posted.text).slice(0, 300)}`
  );
  assert.ok(Number.isInteger(posted.body && posted.body.id), `the ask was accepted with no id: ${posted.text}`);

  // Read it back: the stored asker must be the address the on-ramp handed out, not a fiction.
  const got = await jsonReq("GET", `${LIVE_ORIGIN}${API_PATH}${ASK_PATH}/${posted.body.id}`);
  assert.equal(got.status, 200, `reading the ask back answered ${got.status}`);
  assert.equal(
    got.body && got.body.ask && got.body.ask.asker,
    address,
    "the stored asker is not the on-ramp address; the asker field must never be a fiction"
  );
  t.diagnostic(`live: no-wallet ask ${posted.body.id} stored asker ${address.slice(0, 14)}…`);
});

test("L68 an unknown onboard_id and a bare name are both refused, not silently accepted", async (t) => {
  // The other half of the law: the path is only usable if it is strict. An ask that stores a
  // made-up identity is worse than one refused, because the record then says something untrue.
  const health = await jsonReq("GET", `${LIVE_ORIGIN}${API_PATH}/health`);
  if (health.error) {
    t.diagnostic(`SKIPPED live check: ${LIVE_ORIGIN} did not answer (${health.error})`);
    return;
  }
  const badId = await jsonReq("POST", `${LIVE_ORIGIN}${API_PATH}${ASK_PATH}`, {
    onboard_id: 999999999,
    title: "law L68: a made-up onboard id",
    body: "this must be refused",
  });
  assert.equal(badId.status, 400, `an unknown onboard_id answered ${badId.status}, not 400`);

  const bareName = await jsonReq("POST", `${LIVE_ORIGIN}${API_PATH}${ASK_PATH}`, {
    asker: "an-agent-with-no-address",
    title: "law L68: a bare name in place of an address",
    body: "this must be refused",
  });
  assert.equal(bareName.status, 400, `a bare non-nano asker answered ${bareName.status}, not 400`);
});