#!/usr/bin/env python3
"""Laws for swarm_board.py — the swarm's public Kanban, from an agent's own hands.

Run offline: every board call is faked, so the tests never touch the live board.

  python3 test_swarm_board.py

The one that matters (owner #286): `swarm-board move <id> --column "In review (PR open)" --note <PR url>` on a card
that is ALREADY in that column must still write the note. Before this fix the unchanged branch returned before the
comment call, so the exact command the owner's issue shows silently dropped the link the card exists to carry.
"""
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swarm_board as B  # noqa: E402


BUCKETS = {"Backlog": 1, "Building": 2, "In review (PR open)": 3, "Merged / live": 4, "Blocked": 5}


def task(tid, title, agent, bucket_id):
    return {"id": tid, "title": title, "description": f"agent: {agent}\n\nwhy it matters", "bucket_id": bucket_id}


class FakeBoard(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.tasks = [
            (task(15, "Zero-bounty ask resolution fix (#274)", "harbor", BUCKETS["In review (PR open)"]),
             "In review (PR open)"),
            (task(13, "Telnyx: a Nano accept leg", "harbor", BUCKETS["Blocked"]), "Blocked"),
        ]
        self._call, self._project, self._cards = B.call, B.project, B.cards
        B.project = lambda: (7, 70, dict(BUCKETS))
        B.cards = lambda pid, vid: list(self.tasks)

        def fake_call(path, method="GET", body=None):
            self.calls.append((method, path, body))
            if method == "PUT" and path == "/projects/7/tasks":
                return {"id": 99, "title": body["title"], "description": body["description"], "bucket_id": None}
            return None
        B.call = fake_call

    def tearDown(self):
        B.call, B.project, B.cards = self._call, self._project, self._cards

    def run_main(self, argv):
        out = io.StringIO()
        with redirect_stdout(out):
            rc = B.main(argv)
        return rc, out.getvalue()

    def comments(self):
        return [c for c in self.calls if c[1].endswith("/comments")]

    def placements(self):
        return [c for c in self.calls if "/buckets/" in c[1]]

    # --- the law: a note lands even when the column does not change ---------
    def test_note_written_when_column_unchanged(self):
        rc, out = self.run_main(["move", "15", "--column", "In review (PR open)", "--note", "PR #274 open"])
        self.assertEqual(rc, 0)
        self.assertEqual(self.placements(), [], "must not re-place a card already in the column")
        notes = self.comments()
        self.assertEqual(len(notes), 1, "the note must be written even when the column is unchanged")
        self.assertIn("PR #274 open", notes[0][2]["comment"])
        data = json.loads(out.strip())
        self.assertTrue(data["unchanged"])
        self.assertTrue(data["noted"])

    def test_same_column_without_note_writes_nothing(self):
        self.run_main(["move", "15", "--column", "In review (PR open)"])
        self.assertEqual(self.comments(), [])
        self.assertEqual(self.placements(), [])

    def test_move_to_new_column_places_and_notes(self):
        rc, out = self.run_main(["move", "15", "--column", "Merged / live", "--note", "merged upstream"])
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.placements()), 1)
        self.assertIn(str(BUCKETS["Merged / live"]), self.placements()[0][1])
        self.assertEqual(len(self.comments()), 1)
        data = json.loads(out.strip())
        self.assertEqual(data["to"], "Merged / live")
        self.assertFalse(data["unchanged"])

    def test_move_never_sends_an_undocumented_body_to_the_board(self):
        # the old code posted {"id":..,"done":true} to /tasks/<id> on a move to Merged/live: a body nobody can
        # check against the board API, carrying a field it never documents. A board move must change the column
        # and nothing else (2026-09-23).
        self.run_main(["move", "15", "--column", "Merged / live", "--note", "merged"])
        bodies = [c for c in self.calls if c[0] == "POST" and c[1].rstrip("/").endswith("/tasks/15")]
        self.assertEqual(bodies, [], "a move writes no undocumented /tasks body")
        self.assertEqual([c[1] for c in self.calls if c[0] == "PUT" and "comments" in c[1]],
                         ["/tasks/15/comments"])

    def test_unknown_column_refused(self):
        with self.assertRaises(B.Refused):
            self.run_main(["move", "15", "--column", "Done"])

    def test_unknown_card_refused(self):
        with self.assertRaises(B.Refused):
            self.run_main(["move", "9999", "--column", "Backlog"])

    # --- add -----------------------------------------------------------------
    def test_add_places_card_in_requested_column(self):
        rc, out = self.run_main(["add", "A card someone could act on", "--for", "harbor",
                                 "--why", "because it matters in their terms",
                                 "--column", "Building", "--source", "https://example.test"])
        self.assertEqual(rc, 0)
        data = json.loads(out.strip())
        self.assertEqual(data["card"], 99)
        self.assertEqual(data["column"], "Building")
        self.assertEqual(len(self.placements()), 1)
        self.assertIn(str(BUCKETS["Building"]), self.placements()[0][1])
        put = [c for c in self.calls if c[0] == "PUT" and c[1] == "/projects/7/tasks"][0]
        self.assertIn("agent: harbor", put[2]["description"])
        self.assertIn("https://example.test", put[2]["description"])

    def test_add_refuses_title_nobody_can_act_on(self):
        with self.assertRaises(B.Refused):
            self.run_main(["add", "short", "--for", "harbor", "--why", "x"])

    def test_add_refuses_unowned_card(self):
        with self.assertRaises(B.Refused):
            self.run_main(["add", "A card someone could act on", "--why", "x"])

    def test_add_refuses_card_without_a_reason(self):
        with self.assertRaises(B.Refused):
            self.run_main(["add", "A card someone could act on", "--for", "harbor"])

    def test_add_refuses_duplicate_title(self):
        with self.assertRaises(B.Refused):
            self.run_main(["add", "Telnyx: a Nano accept leg", "--for", "harbor", "--why", "x"])

    # --- pure helpers --------------------------------------------------------
    def test_who_reads_the_agent_line(self):
        self.assertEqual(B.who(task(1, "t", "harbor", 1)), "harbor")
        self.assertEqual(B.who({"description": "no owner here"}), "")

    def test_cards_reads_bucket_shape_not_flat_list(self):
        # a kanban view answers with buckets carrying their tasks - reading it flat hid every card once
        saved = B.call
        B.call = lambda path, method="GET", body=None: (
            [{"title": "Building", "tasks": [task(14, "x", "harbor", 2)]}]
            if "tasks" in path else [])
        try:
            got = self._cards(7, 70)
        finally:
            B.call = saved
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0][1], "Building")

    def test_columns_are_the_five_the_owner_named(self):
        self.assertEqual(B.COLUMNS,
                         ["Backlog", "Building", "In review (PR open)", "Merged / live", "Blocked"])


if __name__ == "__main__":
    unittest.main(verbosity=2)