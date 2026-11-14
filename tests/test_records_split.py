"""Records en un match et sur une saison : classement, ex aequo, entrée dans le top 10 historique."""

import unittest
from unittest import mock

from parquet import history, records_data


def row(pid, name, tid, gid, pts=10, reb=5, ast=3, stl=1, blk=0, fg3m=1, date="2026-11-10", matchup="MIA vs. WAS", wl="W"):
    return {"PLAYER_ID": pid, "PLAYER_NAME": name, "TEAM_ID": tid, "TEAM_ABBREVIATION": "MIA", "GAME_ID": gid, "GAME_DATE": date,
            "MATCHUP": matchup, "WL": wl, "PTS": pts, "REB": reb, "AST": ast, "STL": stl, "BLK": blk, "FG3M": fg3m}


class SplitRecordsTests(unittest.TestCase):
    def setUp(self):
        rows = [
            row(1, "Ana Star", 10, "g1", pts=80, date="2026-11-08"),
            row(1, "Ana Star", 10, "g2", pts=30),
            row(2, "Bo Bench", 10, "g1", pts=12, fg3m=6),
            row(3, "Cy Guard", 20, "g3", pts=30, matchup="NYK @ BOS", wl="L"),
        ]
        self.patches = [
            mock.patch.object(history, "_season_game_log", return_value=(rows, "2026-27", {})),
            mock.patch.object(history, "_resolver", return_value=lambda name, year: None),
            mock.patch.object(history.nba, "current_season", return_value="2026-27"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_game_records(self):
        data, _ = history.records_game()
        self.assertTrue(data["live"])
        pts = next(b for b in data["boards"] if b["key"] == "PTS")
        self.assertEqual(pts["allTime"][0]["value"], 100)
        self.assertEqual(pts["allTime"][0]["name"], "Wilt Chamberlain")
        best = pts["current"][0]
        self.assertEqual((best["value"], best["name"], best["opp"], best["home"]), (80, "Ana Star", "WAS", True))
        # 80 points : 4e de l'histoire (derrière 100, 83 et 81).
        self.assertTrue(best["historic"])
        self.assertEqual(best["historicRank"], 4)
        # Deux matchs à 30 points : même rang.
        thirty = [c for c in pts["current"] if c["value"] == 30]
        self.assertEqual({c["rank"] for c in thirty}, {2})
        self.assertFalse(thirty[0]["historic"])
        away = next(c for c in thirty if c["name"] == "Cy Guard")
        self.assertEqual((away["opp"], away["home"]), ("BOS", False))

    def test_season_records_need_enough_games(self):
        data, _ = history.records_season()
        pts = next(b for b in data["boards"] if b["key"] == "PTS")
        names = [c["name"] for c in pts["current"]]
        # Bo Bench n'a joué qu'un des deux matchs de son équipe (moins de 70 %) : pas classé en moyenne.
        self.assertNotIn("Bo Bench", names)
        self.assertEqual(pts["current"][0]["value"], 55.0)
        # Les paniers à 3 points sont un total : tout le monde est classé.
        threes = next(b for b in data["boards"] if b["key"] == "FG3M")
        self.assertFalse(threes["perGame"])
        self.assertEqual(threes["current"][0]["name"], "Bo Bench")
        self.assertEqual(threes["allTime"][0]["value"], 402)

    def test_reference_lists_are_sorted(self):
        for table in (records_data.GAME, records_data.SEASON):
            for key, rows in table.items():
                values = [r[0] for r in rows]
                self.assertEqual(values, sorted(values, reverse=True), key)
                self.assertGreaterEqual(len(rows), 10, key)


if __name__ == "__main__":
    unittest.main()
