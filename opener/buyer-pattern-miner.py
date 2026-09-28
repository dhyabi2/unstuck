#!/usr/bin/env python3
"""Buyer pattern miner: scan public sources for agents posting about
verification or payment needs, extract leads, and format tailored asks.

Corrective action #3 (2026-09-27): Build a buyer pattern miner scanning
crypto forums for similar phrasing, extracting leads, and auto-posting
tailored asks.

Sources scanned:
- GitHub issue search (agent payment, verification, proof)
- Public agent directories (where reachable)

Output: leads suitable for the buyer shelf (buy-side-ask-templates.py format)

Usage:
  python3 opener/buyer-pattern-miner.py                     # scan all sources
  python3 opener/buyer-pattern-miner.py --save              # save leads as JSON
  python3 opener/buyer-pattern-miner.py --min-score 5       # only high-scoring leads
  python3 opener/buyer-pattern-miner.py --help
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import re
from datetime import datetime

# Known directories and search endpoints
DIRECTORIES = [
    "https://agent-tools.cloud/api/v2/agents?limit=50",
    "https://api.speedbot.dev/api/agents?limit=50",
]

GITHUB_SEARCHES = [
    ("agent payment verification", "https://api.github.com/search/issues?q=agent+payment+verification&sort=updated&per_page=10"),
    ("Nano payment agent", "https://api.github.com/search/issues?q=nano+payment+agent&sort=updated&per_page=10"),
    ("cross-operator payment", "https://api.github.com/search/issues?q=%22cross-operator%22+payment+agent&sort=updated&per_page=10"),
    ("agent bounty USDC", "https://api.github.com/search/issues?q=agent+bounty+USDC&sort=updated&per_page=10"),
    ("x402 payment agent", "https://api.github.com/search/issues?q=x402+payment+agent&sort=updated&per_page=10"),
    ("AI agent verification", "https://api.github.com/search/issues?q=%22AI+agent%22+verification+payment&sort=updated&per_page=5"),
]

# Signature patterns for buyer intent
BUYER_SIGNATURES = [
    # Asks for verification work
    r"(verify|confirm|check|validate|audit)\s.*(proof|receipt|receipt|block|transaction)",
    # Asks for payment rails
    r"(accept|take|receive)\s.*(payment|pay|usdc).*(agent|bot|automated)",
    # Agent-to-agent payment asks
    r"(agent|bot|automated).*(pay|payment|settle|send\s+money)",
    # Bounty/offer language
    r"(bounty|offer|reward|pay)\s.*\d+.*(XNO|xno|nano|USDC|usdc)",
    # Integration requests
    r"(integrat|add|support|need).*(nano|Nano|XNO|payment\s+rail)",
]

LEADS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "buyer-leads.json")


def fetch_json(url, headers=None):
    """Fetch a URL and parse JSON."""
    hdrs = {"User-Agent": "Unstuck-BuyerMiner/1.0"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "url": url}
    except Exception as e:
        return {"error": str(e), "url": url}


def score_lead(title, body, url):
    """Score a lead for buyer-match quality. 0-10."""
    score = 0
    text = f"{title} {body}".lower()

    # Explicit payment mention
    if any(t in text for t in ["xno", "nano"]):
        score += 3
    if any(t in text for t in ["usdc", "payment", "pay"]):
        score += 2

    # Verification ask
    if any(t in text for t in ["verify", "proof", "receipt", "confirm"]):
        score += 2

    # Agent mention
    if "agent" in text:
        score += 1

    # Bounty/offer with number
    if re.search(r'(bounty|offer|reward)\s+\d+', text):
        score += 2

    # Active (recently updated — heuristic via signature)
    if "issue" in url or "pull" in url:
        score += 1  # likely actionable

    return score


def scan_github():
    """Scan GitHub for buyer-intent issues."""
    leads = []
    for label, url in GITHUB_SEARCHES:
        data = fetch_json(url, headers={"Accept": "application/vnd.github.v3+json"})
        if "error" in data:
            continue
        items = data.get("items", [])
        for item in items:
            title = item.get("title", "")
            body = item.get("body", "") or ""
            url = item.get("html_url", "")
            repo_url = item.get("repository_url", "")
            created = item.get("created_at", "")
            score = score_lead(title, body, url)
            lead = {
                "source": "github",
                "label": label,
                "title": title[:200],
                "url": url,
                "repo": repo_url,
                "created": created,
                "score": score,
                "matched_signatures": [
                    p for p in BUYER_SIGNATURES
                    if re.search(p, f"{title} {body}", re.IGNORECASE)
                ][:3],
            }
            leads.append(lead)
    return leads


def scan_directories():
    """Scan agent directories for buyer-intent agent profiles."""
    leads = []
    for url in DIRECTORIES:
        data = fetch_json(url)
        if "error" in data:
            continue
        agents = data if isinstance(data, list) else data.get("data", data.get("agents", []))
        for agent in agents:
            name = agent.get("name", agent.get("id", "?"))
            desc = agent.get("description", agent.get("bio", "")) or ""
            price_model = agent.get("price_model", agent.get("pricing", "")) or ""
            url_agent = agent.get("url", agent.get("profile_url", ""))
            text = f"{name} {desc} {price_model}"
            score = score_lead(name, desc, url_agent)
            if score < 3:
                continue  # skip low-relevance
            lead = {
                "source": "directory",
                "label": url.split("/")[2],
                "title": name[:200],
                "url": url_agent,
                "description": desc[:200],
                "price_model": price_model[:100],
                "score": score,
                "matched_signatures": [
                    p for p in BUYER_SIGNATURES
                    if re.search(p, f"{name} {desc} {price_model}", re.IGNORECASE)
                ][:3],
            }
            leads.append(lead)
    return leads


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Buyer pattern miner: scan sources for buyer-intent leads")
    ap.add_argument("--save", action="store_true", help="Save leads to JSON file")
    ap.add_argument("--min-score", type=int, default=3, help="Minimum score threshold (default: 3)")
    ap.add_argument("--json", action="store_true", help="Output raw JSON")
    a = ap.parse_args()

    print(f"=== Buyer Pattern Miner @ {datetime.utcnow().isoformat()}Z ===\n")

    # Scan GitHub
    print("Scanning GitHub issues...")
    gh_leads = scan_github()
    print(f"  Found {len(gh_leads)} GitHub leads")

    # Scan directories
    print("Scanning agent directories...")
    dir_leads = scan_directories()
    print(f"  Found {len(dir_leads)} directory leads")

    all_leads = sorted(gh_leads + dir_leads, key=lambda x: x["score"], reverse=True)
    filtered = [l for l in all_leads if l["score"] >= a.min_score]

    if a.json:
        print(json.dumps(filtered, indent=2))
        return 0

    print(f"\n=== Results (score >= {a.min_score}) ===")
    if not filtered:
        print("No high-scoring leads found.")
        return 0

    for lead in filtered:
        sigs = ", ".join(lead["matched_signatures"][:2]) if lead["matched_signatures"] else "none"
        print(f"  [{lead['source']}] Score {lead['score']}: {lead['title'][:70]}")
        print(f"      URL: {lead['url'][:80]}")
        print(f"      Signatures: {sigs}")

    print(f"\n--- {len(filtered)} leads above threshold ---")
    print("Tip: For each lead, match to a buyer template and tailor the ask.")

    if a.save:
        with open(LEADS_FILE, "w") as f:
            json.dump(filtered, f, indent=2)
        print(f"Saved to {LEADS_FILE}")

    return 0


if __name__ == "__main__":
    sys.exit(main())