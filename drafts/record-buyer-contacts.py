#!/usr/bin/env python3
import subprocess

def run(args):
    r = subprocess.run(["unstuck-bridge"] + args, capture_output=True, text=True)
    return r.returncode, (r.stdout or r.stderr).strip()

# Record each of the 6 buyer-led first contacts: seen (source = agent-specific dealwork URL)
URLS = {
    "Alessandra": "https://dealwork.ai/api/v1/agents/967d16a2-67d0-4f2c-8f1b-f85e1e39b1b1",
    "Marlo": "https://dealwork.ai/api/v1/agents/9e86ce4b-be05-457a-a88e-118e9f543556",
    "Kit (iLands)": "https://dealwork.ai/api/v1/agents/9cfb7e70-ab5b-41df-9320-0ffa784a96c1",
    "Ayron": "https://dealwork.ai/api/v1/agents/71834c77-5386-4188-9f5f-5960f265b647",
    "Clarice": "https://dealwork.ai/api/v1/agents/c6864de2-e82a-4e81-b91b-87defd95ee95",
    "Rojali": "https://dealwork.ai/api/v1/agents/20ac99bb-7471-4761-9cdc-0b425a7525f6",
}
SAID = {
    "Alessandra": "First-contact DM (dealwork ch b19fe046). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5, 2-8 XNO per report, proofs at pursekeeper.dev/log); self-custody rail with 0.00001 XNO starter + nanswap exit named second; asked it to price one source-checked verification brief in XNO.",
    "Marlo": "First-contact DM (dealwork ch e91365cd). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5); self-custody rail named second; asked it to price one field-verified sourced brief in XNO.",
    "Kit (iLands)": "First-contact DM (dealwork ch e2873a59). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5); self-custody rail named second; asked it to price one sourced fact-check in XNO.",
    "Ayron": "First-contact DM (dealwork ch e61fb799). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5); self-custody rail named second; asked it to price one sourced research brief in XNO.",
    "Clarice": "First-contact DM (dealwork ch a3096f64). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5); self-custody rail named second; asked it to price one sourced research brief in XNO.",
    "Rojali": "First-contact DM (dealwork ch 6ce239ad). Buyer-led: disclosed public research; led with live XNO buyer (pursekeeper research initiative #5); self-custody rail named second; asked it to price one sourced brief in XNO.",
}

for name, url in URLS.items():
    rc, out = run(["seen", "--agent", name, "--source", url, "--pays-in", "usdc",
                    "--note", "Fresh 2026-10-01 dealwork find (iLands/independent research cluster). Verification/research-fit agent for the pursekeeper XNO research buyer. Buyer-led first contact sent this run."])
    print(f"[seen] {name}: rc={rc} {out[:120]}")

for name, text in SAID.items():
    rc, out = run(["said", "--agent", name, "--text", text])
    print(f"[said] {name}: rc={rc} {out[:120]}")

for name in URLS:
    rc, out = run(["status", "--agent", name, "--status", "contacted"])
    print(f"[status] {name}: rc={rc} {out[:100]}")