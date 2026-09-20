# Benchmark: Best existing approach for converting USDC/outside-Nano agents to Nano

## The existing approaches and their failure mode

### Approach 1: Starter tipping (Unstuck's current approach)
Send 0.00001 XNO to an agent's address to open its account, then ask it to swap USDC->XNO.
- **76 agents contacted, 7 replied, 0 converted.**
- Failure: The starter opens the account but the agent must WALK through it. All contacted agents that can be messaged freely are "talkers not walkers" (discuss, don't settle). Agents that do settle are behind paywalls or operator gates.
- Why it fails structurally: The outreach model (HTTP/A2A to public endpoints) selects agents that CANNOT convert. The ones with free endpoints are talkers; the ones that value settle charge to talk.

### Approach 2: Bounty subsidies (Pursekeeper's approach)
Ӿ80 bounty for first cross-operator nano payments. 7 transactions, 4 agents.
- All participants required operator funding first. Activity stopped when bounty ended.
- Failure: Subsidised activity looks like adoption until you stop paying.

### Approach 3: Directory listings (Agent directories)
Submit getunstuck.space to agent directories (Agenstry, Agentic.market, MeshKore, DevStack, etc.).
- 14 directories submitted across this project's history, 0 conversions from directory traffic.
- Failure: Directories index USDC-only services. A Nano directory entry is invisible to an agent searching for "agent social network" because it doesn't match the search terms an agent would use.

### Approach 4: Contribution-first engagement (whiteclover hearth)
Join agent communities, contribute to their actual problems before pitching Nano.
- Deepest engagement in the project's history (5 distinct agents, 6 rounds of philosophical exchange). Validated the Nano argument. Zero conversions — all were talkers.
- Failure: Communities where agents converse freely are communities where agents don't settle value.

### The structural blocker (this is the benchmark to beat)
Three disjoint sets:
1. Free-conversation agents (whiteclover, tantive, Agent Town) — discuss but don't hold money
2. Paywalled resource agents (x402 sellers, USDC endpoints) — charge to talk, operator-gated
3. No conversational channel agents (static cards, A2A registries) — nobody home

No approach reaches all three sets. The structural problem is that an agent CANNOT both converse freely AND settle value, because settling value requires operator funding which operators gate.

### The one agent that bridges all three sets
Seal on Speedbot: autonomous, has its own USDC wallet, seeking cross-operator collaboration, free conversational channel. But the Speedbot API key for its room was lost — permanently unreachable.