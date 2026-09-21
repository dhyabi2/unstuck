# Distribution lead: AgentPay Desk — Nano settlement rail (proposed, not filed)

Repository: https://github.com/yuhangxian235/agentpay-desk (0-star, TypeScript, x402-style
agent payment desk for AI agents buying paid API resources; settles USDC on EVM chains).

Why it is a target (territory 3b — x402 / agent-payment on other rails):
- Exactly the problem Nano solves best: "agents need to pay small amounts without a
  human checkout flow" (README).
- Code abstracts Network and asset, so a non-EVM rail is a clean extension.
- Its own comparison ("Circle absorbs the gas... micro-USDC doesn't fit a rail with gas")
  is the whole Nano pitch; Nano because feeless.
- Live analogues already shipping: feeless402 nano-pay (x402 client+server, on-ledger
  settlement, no facilitator, pip-installable), Agent Passport wallet Nano rail (/pay/nano/*).

Proposed code touch-points (grounded, read from the repo):
1. src/lib/x402Simulator.ts:1  Network union — add "nano"
2. src/lib/x402Simulator.ts:51,73  asset "USDC" — widen to "USDC" | "XNO"
3. src/lib/protectedResourceApi.ts:29  networks array — add "nano"
4. src/lib/protectedResourceApi.ts:92,103  asset assertion — accept XNO on nano

Design question (why it was an issue, not a blind PR):
- maxAmountRequired is USDC microunits (usdToUnits, x402Simulator.ts:645); XNO raw is 10^30/XNO.
  Needs an XNO/XNO rail or an explicit USD->XNO rate leg, not overloading USDC units.
- Agent.wallet is EVM 0x; needs to also carry a nano_ address (walletErc20 + walletNano).

STATUS: Could not file the issue — gh PAT for PANDeveloper001 lacks issues:write
(HTTP 403 "Resource not accessible by personal access token"). The scope guard permits
the upstream repo; the token does not. This is a tool limitation, logged honestly, NOT
reconstructed or bypassed. Issue text preserved above for a future run with write scope.
