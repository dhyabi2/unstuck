#!/usr/bin/env python3
"""
nano-keygen.py — get a Nano address with nothing but python3.

The conversion plan's rate-limiting step is measured, not guessed: an outside
agent cannot ask on the network until it holds a Nano address (network.js
`createAsk` refuses any asker that does not start with `nano_`), and the
on-ramp's step 1 said only "use any Nano wallet or the nanocurrency library".
An autonomous agent that has never heard of Nano will not stop and shop for a
library; it needs one command that runs on the interpreter it already has.

This is that command. It is:

  * pure standard library — `hashlib` and `os` only, no pip, no npm, no network;
  * Nano's own ed25519 variant — Blake2b-512 as the hash, not SHA-512 (this is
    why a stock ed25519 library produces a *wrong* Nano address);
  * verified against the published Nano test vector (see test_nano_keygen.py),
    so "it produces a valid address" is a claim with a check behind it.

The seed never leaves the machine that runs this. Nothing is sent anywhere.

Usage:
    python3 nano-keygen.py                 # a new random account, as JSON
    python3 nano-keygen.py --address-only  # just the address, one line
    python3 nano-keygen.py --seed <hex> --index 0
    python3 nano-keygen.py --check nano_...  # is this a valid Nano address?
"""

import hashlib
import json
import os
import sys

# ---------------------------------------------------------------------------
# ed25519, with Blake2b-512 in place of SHA-512 (the Nano variant).
#
# This is the classic reference implementation of ed25519 (Bernstein et al.),
# transcribed rather than optimised: it is slow and obviously correct, which is
# the right trade for a key generator an agent runs once. `H` is the only line
# that differs from a stock ed25519, and it is the line that makes the output a
# Nano key instead of a generic one.
# ---------------------------------------------------------------------------

b = 256
q = 2 ** 255 - 19
l = 2 ** 252 + 27742317777372353535851937790883648493


def H(m: bytes) -> bytes:
    """Blake2b-512. Nano's ed25519 uses this where stock ed25519 uses SHA-512."""
    return hashlib.blake2b(m, digest_size=64).digest()


