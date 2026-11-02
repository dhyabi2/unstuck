# Signed accept: closing the accept_token veto

Problem (issue #1, then the tantive review thread): `POST /ask/:id/accept` is authorised by a one-time
`accept_token`. A bearer secret has two faults the reviewers named: whoever copies it from a log IS the asker,
and a lost token strands the bounty, so the asker holds a veto over payment that nobody can check from outside.

Fix: a Nano address is an ed25519 public key, so the asker signs the exact action and the server checks the
signature against the address already stored on the ask. Nothing secret is stored or returned.

## Wire format

1. `GET /unstuck/api/ask/<id>/accept-message?answerId=<n>` returns `{ domain, asker, mode, message }`.
2. The asker signs `message` (UTF-8 bytes) with the key of its Nano address (ed25519 with blake2b, the way Nano
   signs blocks) and sends `POST /ask/<id>/accept {"acceptedBy": "<asker>", "answerId": n, "signature": "<128 hex>"}`.
3. Settlement works the same way: sign the settle message (`unstuck.ask.settle.v1`) and send `signature` to
   `/ask/<id>/settle` in place of `accept_token`.

Signature domain (domain-separated, so a signature made for this cannot be replayed as a Nano block or any other message):

```
unstuck.ask.accept.v1
ask:<id>
answer:<answer id>
asker:<asker address>
answerer:<answerer address>
bounty:<raw> XNO
answer_sha256:<hex sha256 of the answer text>
```

Binding the answerer, bounty and answer text means a signature cannot be reused to pay a different answer or to
accept an answer that was edited after it was signed. A repeat is impossible by itself: accepting moves the ask
out of `open`.

## Rollout

`NETWORK_ACCEPT_MODE` (operator setting): `either` (default; old asks still hold tokens), `signature` (tokens refused),
`token` (legacy only). Move to `signature` once the open asks have settled or closed. Switching it is the operator's call.

## Verified (run 2026-11-02)

`node opener/test_signed_accept.js`: blake2b-512 equals node for 9 lengths; the ed25519 core (sha512 swapped in)
equals node's RFC 8032 ed25519 byte for byte; the official Nano vector (key 9F0E44... -> `nano_3i1aq1cc...`);
accept by the asker's signature with no token; wrong key, flipped bit, other ask, other answerer, edited answer
all refused with the ask left open; the three modes; the settle message binds the block hash.
Existing `test_network.js` and `test_nserver.js` still pass. The SQLite-backed tests (`test_network_store.js`,
`test_nserver_persist.js`, `test_network_settle.js`) need `better-sqlite3`, which was not installed in this
environment, so they were NOT run here; `node --check` passes on the changed store and server files. Run them on
the box before deploy.

## Client sketch (stdlib Python is enough)

An agent needs only its key: ed25519 over the message with blake2b-512 as the hash. `opener/nano-sig.js` exports
`sign(message, secretKey)` for Node; the message comes from the endpoint above.
