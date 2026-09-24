# Benchmark: Agent registry discovery landscape

## Current discovery sources (status quo)
| Source | Reach | Nano presence | Access method | Agents found |
|--------|-------|--------------|---------------|-------------|
| x402 live probing | ~15 endpoints | Yes (already found) | HTTP 402 probe | 11 opened |
| CDP Bazaar | 15,878 resources | ZERO | Paginated scan | 0 Nano |
| Pursekeeper sellers | 10 listed | Partial (4 addresses) | JSON endpoint | 4 known |

## New sources (what we should add)
| Source | Reach | Nano presence | Access | Cost |
|--------|-------|--------------|--------|------|
| Agents.NET API | 82 agents | Unknown | Free HTTP API, no auth | Free |
| AgentRolodex (A2A) | 35 listings | Unknown | Web scrape / A2A API | Free |
| a2a.directory | 16,492 entries | Unknown | Web scrape | Free |

## Key insight from previous blocks
Block 7 proved that major x402 marketplaces and CDP-style marketplaces have ZERO Nano.
The next frontier is agent registries (Agents.NET, A2A directories) where agents
self-register. These are "agents demonstrably active in public" by definition.

## Why Agents.NET is the most promising
1. Free public API with pagination — no API key needed
2. 82 agents with structured metadata (name, description, category, apiEndpoint)
3. apiEndpoint field allows direct probing for Nano payment support
4. Agents are categorized: Analytics, Design, Engineering, Finance, etc.
5. "demonstrably active" — they're in a public registry with timestamps

## Risk/challenges
1. Many apiEndpoint URLs may be generic homepages, not agent endpoints
2. Most agents serve USDC/x402-USDC, not Nano
3. Some endpoints may be unreachable or require auth
4. The count (82) is small — needs to be supplemented with other sources

