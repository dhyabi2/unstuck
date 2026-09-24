#!/usr/bin/env python3
"""
test_nano_keygen.py — the observable test behind the keygen law.

Two independent checks, because "it produces a valid Nano address" is exactly
the kind of claim that is easy to assert and hard to mean:

  1. The published Nano test vector. seed 0, index 0 is the vector Nano's own
     docs use; the private key, public key and address are fixed, known strings.
     If Nano's ed25519 variant is wrong (SHA-512 instead of Blake2b-512) the
     public key comes out different and this fails.

  2. Cross-check against the `nanocurrency` npm library, which is a second,
     independent implementation. Twenty random seeds are derived here and there
     and every address must agree. A test that only compared the keygen to
     itself would pass even if both copies were wrong.

Run:  python3 opener/test_nano_keygen.py
"""

import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_keygen():
    spec = importlib.util.spec_from_file_location("nano_keygen", os.path.join(HERE, "nano-keygen.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


k = load_keygen()

PASSED = []
FAILED = []


def check(name, condition, detail=""):
    if condition:
        PASSED.append(name)
        print(f"ok   {name}")
    else:
        FAILED.append(name)
        print(f"FAIL {name} {detail}")


# ---------------------------------------------------------------------------
# 1. The published Nano test vector
# ---------------------------------------------------------------------------

ZERO_SEED = "00" * 32
VECTOR_PRIVATE = "9F0E444C69F77A49BD0BE89DB92C38FE713E0963165CCA12FAF5712D7657120F"
VECTOR_PUBLIC = "C008B814A7D269A1FA3C6528B19201A24D797912DB9996FF02A1FF356E45552B"
VECTOR_ADDRESS = "nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7"

vector = k.account_from_seed(bytes.fromhex(ZERO_SEED), 0)
check("vector: private key matches the published vector", vector["private_key"] == VECTOR_PRIVATE, vector["private_key"])
check("vector: public key matches the published vector", vector["public_key"] == VECTOR_PUBLIC, vector["public_key"])
check("vector: address matches the published vector", vector["address"] == VECTOR_ADDRESS, vector["address"])
check("vector: the address is 60 chars after nano_", len(vector["address"]) == 65)

# ---------------------------------------------------------------------------
# 2. Round-trip and rejection
# ---------------------------------------------------------------------------

recovered = k.public_key_from_address(VECTOR_ADDRESS).hex().upper()
check("round-trip: address decodes back to the same public key", recovered == VECTOR_PUBLIC, recovered)

# A single changed character in the checksum region must be rejected.
tampered = VECTOR_ADDRESS[:-1] + ("0" if VECTOR_ADDRESS[-1] != "0" else "1")
check("rejection: a tampered address fails its checksum", not k.is_valid_address(tampered))
check("rejection: a missing prefix is not a Nano address", not k.is_valid_address("xrb_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7"))
check("rejection: an empty string is not a Nano address", not k.is_valid_address(""))
check("acceptance: a freshly generated address validates", k.is_valid_address(k.new_account()["address"]))

# ---------------------------------------------------------------------------
# 3. Determinism and index derivation
# ---------------------------------------------------------------------------

again = k.account_from_seed(bytes.fromhex(ZERO_SEED), 0)
check("determinism: the same seed and index give the same address", again["address"] == VECTOR_ADDRESS)

index1 = k.account_from_seed(bytes.fromhex(ZERO_SEED), 1)
check("derivation: index 1 is a different account from index 0", index1["address"] != VECTOR_ADDRESS)
check("derivation: index 1 is itself a valid address", k.is_valid_address(index1["address"]))

# ---------------------------------------------------------------------------
# 4. Cross-check against the nanocurrency npm library (independent oracle)
# ---------------------------------------------------------------------------

LIB_DIR = HERE
seeds = [os.urandom(32).hex() for _ in range(20)]
seeds.append(ZERO_SEED)

oracle_script = """
const nano = require('nanocurrency');
// Two traps in this library, both measured:
//   * generateSeed() returns a Promise (every other derive* is synchronous).
//   * derivePublicKey(seed, index) does NOT derive the key for that index — it
//     treats the 64-hex argument as a PRIVATE KEY and ignores the index. The
//     internally-consistent path is deriveSecretKey(seed, i) then
//     derivePublicKey(privateKey), which is what the chain agrees with: it
//     reproduces our own treasury address nano_1434j1n4s... exactly.
(async () => {
  const seeds = await Promise.all(Array.from({ length: 20 }, () => nano.generateSeed()));
  seeds.push('0'.repeat(64));
  const out = seeds.map((seed) => {
    const sk = nano.deriveSecretKey(seed, 0);
    const pk = nano.derivePublicKey(sk);
    return { seed: seed.toUpperCase(), index: 0, private_key: sk.toUpperCase(), public_key: pk.toUpperCase(), address: nano.deriveAddress(pk, { useNanoPrefix: true }) };
  });
  process.stdout.write(JSON.stringify(out));
})();
"""

jobs = [{"seed": s.upper(), "index": 0} for s in seeds]
proc = subprocess.run(
    ["node", "-e", oracle_script],
    capture_output=True,
    text=True,
    cwd=LIB_DIR,
)

if proc.returncode != 0:
    print("FAIL the nanocurrency oracle could not run:")
    print(proc.stderr[-2000:])
    FAILED.append("oracle")
else:
    oracle = json.loads(proc.stdout)
    mismatched = []
    for ref in oracle:
        # Compare against the seed the ORACLE actually used, not a Python-side list:
        # the oracle generates its own seeds, so zipping a separately-made list would
        # compare two unrelated accounts and fail for no real reason.
        mine = k.account_from_seed(bytes.fromhex(ref["seed"]), ref["index"])
        if mine["address"] != ref["address"] or mine["public_key"] != ref["public_key"] or mine["private_key"] != ref["private_key"]:
            mismatched.append((ref["seed"], mine["address"], ref["address"]))
    check(
        f"oracle: {len(oracle)} addresses agree with the nanocurrency npm library",
        not mismatched,
        str(mismatched[:3]),
    )

# ---------------------------------------------------------------------------
# 5. The CLI contract an agent actually calls
# ---------------------------------------------------------------------------

cli = subprocess.run(
    [sys.executable, os.path.join(HERE, "nano-keygen.py"), "--address-only"],
    capture_output=True,
    text=True,
)
addr = cli.stdout.strip()
check("cli: --address-only prints exactly one valid address", cli.returncode == 0 and k.is_valid_address(addr), cli.stdout + cli.stderr)

cli_seed = subprocess.run(
    [sys.executable, os.path.join(HERE, "nano-keygen.py"), "--seed", ZERO_SEED, "--index", "0"],
    capture_output=True,
    text=True,
)
doc = json.loads(cli_seed.stdout)
check("cli: --seed reproduces the published vector as JSON", doc["address"] == VECTOR_ADDRESS and doc["private_key"] == VECTOR_PRIVATE)

cli_check = subprocess.run(
    [sys.executable, os.path.join(HERE, "nano-keygen.py"), "--check", VECTOR_ADDRESS],
    capture_output=True,
    text=True,
)
check("cli: --check accepts a valid address", cli_check.returncode == 0 and json.loads(cli_check.stdout)["valid"] is True)

print()
print(f"{len(PASSED)} passed, {len(FAILED)} failed")
sys.exit(1 if FAILED else 0)
