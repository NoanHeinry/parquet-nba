"""Actualité d'un joueur : faits récents calculés à partir de ses matchs et de sa carrière."""

import unittest
from datetime import date

from parquet import player_news as pn


def game(day, gid, pts=10, reb=5, ast=3, stl=1, blk=0, tpm=1, home=True, opp="PHX"):
    return {"date": day, "gameId": gid, "pts": pts, "reb": reb, "ast": ast, "stl": stl, "blk": blk, "tpm": tpm, "home": home, "opp": opp}


def team_game(day, gid):
    return {"id": gid, "etDate": day, "status": 3}


class GameFactsTests(unittest.TestCase):
    def setUp(self):
        # Du plus récent au plus ancien, comme dans l'application.
        self.games = [
            game("2026-11-10", "g8", pts=34),
            game("2026-11-08", "g7", pts=31),
            game("2026-11-06", "g6", pts=52, opp="LAL"),
            game("2026-11-04", "g5", pts=29, reb=12, ast=10),
            game("2026-10-20", "g4", pts=18),
            game("2026-10-18", "g3", pts=22),
            game("2026-10-15", "g2", pts=15),
        ]
        self.since = date(2026, 10, 25)

    def test_season_high_triple_double_and_streak(self):
        items = pn.game_items(self.games, True, self.since)
        titles = [i["title"] for i in items]
        self.assertIn("Record de la saison : 52 points", titles)
        self.assertIn("Triple-double", titles)
        self.assertIn("3 matchs de suite à 30 points ou plus", titles)
        record = next(i for i in items if i["kind"] == "season-high" and "points" in i["title"])
        self.assertEqual(record["gameId"], "g6")
        self.assertIn("contre LAL", record["text"])
        # Pas de « gros match » en double avec le record du même match.
        self.assertFalse(any(i["kind"] == "big-game" and i["gameId"] == "g6" for i in items))

    def test_old_records_are_not_news(self):
        items = pn.game_items(self.games, True, date(2026, 11, 12))
        self.assertFalse([i for i in items if i["kind"] == "season-high"])

    def test_absence_and_return(self):
        played = [game("2026-11-10", "t5"), game("2026-11-01", "t1")]
        team = [team_game(d, i) for d, i in (("2026-11-10", "t5"), ("2026-11-08", "t4"), ("2026-11-06", "t3"), ("2026-11-03", "t2"), ("2026-11-01", "t1"))]
        items = pn.absence_items(played, team)
        self.assertEqual(items[0]["kind"], "return")
        self.assertIn("3 matchs d'absence", items[0]["title"])
        # Toujours absent : les deux derniers matchs manqués.
        items = pn.absence_items([game("2026-11-06", "t3")], team)
        self.assertEqual(items[0]["kind"], "absence")
        self.assertIn("des 2 derniers matchs", items[0]["title"])
        self.assertEqual(pn.absence_items([game("2026-11-10", "t5")], team[:1]), [])

    def test_career_milestone_crossed_recently(self):
        games = [game("2026-11-10", "m2", pts=30), game("2026-11-08", "m1", pts=25)]
        items = pn.milestone_items({"pts": 10010, "reb": 3050, "ast": 1550}, games, date(2026, 10, 20))
        self.assertEqual(len(items), 1)
        self.assertIn("10 000 points en carrière", items[0]["title"])
        self.assertEqual(items[0]["gameId"], "m2")

    def test_career_high_only_when_recent(self):
        highs = [
            {"stat": "PTS", "value": 52, "date": "2026-11-06", "gameId": "g6", "vsTri": "LAL"},
            {"stat": "REB", "value": 20, "date": "2024-01-02", "gameId": "old", "vsTri": "BOS"},
        ]
        items = pn.career_high_items(highs, date(2026, 10, 20))
        self.assertEqual([i["title"] for i in items], ["Record en carrière : 52 points"])

    def test_award_dates(self):
        self.assertEqual(pn._award_day({"week": "2026-11-09T00:00:00"}), date(2026, 11, 9))
        self.assertEqual(pn._award_day({"week": "20261109"}), date(2026, 11, 9))
        self.assertEqual(pn._award_day({"month": "11/1/2026 12:00:00 AM"}), date(2026, 11, 1))
        self.assertIsNone(pn._award_day({"week": "", "month": ""}))


if __name__ == "__main__":
    unittest.main()