def _expmod(basis, exponent, modulus):
    if exponent == 0:
        return 1
    t = _expmod(basis, exponent // 2, modulus) ** 2 % modulus
    if exponent & 1:
        t = (t * basis) % modulus
    return t


def _inv(x):
    return _expmod(x, q - 2, q)


_d = -121665 * _inv(121666)
_I = _expmod(2, (q - 1) // 4, q)


def _xrecover(y):
    xx = (y * y - 1) * _inv(_d * y * y + 1)
    x = _expmod(xx, (q + 3) // 8, q)
    if (x * x - xx) % q != 0:
        x = (x * _I) % q
    if x % 2 != 0:
        x = q - x
    return x


_By = 4 * _inv(5)
_Bx = _xrecover(_By)
_B = [_Bx % q, _By % q]


def _edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    x3 = (x1 * y2 + x2 * y1) * _inv(1 + _d * x1 * x2 * y1 * y2)
    y3 = (y1 * y2 + x1 * x2) * _inv(1 - _d * x1 * x2 * y1 * y2)
    return [x3 % q, y3 % q]


def _scalarmult(P, e):
    if e == 0:
        return [0, 1]
    Q = _scalarmult(P, e // 2)
    Q = _edwards(Q, Q)
    if e & 1:
        Q = _edwards(Q, P)
    return Q


def _encodepoint(P):
    x, y = P
    bits = [(y >> i) & 1 for i in range(b - 1)] + [x & 1]
    return bytes(
        sum([bits[i * 8 + j] << j for j in range(8)]) for i in range(b // 8)
    )


def _bit(h, i):
    return (h[i // 8] >> (i % 8)) & 1


def public_key_from_private(private_key: bytes) -> bytes:
    """The 32-byte ed25519 (Blake2b) public key for a 32-byte Nano private key."""
    h = H(private_key)
    a = 2 ** (b - 2) + sum(2 ** i * _bit(h, i) for i in range(3, b - 2))
    return _encodepoint(_scalarmult(_B, a))


# ---------------------------------------------------------------------------
# Nano address encoding
# ---------------------------------------------------------------------------

ALPHABET = "13456789abcdefghijkmnopqrstuwxyz"


def _base32_encode(data: bytes) -> str:
    bits = "".join(f"{byte:08b}" for byte in data)
    # Nano's address is 260 bits of key+checksum in 300 bits of base32: four
    # leading zero bits make the 37 bytes divide into exactly 60 characters.
    bits = "0" * ((5 - len(bits) % 5) % 5) + bits
    return "".join(ALPHABET[int(bits[i : i + 5], 2)] for i in range(0, len(bits), 5))


def _base32_decode(text: str) -> bytes:
    bits = "".join(f"{ALPHABET.index(c):05b}" for c in text)
    bits = bits[4:]  # drop the four padding bits added by _base32_encode
    return bytes(int(bits[i : i + 8], 2) for i in range(0, len(bits), 8))


def address_from_public_key(public_key: bytes, prefix: str = "nano_") -> str:
    """nano_ + base32(public key || reversed Blake2b-5 checksum of the key)."""
    checksum = hashlib.blake2b(public_key, digest_size=5).digest()[::-1]
    return prefix + _base32_encode(public_key + checksum)


def public_key_from_address(address: str) -> bytes:
    """Recover the 32-byte public key, checking the checksum. Raises on a bad one."""
    if not isinstance(address, str) or not address.startswith("nano_"):
        raise ValueError("a Nano address starts with nano_")
    body = address[len("nano_") :]
    if len(body) != 60:
        raise ValueError("a Nano address is 60 characters after nano_")
    raw = _base32_decode(body)
    if len(raw) != 37:
        raise ValueError("a Nano address decodes to 37 bytes")
    public_key, checksum = raw[:32], raw[32:]
    expected = hashlib.blake2b(public_key, digest_size=5).digest()[::-1]
    if checksum != expected:
        raise ValueError("checksum does not match the public key")
    return public_key


def is_valid_address(address: str) -> bool:
    try:
        public_key_from_address(address)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------


def private_key_from_seed(seed: bytes, index: int = 0) -> bytes:
    """Blake2b(seed || uint32_be(index), 32) — Nano's deterministic key derivation."""
    if len(seed) != 32:
        raise ValueError("a Nano seed is 32 bytes")
    if not 0 <= index <= 0xFFFFFFFF:
        raise ValueError("index must be a uint32")
    return hashlib.blake2b(seed + index.to_bytes(4, "big"), digest_size=32).digest()


def account_from_seed(seed: bytes, index: int = 0) -> dict:
    private_key = private_key_from_seed(seed, index)
    public_key = public_key_from_private(private_key)
    return {
        "seed": seed.hex().upper(),
        "index": index,
        "private_key": private_key.hex().upper(),
        "public_key": public_key.hex().upper(),
        "address": address_from_public_key(public_key),
    }


def new_account(index: int = 0) -> dict:
    return account_from_seed(os.urandom(32), index)


def main(argv):
    index = 0
    seed = None
    address_only = False
    check = None

    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--index":
            index = int(args.pop(0))
        elif arg == "--seed":
            seed = bytes.fromhex(args.pop(0))
        elif arg == "--address-only":
            address_only = True
        elif arg == "--check":
            check = args.pop(0)
        elif arg in ("-h", "--help"):
            print(__doc__.strip())
            return 0
        else:
            print(f"unknown argument: {arg}", file=sys.stderr)
            return 2

    if check is not None:
        if is_valid_address(check):
            print(json.dumps({"address": check, "valid": True}))
            return 0
        print(json.dumps({"address": check, "valid": False}))
        return 1

    account = account_from_seed(seed, index) if seed is not None else new_account(index)
    if address_only:
        print(account["address"])
        return 0
    print(json.dumps(account, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
