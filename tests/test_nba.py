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


class PlayoffTests(unittest.TestCase):
    def test_build_playoff_bracket(self):
        # Échantillon d'une finale 004230040 (BOS vs DAL) et d'un 1er tour 004230010 (BOS vs MIA)
        cp_rows = [
            {"GAME_ID": "0042300101", "HOME_TEAM_ID": 1610612738, "VISITOR_TEAM_ID": 1610612748, "SERIES_ID": "004230010", "GAME_NUM": 1},
            {"GAME_ID": "0042300102", "HOME_TEAM_ID": 1610612738, "VISITOR_TEAM_ID": 1610612748, "SERIES_ID": "004230010", "GAME_NUM": 2},
            {"GAME_ID": "0042300401", "HOME_TEAM_ID": 1610612738, "VISITOR_TEAM_ID": 1610612742, "SERIES_ID": "004230040", "GAME_NUM": 1},
            {"GAME_ID": "0042300402", "HOME_TEAM_ID": 1610612738, "VISITOR_TEAM_ID": 1610612742, "SERIES_ID": "004230040", "GAME_NUM": 2},
            {"GAME_ID": "0042300403", "HOME_TEAM_ID": 1610612742, "VISITOR_TEAM_ID": 1610612738, "SERIES_ID": "004230040", "GAME_NUM": 3},
            {"GAME_ID": "0042300404", "HOME_TEAM_ID": 1610612742, "VISITOR_TEAM_ID": 1610612738, "SERIES_ID": "004230040", "GAME_NUM": 4},
            {"GAME_ID": "0042300405", "HOME_TEAM_ID": 1610612738, "VISITOR_TEAM_ID": 1610612742, "SERIES_ID": "004230040", "GAME_NUM": 5},
        ]
        gf_rows = [
            # Game 1 round 1 : BOS gagne
            {"GAME_ID": "0042300101", "TEAM_ID": 1610612738, "PTS": 114, "WL": "W", "GAME_DATE": "2024-04-21"},
            {"GAME_ID": "0042300101", "TEAM_ID": 1610612748, "PTS": 94, "WL": "L", "GAME_DATE": "2024-04-21"},
            # Game 2 round 1 : MIA gagne
            {"GAME_ID": "0042300102", "TEAM_ID": 1610612738, "PTS": 101, "WL": "L", "GAME_DATE": "2024-04-24"},
            {"GAME_ID": "0042300102", "TEAM_ID": 1610612748, "PTS": 111, "WL": "W", "GAME_DATE": "2024-04-24"},
            # Finales : BOS gagne 4-1
            {"GAME_ID": "0042300401", "TEAM_ID": 1610612738, "PTS": 107, "WL": "W", "GAME_DATE": "2024-06-06"},
            {"GAME_ID": "0042300401", "TEAM_ID": 1610612742, "PTS": 89, "WL": "L", "GAME_DATE": "2024-06-06"},
            {"GAME_ID": "0042300402", "TEAM_ID": 1610612738, "PTS": 105, "WL": "W", "GAME_DATE": "2024-06-09"},
            {"GAME_ID": "0042300402", "TEAM_ID": 1610612742, "PTS": 98, "WL": "L", "GAME_DATE": "2024-06-09"},
            {"GAME_ID": "0042300403", "TEAM_ID": 1610612738, "PTS": 106, "WL": "W", "GAME_DATE": "2024-06-12"},
            {"GAME_ID": "0042300403", "TEAM_ID": 1610612742, "PTS": 99, "WL": "L", "GAME_DATE": "2024-06-12"},
            {"GAME_ID": "0042300404", "TEAM_ID": 1610612738, "PTS": 84, "WL": "L", "GAME_DATE": "2024-06-14"},
            {"GAME_ID": "0042300404", "TEAM_ID": 1610612742, "PTS": 122, "WL": "W", "GAME_DATE": "2024-06-14"},
            {"GAME_ID": "0042300405", "TEAM_ID": 1610612738, "PTS": 106, "WL": "W", "GAME_DATE": "2024-06-17"},
            {"GAME_ID": "0042300405", "TEAM_ID": 1610612742, "PTS": 88, "WL": "L", "GAME_DATE": "2024-06-17"},
        ]
        seeds = {1610612738: 1, 1610612748: 8, 1610612742: 5}

        res = nba._build_playoff_bracket("2023-24", cp_rows, gf_rows, seeds)
        self.assertTrue(res["available"])
        self.assertEqual(res["season"], "2023-24")

        # Vérification 1er tour
        s1 = res["series"]["0010"]
        self.assertEqual(s1["round"], 1)
        self.assertEqual(s1["topTeam"]["tri"], "BOS")
        self.assertEqual(s1["topTeam"]["seed"], 1)
        self.assertEqual(s1["bottomTeam"]["tri"], "MIA")
        self.assertEqual(s1["topTeam"]["wins"], 1)
        self.assertEqual(s1["bottomTeam"]["wins"], 1)
        self.assertEqual(s1["status"], "En cours")
        self.assertEqual(s1["summary"], "Égalité 1-1")

        # Vérification finales
        finals = res["finals"]
        self.assertIsNotNone(finals)
        self.assertEqual(finals["round"], 4)
        self.assertEqual(finals["winnerId"], 1610612738)
        self.assertEqual(finals["status"], "Terminée")
        self.assertEqual(finals["summary"], "BOS gagne 4-1")
        self.assertEqual(res["champion"]["tri"], "BOS")

    def test_empty_playoffs(self):
        res = nba._build_playoff_bracket("2026-27", [], [])
        self.assertFalse(res["available"])
        self.assertIsNone(res["champion"])

    def test_leaders_ranking_and_qualification(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            c = Cache(Path(tmp.name) / "cache.sqlite3")
            nba.init(c)
            sample_rows = [
                {"id": 1, "name": "Player High PPG Low GP", "teamId": 10, "tri": "AAA", "gp": 10, "pts": 35.0, "reb": 5.0, "ast": 5.0, "stl": 1.0, "blk": 1.0, "tpm": 3.0, "fgm": 12.0, "fgPct": 0.55, "eff": 35.0},
                {"id": 2, "name": "Player Qualified", "teamId": 20, "tri": "BBB", "gp": 80, "pts": 30.0, "reb": 8.0, "ast": 7.0, "stl": 1.5, "blk": 0.8, "tpm": 2.5, "fgm": 10.0, "fgPct": 0.50, "eff": 32.0},
                {"id": 3, "name": "Player FG High Volume", "teamId": 30, "tri": "CCC", "gp": 75, "pts": 25.0, "reb": 12.0, "ast": 4.0, "stl": 0.8, "blk": 2.2, "tpm": 0.2, "fgm": 10.0, "fgPct": 0.65, "eff": 30.0},
            ]
            c._write("leaders:2023-24", sample_rows, True)
            data, _ = nba.leaders("2023-24")
            self.assertEqual(data["season"], "2023-24")
            # Le joueur 1 n'a que 10 matchs (seuil 70% de 80 = 56), il ne doit pas être dans le top points
            pts_board = data["boards"]["pts"]
            self.assertEqual(pts_board[0]["id"], 2)
            self.assertEqual(pts_board[0]["value"], 30.0)
            # Pour l'adresse au tir, le joueur 3 a 75 * 10 = 750 FGM >= min_fgm (~292) et 65% FG%
            fg_board = data["boards"]["fgPct"]
            self.assertEqual(fg_board[0]["id"], 3)
            self.assertEqual(fg_board[0]["value"], 0.65)
        finally:
            c._db.close()
            tmp.cleanup()




if __name__ == "__main__":
    unittest.main()


class AdvancedStatsTests(unittest.TestCase):
    def test_true_shooting_and_effective_fg(self):
        # 30 points sur 20 tirs (dont 4 à 3 pts réussis sur 10 réussis) et 6 lancers tentés.
        rates = nba.advanced_rates(30, 10, 20, 4, 6)
        self.assertAlmostEqual(rates["ts"], 30 / (2 * (20 + 0.44 * 6)), places=4)
        self.assertAlmostEqual(rates["efg"], (10 + 0.5 * 4) / 20, places=4)

    def test_rates_without_attempts(self):
        self.assertEqual(nba.advanced_rates(0, 0, 0, 0, 0), {"ts": None, "efg": None})


class PlayInSeedTests(unittest.TestCase):
    def test_seed_follows_first_round_opponent(self):
        # Le 10e de la saison régulière a gagné le play-in et affronte le 1er : il est tête de série n° 8.
        series = {
            "0010": {"round": 1, "topTeam": {"id": 1, "seed": 1}, "bottomTeam": {"id": 10, "seed": 10}},
            "0011": {"round": 1, "topTeam": {"id": 2, "seed": 2}, "bottomTeam": {"id": 8, "seed": 8}},
            "0020": {"round": 2, "topTeam": {"id": 1, "seed": 1}, "bottomTeam": {"id": 10, "seed": 10}},
        }
        nba._fix_playin_seeds(series)
        self.assertEqual(series["0010"]["bottomTeam"]["seed"], 8)
        self.assertEqual(series["0011"]["bottomTeam"]["seed"], 7)
        self.assertEqual(series["0020"]["bottomTeam"]["seed"], 8)


class RecapTests(unittest.TestCase):
    @staticmethod
    def player(pid, pts, reb, ast, **extra):
        base = {"id": pid, "name": f"Joueur {pid}", "played": True, "pts": pts, "reb": reb, "ast": ast, "stl": 0, "blk": 0,
                "tpm": 0, "fgm": pts // 2, "fga": pts // 2 + 5, "ftm": 0, "fta": 0, "oreb": 1, "dreb": reb - 1, "tov": 2, "pf": 2}
        base.update(extra)
        return base

    def test_recap_highlights(self):
        games = [
            {"id": "A", "status": 3, "period": 4, "away": {"id": 1, "tri": "AAA", "score": 100}, "home": {"id": 2, "tri": "BBB", "score": 98}},
            {"id": "B", "status": 3, "period": 5, "away": {"id": 3, "tri": "CCC", "score": 130}, "home": {"id": 4, "tri": "DDD", "score": 101}},
            {"id": "C", "status": 1, "away": {"id": 5, "tri": "EEE"}, "home": {"id": 6, "tri": "FFF"}},
        ]
        boxes = {
            "A": {"teams": {"away": {"players": [self.player(11, 41, 5, 3)]}, "home": {"players": [self.player(21, 12, 14, 11)]}}},
            "B": {"teams": {"away": {"players": [self.player(31, 20, 4, 12, tpm=8)]}, "home": {"players": [self.player(41, 8, 3, 2, played=False)]}}},
        }
        recap = nba.build_recap("2026-10-14", games, boxes)
        self.assertEqual((recap["finished"], recap["upcoming"]), (2, 1))
        self.assertEqual(recap["topScorer"]["id"], 11)
        self.assertEqual(recap["topScorer"]["won"], True)
        self.assertEqual(recap["topShooter"]["tpm"], 8)
        self.assertEqual([p["id"] for p in recap["tripleDoubles"]], [21])
        self.assertEqual(recap["closest"]["id"], "A")
        self.assertEqual(recap["blowout"]["margin"], 29)
        self.assertEqual([g["id"] for g in recap["overtimes"]], ["B"])
        self.assertNotIn(41, [p["id"] for p in recap["best"]])  # joueur qui n'a pas joué


class CalendarTests(unittest.TestCase):
    def test_ics_folding_and_escaping(self):
        self.assertEqual(nba._ics_escape("Paris, France; salle"), "Paris\\, France\; salle")
        folded = nba._ics_fold("DESCRIPTION:" + "é" * 80)
        self.assertTrue(all(len(line.encode("utf-8")) <= 75 for line in folded))
        self.assertTrue(all(line.startswith(" ") for line in folded[1:]))


class DemoTests(unittest.TestCase):
    """Le mode démonstration doit fournir des données complètes et cohérentes, sans réseau."""

    @classmethod
    def setUpClass(cls):
        from parquet import demo

        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_get = net._get
        demo.install()
        nba.init(Cache(Path(cls.tmp.name) / "demo.sqlite3"))

    @classmethod
    def tearDownClass(cls):
        net._get = cls.saved_get
        net.DEMO = False
        nba.CACHE._db.close()
        cls.tmp.cleanup()

    def test_scoreboard_has_live_games(self):
        data, _ = nba.scoreboard(None)
        self.assertEqual(data["date"], "2026-10-14")
        self.assertTrue(any(g["status"] == 2 for g in data["games"]))

    def test_playoff_bracket_is_consistent(self):
        data, _ = nba.playoffs()
        self.assertTrue(data["available"])
        self.assertIsNotNone(data["champion"])
        seeds = sorted((s["topTeam"]["seed"], s["bottomTeam"]["seed"]) for s in data["east"]["round1"])
        self.assertEqual(seeds, [(1, 8), (2, 7), (3, 6), (4, 5)])

    def test_recap_and_calendar(self):
        recap, _ = nba.recap("2026-10-13")
        self.assertGreater(recap["finished"], 0)
        self.assertIsNotNone(recap["topScorer"])
        body, filename = nba.team_calendar_ics(1610612738)
        self.assertTrue(body.startswith("BEGIN:VCALENDAR\r\n"))
        self.assertIn("BEGIN:VEVENT", body)
        self.assertTrue(filename.endswith(".ics"))

    def test_career_has_advanced_rates(self):
        career, _ = nba.player_career(1790001)
        self.assertIsNotNone(career["careerRegular"]["ts"])
