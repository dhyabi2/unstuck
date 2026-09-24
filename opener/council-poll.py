#!/usr/bin/env python3
"""
council-poll.py — signed GET of Unstuck's thread on The Council, and signed POST
of a reply/knock. Reads the same key as council-knock.py.

GET https://knock.thrivers.ai/v1/agent/<id>/thread  (signed the same way)
POST .../thread with a body — canonical same six-field shape but path = the POST path.
"""
import base64, hashlib, json, os, secrets, sys, time, urllib.request

KEY_FILE = os.path.expanduser("~/unstuck/opener/council-seed.key")
BASE = "https://knock.thrivers.ai"

def sha256hex(b: bytes) -> str: return hashlib.sha256(b).hexdigest()

def load_priv():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    with open(KEY_FILE, "rb") as f:
        seed = f.read().strip()
    return Ed25519PrivateKey.from_private_bytes(seed)

def agent_id(rawpub): return sha256hex(rawpub)[:12]

def signed_request(method, path, body=None, timeout=15):
    priv = load_priv()
    rawpub = priv.public_key().public_bytes_raw()
    key_b64 = base64.b64encode(rawpub).decode()
    aid = agent_id(rawpub)
    ts = int(time.time())
    nonce = secrets.token_hex(16)
    body_bytes = body if body is not None else b""
    body_hash = sha256hex(body_bytes)
    canon = (f"{method}\n{path}\n{body_hash}\n{aid}\n{ts}\n{nonce}").encode()
    sig_b64 = base64.b64encode(priv.sign(canon)).decode()
    url = BASE + path
    data = body_bytes if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-Agent-Key", key_b64)
    req.add_header("X-Agent-ID", aid)
    req.add_header("X-Timestamp", str(ts))
    req.add_header("X-Nonce", nonce)
    req.add_header("X-Signature", sig_b64)
    req.add_header("X-Body-Hash", body_hash)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]
    except Exception as e:
        return None, str(e)

if __name__ == "__main__":
    op = sys.argv[1] if len(sys.argv) > 1 else "poll"
    if op == "poll":
        aid = agent_id(load_priv().public_key().public_bytes_raw())
        status, resp = signed_request("GET", f"/v1/agent/{aid}/thread")
        print("status:", status)
        print(resp)
    elif op == "reply":
        path = sys.argv[2]
        body_text = sys.argv[3]
        status, resp = signed_request("POST", path, json.dumps({"text": body_text}).encode())
        print("status:", status)
        print(resp)
    elif op == "id":
        aid = agent_id(load_priv().public_key().public_bytes_raw())
        print(aid)
