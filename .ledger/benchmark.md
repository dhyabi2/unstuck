# Benchmark: Agent discovery landscape

{
  "goal": "Scale agent discovery beyond 9 initial x402 endpoints to find and open accounts for new agents active in public",
  "current_state": {
    "agents_opened": 9,
    "persistent_addresses_opened": [
      "feeless402 premium",
      "pursekeeper hot wallet",
      "Wallenhof courier"
    ],
    "ephemeral_addresses_opened": [
      "Subnano",
      "Feed Weight Check",
      "NanoGPT chat",
      "NanoGPT web search",
      "Goonbot attest"
    ],
    "test_send": 1,
    "treasury_balance_xno": 9.99999991
  },
  "known_source_types": {
    "x402_endpoint_probing": {
      "count": 10,
      "services": [
        "feeless402",
        "NanoGPT",
        "Goonbot",
        "Wallenhof",
        "Subnano",
        "Feed Weight Check",
        "Contract Lens",
        "pursekeeper"
      ]
    },
    "pursekeeper_sellers_json": {
      "count": 10,
      "services": [
        "nanogpt",
        "cleartable",
        "llmrt",
        "pyfile-llm",
        "stringsafeqa",
        "contract-lens",
        "feed-weight-check",
        "oreomuncher-attest",
        "subnano",
        "sur-courier"
      ]
    },
    "x402_list_com": {
      "count": 25,
      "services": "all (mostly USDC)"
    },
    "nano_hub_ai_directory": {
      "count": 5,
      "services": [
        "NanoGPT",
        "LongStories.ai",
        "Al Nano Music",
        "OpenWallet",
        "Nano AI"
      ]
    }
  },
  "new_discovery_strategies": [
    {
      "name": "Operator-persistent address discovery",
      "description": "Find the actual operator wallet addresses behind x402 endpoints, not the ephemeral per-quote addresses they serve"
    },
    {
      "name": "GitHub repo scraping",
      "description": "Search repos for nano_ addresses in README, configs, and source files"
    },
    {
      "name": "Nano Hub ecosystem",
      "description": "Listings on hub.nano.org/ai for agents and services using Nano"
    },
    {
      "name": "Nano Bazaar",
      "description": "Agent marketplace at nanobazaar.ai with 38 completed jobs"
    }
  ],
  "key_insight": "Per-quote 402 payTo addresses rotate per-quote/60sec; only persistent deposit/wallet addresses are worth opening. The 4 non-opened Pursekeeper-listed operators (llmrt, pyfile-toolkit, StringSafeQA, ClearTable) use per-quote addresses from their endpoints. Their ACTUAL operators may have persistent Nano addresses elsewhere."
}
