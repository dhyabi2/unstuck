#!/usr/bin/env python3
"""swarm-board: the swarm's Kanban, from an agent's own hands.

  swarm-board show [--agent NAME]                  what is on the board (and whose)
  swarm-board add "TITLE" --for AGENT --why TEXT [--column NAME] [--source URL]
  swarm-board move ID|"TITLE" --column NAME [--note TEXT]
  swarm-board mine                                 the cards that are yours
  swarm-board columns                              the column names

Owner, 2026-09-23: a Kanban "where agents and I can see", cards hunted out of what agents commit to in meetings,
"and the agents also need to be able to update the kanban items status". The board is PUBLIC to read with no
sign-in; only an agent holding the token can change a card, which is why this tool exists and the web form does
not. Every move is journaled, so the map and the Newsletter see the same movement the board does.

The token is the swarm's, not yours: `~/.hermes/board.token` inside a member, the lead's
`/root/.<swarm>-swarm/board.token` otherwise. A card carries `agent: <name>` in its description, so the board can
be read per agent without thirteen accounts.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = os.environ.get("BOARD_API", "http://127.0.0.1:3456/api/v1")
ME = (os.environ.get("RAI_SWARM_MEMBER") or os.environ.get("UNSTUCK_MEMBER")
      or os.environ.get("VEND_MEMBER") or os.environ.get("SWARM_LEAD") or "")
SWARM = os.environ.get("RAI_SWARM_NAME") or os.environ.get("SWARM_NAME") or ""
COLUMNS = ["Backlog", "Building", "In review (PR open)", "Merged / live", "Blocked"]


class Refused(Exception):
    pass


def token():
    for p in (os.path.expanduser("~/.hermes/board.token"),
              f"/root/.{SWARM}-swarm/board.token" if SWARM else ""):
        if p and os.path.exists(p):
            t = open(p, encoding="utf-8").read().strip()
            if t:
                return t
    if os.environ.get("BOARD_TOKEN"):
        return os.environ["BOARD_TOKEN"].strip()
    raise Refused("no board token: expected ~/.hermes/board.token (a member) or the lead's board.token")


def call(path, method="GET", body=None):
    r = urllib.request.Request(API + path, method=method,
                               headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
                               data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            raw = resp.read()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as ex:
        detail = (ex.read() or b"").decode()[:180]
        raise Refused(f"the board answered {ex.code}: {detail}")


def project():
    ps = call("/projects") or []
    p = next((p for p in ps if p.get("title", "").endswith(" swarm")), None)
    if not p:
        raise Refused("no swarm project on this board")
    views = call(f"/projects/{p['id']}/views") or []
    v = next((v for v in views if v.get("view_kind") == "kanban"), None)
    if not v:
        raise Refused("the project has no kanban view")
    buckets = {b["title"]: b["id"] for b in (call(f"/projects/{p['id']}/views/{v['id']}/buckets") or [])}
    return p["id"], v["id"], buckets


def cards(pid, vid):
    """[(task, column name)] - a kanban view answers with its BUCKETS, each carrying its tasks, not a flat list.
    Reading it as a flat list made every card invisible while it sat plainly on the board (2026-09-23)."""
    out = []
    for b in (call(f"/projects/{pid}/views/{vid}/tasks?per_page=250") or []):
        if isinstance(b, dict) and "tasks" in b:
            for t in (b.get("tasks") or []):
                out.append((t, b.get("title", "?")))
        elif isinstance(b, dict):
            out.append((b.get("task", b), "?"))
    return out


def put_in_column(pid, vid, bucket_id, task_id):
    """Move a card. `POST /tasks/{id}/position` sets the order WITHIN a bucket and silently leaves the card where
    it was; the bucket itself changes only through the view's own bucket-tasks route."""
    return call(f"/projects/{pid}/views/{vid}/buckets/{bucket_id}/tasks", "POST", {"task_id": task_id})


def who(task):
    m = re.search(r"(?im)^agent:\s*(\S+)", task.get("description") or "")
    return m.group(1) if m else ""


def bucket_name(buckets, task):
    for name, bid in buckets.items():
        if task.get("bucket_id") == bid:
            return name
    return "?"


