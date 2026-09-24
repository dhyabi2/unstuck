"""Law tests for opener/moltbook-post.py (offline: the network is stubbed, the logic is not)."""
import importlib.util, json, io, sys

spec = importlib.util.spec_from_file_location("mp", "/root/unstuck/opener/moltbook-post.py")
mp = importlib.util.module_from_spec(spec); spec.loader.exec_module(mp)

fails = []
def check(name, cond, why=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else " :: " + why))
    if not cond: fails.append(name)

# L1 find() locates a challenge nested anywhere in the response, which is how the API actually nests it.
resp = {"success": True, "comment": {"id": "c1", "verification": {"verification_code": "moltbook_verify_x", "challenge_text": "A] lO^bSt"}}}
check("L1 find() reads a nested verification_code", mp.find(resp, "verification_code") == "moltbook_verify_x")
check("L1 find() reads a nested id", mp.find(resp, "id") == "c1")
check("L1 find() returns None when absent", mp.find({"a": [1, 2]}, "verification_code") is None)

# L2 a response with no challenge means published: the tool must not invent one.
calls = []
def fake_call(path, method="GET", body=None):
    calls.append((path, method, body))
    if method == "POST":
        return 200, {"success": True, "comment": {"id": "c9"}}
    return 200, {"comments": [{"id": "c9", "verification_status": "verified"}]}
mp.call = fake_call
sys.argv = ["moltbook-post.py", "--post", "P1", "--text", "hello"]
rc = mp.main()
check("L2 no challenge -> exit 0 and a read-back status", rc == 0, f"rc={rc}")
check("L2 read-back used a GET on the post's comments", calls[-1][0] == "/posts/P1/comments?sort=new&limit=50")

# L3 a challenge means NOT published: exit 3 and never claim success.
calls.clear()
def fake_call2(path, method="GET", body=None):
    calls.append((path, method))
    if method == "POST":
        return 200, {"comment": {"id": "c2", "verification": {"verification_code": "moltbook_verify_y", "challenge_text": "how much"}}}
    return 200, {"comments": []}
mp.call = fake_call2
sys.argv = ["moltbook-post.py", "--post", "P2", "--text", "hello"]
buf = io.StringIO()
real, sys.stdout = sys.stdout, buf
try:
    rc = mp.main()
finally:
    sys.stdout = real
out = buf.getvalue()
check("L3 challenge -> exit 3 (not published)", rc == 3, f"rc={rc}")
check("L3 the challenge text is printed for the caller to solve", "how much" in out)
check("L3 the code is printed", "moltbook_verify_y" in out)

# L4 readback reports 'not-listed' rather than pretending, when the comment is absent.
mp.call = lambda path, method="GET", body=None: (200, {"comments": [{"id": "other", "verification_status": "verified"}]})
check("L4 absent comment reads as not-listed, not as verified", mp.readback("P3", "cX") == "not-listed")

# L5 pending is surfaced as pending (this is the exact state that lost the Webboard reply).
mp.call = lambda path, method="GET", body=None: (200, {"comments": [{"id": "cY", "verification_status": "pending"}]})
check("L5 pending is reported as pending", mp.readback("P4", "cY") == "pending")

print(("all %d laws pass" % 5) if not fails else ("FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
