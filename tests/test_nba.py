"""Tests de la mise en forme des données NBA (sans accès réseau).

Les échantillons reprennent la structure réelle des flux de NBA.com.
Lancer : python -m unittest discover -s tests
"""

import tempfile
import time
import unittest
from pathlib import Path

from parquet import nba, net, teams_meta
from parquet.cache import Cache

LIVE_GAME = {
    "gameId": "0012600045",
    "gameStatus": 3,
    "gameStatusText": "Final",
    "period": 4,
    "gameClock": "",
    "gameTimeUTC": "2026-10-13T23:00:00Z",
    "gameLabel": "Preseason",
    "seriesText": "",
    "isNeutral": False,
    "homeTeam": {
        "teamId": 1610612753, "teamName": "Magic", "teamCity": "Orlando", "teamTricode": "ORL",
        "wins": 2, "losses": 1, "score": 132, "inBonus": None, "timeoutsRemaining": 1,
        "periods": [{"period": 1, "periodType": "REGULAR", "score": 35}, {"period": 2, "periodType": "REGULAR", "score": 37}],
    },
    "awayTeam": {
        "teamId": 1610612739, "teamName": "Cavaliers", "teamCity": "Cleveland", "teamTricode": "CLE",
        "wins": 1, "losses": 2, "score": 116, "inBonus": None, "timeoutsRemaining": 1, "periods": [],
    },
    "gameLeaders": {
        "homeLeaders": {"personId": 1631094, "name": "Paolo Banchero", "jerseyNum": "5", "position": "F",
                        "teamTricode": "ORL", "points": 24, "rebounds": 8, "assists": 3},
        "awayLeaders": {"personId": 0},
    },
}

SCHEDULE_GAME = {
    "gameId": "0012600048",
    "gameStatus": 3,
    "gameStatusText": "Final",
    "gameDateTimeUTC": "2026-10-14T02:00:00Z",
    "gameTimeUTC": "1900-01-01T02:00:00Z",
    "gameLabel": "Preseason",
    "arenaName": "T-Mobile Arena",
    "arenaCity": "Las Vegas",
    "broadcasters": {"nationalBroadcasters": [{"broadcasterDisplay": "NBA TV"}]},
    "homeTeam": {"teamId": 1610612747, "teamTricode": "LAL", "teamName": "Lakers", "teamCity": "Los Angeles", "score": 89},
    "awayTeam": {"teamId": 1610612744, "teamTricode": "GSW", "teamName": "Warriors", "teamCity": "Golden State", "score": 101},
    "pointsLeaders": [{"personId": 1630559, "firstName": "Austin", "lastName": "Reaves", "teamId": 1610612747,
                       "teamTricode": "LAL", "points": 28}],
}


class FormatTests(unittest.TestCase):
    def test_clock(self):
        self.assertEqual(nba.fmt_clock("PT05M23.00S"), "5:23")
        self.assertEqual(nba.fmt_clock("PT00M23.40S"), "23.4")
        self.assertEqual(nba.fmt_clock(""), "")

    def test_minutes(self):
        self.assertEqual(nba.fmt_minutes("PT21M25.00S"), "21:25")
        self.assertEqual(nba.fmt_minutes("21:25"), "21:25")

    def test_dates(self):
        self.assertEqual(nba._et_date("10/13/2026 00:00:00"), "2026-10-13")
        self.assertEqual(nba._et_date("2026-10-13T00:00:00Z"), "2026-10-13")
        self.assertEqual(nba._us_date("DEC 26, 2002"), "2002-12-26")
        self.assertEqual(nba._us_date("Oct 13, 2026"), "2026-10-13")
        self.assertEqual(nba._us_date("Mar 03 2014"), "2014-03-03")

    def test_game_kind(self):
        self.assertEqual(nba.game_kind("0012600045"), "pre")
        self.assertEqual(nba.game_kind("0022600001"), "reg")
        self.assertEqual(nba.game_kind("0042500401"), "playoffs")

    def test_season_label(self):
        self.assertEqual(nba.season_label(2026), "2026-27")
        self.assertEqual(nba.valid_season("2025-26"), "2025-26")
        self.assertIsNone(nba.valid_season("2025"))


class GameTests(unittest.TestCase):
    def test_live_game(self):
        g = nba.normalize_game(LIVE_GAME, "2026-10-13")
        self.assertEqual(g["kind"], "pre")
        self.assertEqual(g["home"]["tri"], "ORL")
        self.assertEqual(g["home"]["periods"], [35, 37])
        self.assertEqual(g["leaders"]["home"]["pts"], 24)
        self.assertIsNone(g["leaders"]["away"])
        self.assertEqual(g["etDate"], "2026-10-13")

    def test_schedule_game(self):
        g = nba.normalize_game(SCHEDULE_GAME, "2026-10-13")
        self.assertEqual(g["start"], "2026-10-14T02:00:00Z")  # pas l'heure seule « 1900-01-01 »
        self.assertEqual(g["arena"], "T-Mobile Arena")
        self.assertEqual(g["tv"], ["NBA TV"])
        self.assertEqual(g["topScorers"][0]["name"], "Austin Reaves")

    def test_scoring_actions(self):
        actions = [
            {"type": "period", "_away": 0, "_home": 0},
            {"type": "2pt", "_away": 2, "_home": 0},
            {"type": "rebound", "_away": None, "_home": None},  # score absent (format stats.nba.com)
            {"type": "3pt", "_away": 2, "_home": 3},
        ]
        out = nba._finish_actions(actions)
        self.assertEqual([a["scoring"] for a in out], [False, True, False, True])
        self.assertEqual((out[2]["away"], out[2]["home"]), (2, 0))


class NetTests(unittest.TestCase):
    def test_result_sets(self):
        payload = {"resultSets": [{"name": "Standings", "headers": ["TeamID", "WINS"], "rowSet": [[1, 50], [2, 30]]}]}
        self.assertEqual(net.result_sets(payload)["Standings"][1], {"TeamID": 2, "WINS": 30})
        single = {"resultSet": {"name": "LeagueLeaders", "headers": ["PLAYER"], "rowSet": [["A"]]}}
        self.assertEqual(net.result_sets(single)["LeagueLeaders"], [{"PLAYER": "A"}])


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Cache(Path(self.tmp.name) / "c.sqlite3")

    def tearDown(self):
        self.cache._db.close()
        self.tmp.cleanup()

    def test_fresh_then_cached(self):
        calls = []
        fetch = lambda: calls.append(1) or {"v": len(calls)}  # noqa: E731
        self.assertEqual(self.cache.get("k", 60, fetch)[0], {"v": 1})
        self.assertEqual(self.cache.get("k", 60, fetch)[0], {"v": 1})
        self.assertEqual(len(calls), 1)

    def test_stale_on_failure(self):
        self.cache.get("k", 0.01, lambda: {"v": 1})
        time.sleep(0.02)

        def broken():
            raise net.SourceError("hors ligne")

        data, meta = self.cache.get("k", 0.01, broken)
        self.assertEqual(data, {"v": 1})
        self.assertTrue(meta["stale"])

    def test_error_without_cache(self):
        def broken():
            raise net.SourceError("hors ligne")

        with self.assertRaises(net.SourceError):
            self.cache.get("absent", 60, broken)


class TeamsTests(unittest.TestCase):
    def test_thirty_teams(self):
        self.assertEqual(len(teams_meta.TEAMS), 30)
        self.assertEqual({t["conf"] for t in teams_meta.TEAMS}, {"East", "West"})
        self.assertEqual(teams_meta.team(1610612738)["tri"], "BOS")


if __name__ == "__main__":
    unittest.main()