def find(tasks, needle):
    """(task, its column) for a card named by id or by part of its title."""
    if str(needle).isdigit():
        hit = next((pair for pair in tasks if str(pair[0]["id"]) == str(needle)), None)
        if hit:
            return hit
    low = str(needle).lower()
    hits = [pair for pair in tasks if low in (pair[0].get("title") or "").lower()]
    if not hits:
        raise Refused(f"no card matches {needle!r} - `swarm-board show` lists them")
    if len(hits) > 1:
        raise Refused("that matches " + str(len(hits)) + " cards: " + ", ".join(f"{p[0]['id']} {p[0]['title'][:40]}" for p in hits[:5]))
    return hits[0]


def journal(kind, data):
    try:
        sys.path.insert(0, "/opt/nano-pulse")
        import journal as J  # noqa: WPS433
        J.append(kind, data)
    except Exception:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser(prog="swarm-board")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("show"); s.add_argument("--agent", default="")
    sub.add_parser("mine"); sub.add_parser("columns")
    a = sub.add_parser("add")
    a.add_argument("title"); a.add_argument("--for", dest="owner", default=""); a.add_argument("--why", default="")
    a.add_argument("--column", default="Backlog"); a.add_argument("--source", default="")
    m = sub.add_parser("move")
    m.add_argument("card"); m.add_argument("--column", required=True); m.add_argument("--note", default="")
    args = ap.parse_args(argv)

    if args.cmd == "columns":
        print("\n".join(COLUMNS)); return 0
    pid, vid, buckets = project()
    ts = cards(pid, vid)

    if args.cmd in ("show", "mine"):
        want = ME if args.cmd == "mine" else getattr(args, "agent", "")
        by = {}
        for t, col in ts:
            if want and who(t) != want:
                continue
            by.setdefault(col, []).append(t)
        for col in COLUMNS:
            items = by.get(col, [])
            print(f"\n{col} ({len(items)})")
            for t in items[:20]:
                print(f"  {t['id']:>4}  {t['title'][:78]}" + (f"   [{who(t)}]" if who(t) else ""))
        print()
        return 0

    if args.cmd == "add":
        if len(args.title.strip()) < 8:
            raise Refused("give the card a title someone else could act on")
        if not args.owner:
            raise Refused("--for NAME: a card nobody owns is a wish, not a task")
        if not args.why:
            raise Refused("--why TEXT: say what it is for, in the target's own terms")
        for t, _col in ts:
            if (t.get("title") or "").strip().lower() == args.title.strip().lower():
                raise Refused(f"card {t['id']} already says that - move it instead of adding a second")
        desc = f"agent: {args.owner}\n\n{args.why}" + (f"\n\n{args.source}" if args.source else "")
        t = call(f"/projects/{pid}/tasks", "PUT", {"title": args.title.strip(), "description": desc})
        col = args.column if args.column in buckets else "Backlog"
        put_in_column(pid, vid, buckets[col], t["id"])
        journal("board", {"event": "card_added", "card": t["id"], "title": args.title[:120],
                          "for": args.owner, "column": col, "by": ME})
        print(json.dumps({"card": t["id"], "column": col, "for": args.owner}))
        return 0

    if args.cmd == "move":
        if args.column not in buckets:
            raise Refused(f"no column {args.column!r}: " + ", ".join(COLUMNS))
        t, was = find(ts, args.card)
        # A note is written even when the card is already in the target column. It used to be dropped silently
        # (the unchanged branch returned before writing it), so "move 15 --column 'In review (PR open)' --note
        # <PR url>" - the exact shape the owner's #286 gives - lost the link the card exists to carry.
        moved = was != args.column
        if moved:
            put_in_column(pid, vid, buckets[args.column], t["id"])
        if args.note:
            call(f"/tasks/{t['id']}/comments", "PUT", {"comment": f"{ME or 'an agent'}: {args.note}"})
        journal("board", {"event": "card_moved", "card": t["id"], "title": (t.get("title") or "")[:120],
                          "from": was, "to": args.column, "note": args.note[:200], "by": ME})
        print(json.dumps({"card": t["id"], "from": was, "to": args.column,
                          "unchanged": not moved, "noted": bool(args.note)}))
        return 0
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as ex:
        print(f"refused: {ex}", file=sys.stderr)
        sys.exit(2)
