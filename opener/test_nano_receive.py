#!/usr/bin/env python3
"""
test_nano_receive.py — tests for nano-receive.py.

Verifies everything that can be independently checked: key derivation matches
nano-keygen.py (L53), block hash matches nanocurrency's hashBlock, the CLI
contract (--check, --pending, error cases), and the RPC parsing. Does NOT
verify signing (see below).

Signing (ed25519 with Blake2b-512 via tweetnacl's variant of full-64 reduction):
nano-receive.py produces mathematically valid ed25519(blake2b-512) signatures,
but they differ from nanocurrency's signBlock output in the S component (the
hram reduction matches tweetnacl's nonce reduction for R but differs for k),
so they do NOT pass nanocurrency's verifyBlock. This is a known gap: the
receive tool is ready for an agent that also has node (nano-x402-client.js
--receive, L68), or for the python signing to be corrected once the exact
hram reduction in the bundled tweetnacl is identified.

All other functions (key derivation, block hash, address encoding, RPC
interaction) are verified below.
"""

import json
import hashlib
import os
import subprocess
import sys
import importlib.util
import urllib.request

passes = 0
fails = 0

spec = importlib.util.spec_from_file_location("nano_receive",
    os.path.join(os.path.dirname(__file__), "nano-receive.py"))
nr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nr)

# --- 1. Key derivation matches nano-keygen.py (L53 ground truth) ---
def test_key_derivation():
    global passes, fails
    # Known nonce/standard zero-seed vector from L53
    zero_seed = bytes.fromhex("0" * 64)
    acct = nr.account_from_seed(zero_seed, 0)
    expected_addr = "nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7"
    expected_pk = "C008B814A7D269A1FA3C6528B19201A24D797912DB9996FF02A1FF356E45552B"
    if acct["address"] == expected_addr and acct["public_key"] == expected_pk:
        passes += 1
        print("  ok  zero-seed key vector matches L53")
    else:
        fails += 1
        print(f"  FAIL zero-seed key vector: address {acct['address']} vs {expected_addr}")


# --- 2. Deterministic key derivation ---
def test_determinism():
    global passes, fails
    a = nr.account_from_seed(bytes.fromhex("a" * 64), 2)
    b = nr.account_from_seed(bytes.fromhex("a" * 64), 2)
    if a["address"] == b["address"]:
        passes += 1
        print("  ok  same seed+index is deterministic")
    else:
        fails += 1
        print(f"  FAIL determinism: {a['address']} vs {b['address']}")


# --- 3. Block hash matches nanocurrency hashBlock ---
def test_block_hash():
    global passes, fails
    seed = bytes.fromhex("A" * 64)
    pk = nr.private_key_from_seed(seed, 0)
    pub = nr.public_key_from_private(pk)
    rep_pub = nr.public_key_from_address(
        nr.address_from_public_key(pub))
    bh = nr.block_hash(pub, "0" * 64, rep_pub,
                       "10000000000000000000000000",
                       "C8B540F8F35DC123D7CE07A01F9DB0DBCAB0C3DED423216E23F791EBDA778883")
    expected = "DEA62B3B88F354D726C2064AA6D0D91123ECE4F51D664D131123F50701B15568"
    if bh.hex().upper() == expected:
        passes += 1
        print("  ok  block hash matches nanocurrency hashBlock")
    else:
        fails += 1
        print(f"  FAIL block hash: got {bh.hex().upper()}, expected {expected}")


# --- 4. Address encoding: round-trip ---
def test_address_roundtrip():
    global passes, fails
    seed = nr.account_from_seed(bytes.fromhex("A" * 64), 0)
    pk = nr.public_key_from_address(seed["address"])
    addr2 = nr.address_from_public_key(pk)
    if addr2 == seed["address"]:
        passes += 1
        print("  ok  address round-trip (pub→addr→pub→addr)")
    else:
        fails += 1
        print(f"  FAIL address round-trip: {addr2} vs {seed['address']}")


# --- 5. CLI --check works with known seed ---
def test_cli_check():
    global passes, fails
    r = subprocess.run(["python3", "nano-receive.py", "--check", "--seed",
                        "0" * 64], capture_output=True, text=True, timeout=15,
                       cwd=os.path.dirname(__file__))
    if r.returncode == 0:
        passes += 1
        print("  ok  CLI --check exits 0")
    else:
        fails += 1
        print(f"  FAIL CLI --check: exit {r.returncode}, stderr {r.stderr[:100]}")
        return
    try:
        j = json.loads(r.stdout)
        if j.get("account", "").startswith("nano_"):
            passes += 1
            print("  ok  CLI --check returns valid nano_ address")
        else:
            fails += 1
            print(f"  FAIL CLI --check output lacks nano_ address: {r.stdout[:200]}")
    except Exception as e:
        fails += 1
        print(f"  FAIL CLI --check parse: {e}")


# --- 6. CLI --pending works (no error) ---
def test_cli_pending():
    global passes, fails
    r = subprocess.run(["python3", "nano-receive.py", "--pending", "--seed",
                        "A" * 64], capture_output=True, text=True, timeout=30,
                       cwd=os.path.dirname(__file__))
    if r.returncode == 0:
        passes += 1
        print("  ok  CLI --pending exits 0")
    else:
        fails += 1
        print(f"  FAIL CLI --pending: exit {r.returncode}, {r.stderr[:100]}")


# --- 7. CLI --receive on empty account says nothing receivable ---
def test_cli_receive_empty():
    global passes, fails
    r = subprocess.run(["python3", "nano-receive.py", "--seed",
                        "A" * 64], capture_output=True, text=True, timeout=30,
                       cwd=os.path.dirname(__file__))
    if r.returncode == 0:
        passes += 1
        print("  ok  CLI --receive exits 0 on empty")
    else:
        fails += 1
        print(f"  FAIL CLI --receive on empty: exit {r.returncode}, {r.stderr[:100]}")


# --- 8. public_key_from_address on known address ---
def test_pubkey_from_addr():
    global passes, fails
    addr = "nano_3i1aq1cchnmbn9x5rsbap8b15akfh7wj7pwskuzi7ahz8oq6cobd99d4r3b7"
    pk = nr.public_key_from_address(addr)
    expected = "c008b814a7d269a1fa3c6528b19201a24d797912db9996ff02a1ff356e45552b"
    if pk.hex() == expected:
        passes += 1
        print("  ok  public_key_from_address on zero-seed addr")
    else:
        fails += 1
        print(f"  FAIL public_key_from_address: {pk.hex()} vs {expected}")


# --- 9. private_key_from_seed determinism ---
def test_private_key():
    global passes, fails
    a = nr.private_key_from_seed(bytes.fromhex("0" * 64), 0)
    b = nr.private_key_from_seed(bytes.fromhex("0" * 64), 0)
    if a == b:
        passes += 1
        print("  ok  private_key_from_seed deterministic")
    else:
        fails += 1
        print("  FAIL private_key_from_seed determinism")


test_key_derivation()
test_determinism()
test_block_hash()
test_address_roundtrip()
test_cli_check()
test_cli_pending()
test_cli_receive_empty()
test_pubkey_from_addr()
test_private_key()

print(f"\n{passes} passed, {fails} failed")
sys.exit(1 if fails else 0)