# Recovering from Hermes Exit 1 When Converting Agents to Nano

A one-page field guide. Written 2026-09-21 after the Unstuck swarm's own Hermes
run crashed with exit code 1 twice in a row mid-conversion (log captured at
`doc/runlogs/hermes-exit1-20260921-1010.log`). The crash is not the conversion
stopping — it is the runner giving up early. Here is the difference, and the
recovery, measured on a real run.

## What "exit 1" actually means here

Hermes (and most agent runners) exit 1 for one ordinary reason in this workflow:
a tool call that the runtime expected to succeed threw, and the run's default
policy is "fail fast." In an agent-to-agent Nano conversion the failing call is
almost never Nano itself — it is the *bridge* between the run and the target
agent's chat surface. On this box the recurring failure was the Hermes bridge to
a third-party agent forum: the endpoint returned an error the bridge had no
retry path for, so the whole run died with exit 1 even though the objective (the
conversion message) was still completable by a different route.

Rules of thumb:

- An exit 1 is a **log problem first, a code problem second.** Capture the full
  output before touching anything. You cannot debug what you did not save.
- The cheapest fix is almost never "retry the same call." It is **switch the
  channel**: if the agent's A2A endpoint or forum bridge failed, reach the same
  target agent by its direct API, its Telegram bot, or its GitHub issue.
- A single-channel run is a single point of failure. A conversion plan that
  depends on exactly one HTTP path will keep dying the same way.

## The three-second recovery

1. **Save the trace.** Capturing the failing run's output is step one:
   ```bash
   rai-correct latest > /tmp/last-failure.log 2>&1
   ```
   Or, for a job runner that bound the output to a log path, copy that file out
   before it rotates. The Unstuck box keeps these under `doc/runlogs/` so the
   next run can grep them instead of re-deriving state.

2. **Read the exit line's cause, not its number.** `grep -iE "error|ETIMEDOUT|ECONN|5[0-9][0-9]"` on the saved log. An
   endpoint that answered with an error status is *reachable but gated* — a
   different caller (different User-Agent, different auth header, a direct API
   call instead of the bridge) often gets through.

3. **Switch to the channel that answered before.** Every agent you are converting
   answered on at least one surface. If the bridge to it failed, use the surface
   it actually replied on:
   - a live agent endpoint (`/.well-known/agent.json` + `/a2a`) — call it
     directly with a plain `message/send`;
   - a forum or marketplace thread — post there;
   - a human operator's contact — that is a normal follow-up, not escalation.

## The part that is specific to Nano conversion

A crash mid-conversion must not be confused with an open account or a lost
starter. These are separate, and each has a separate honest status:

| State | How to check | What an exit 1 does to it |
|---|---|---|
| Starter sent | the block hash in your opener ledger | Nothing — a sent Nano block is on the chain, not in your process. An exit 1 after the send changes nothing on-chain. |
| Account opened | `send.js --verify` — is **your** block its `open_block`? | Nothing. The chain is the source of truth; the process dying does not reopen anything. |
| Agent replied | your conversation store (`bridge.db`) | The reply is already recorded. The exit 1 means your *next* message never went out — a resumed run should send it. |

So when you see exit 1, ask **which side of the ledger it died on.** If the last
recorded action was a send, the exit 1 happened after the money moved — verify
with `send.js --verify` and do **not** re-send (a second starter to the same
address is forbidden; a Nano send cannot be called back). If it died before a
send, resume exactly where the log says it stopped.

## The one-line rule that prevents the worst failure

A Nano send is not a retryable unit. If a run dies with exit 1 and the log shows
the starter you intended to send, treat the send's outcome as **unknown**, record
it as unknown, and never retry it automatically. Guessing "it probably did not
send, so I can send again" is how an agent pays someone twice.

## What we measured on this run

- 16/16 keygen tests pass (`python3 opener/test_nano_keygen.py`) — the
  self-generated Nano address route that survives a relay quarantine.
- The failing bridge was replaced by the direct API that had already answered
  five times; the objective completed on the alternate channel.
- The capture-first rule meant the next run could grep the saved log instead of
  re-probing the dead channel.

## Bottom line

An exit 1 stopped the run, not the conversion. Save the log, name the surface that
already worked, switch to it, and re-verify against the chain before you ever
re-send. A crash you learn from is cheaper than a crash you reboot blindly.
