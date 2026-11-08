"""Tests de la mise en forme des données NBA (sans accès réseau).

Les échantillons reprennent la structure réelle des flux de NBA.com.
Lancer : python -m unittest discover -s tests
"""

import re
import tempfile
import time
import unittest
import json
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


class VersionTests(unittest.TestCase):
    def test_server_interface_and_offline_cache_share_the_version(self):
        import re

        import parquet

        web = Path(__file__).resolve().parent.parent / "web"
        app = re.search(r'APP_VERSION = "([^"]+)"', (web / "js" / "app.js").read_text(encoding="utf-8")).group(1)
        sw = re.search(r'VERSION = "([^"]+)"', (web / "sw.js").read_text(encoding="utf-8")).group(1)
        self.assertEqual(app, parquet.__version__)
        self.assertEqual(sw, parquet.__version__)


class EncodingTests(unittest.TestCase):
    """Noms accentués : le CDN n'indique pas toujours d'encodage, requests supposait alors du Latin-1."""

    def test_json_is_read_as_utf8_whatever_the_announced_encoding(self):
        import requests

        from parquet import net

        response = requests.Response()
        response.status_code = 200
        response._content = json.dumps({"name": "Nikola Jokić", "team": "Dončić"}, ensure_ascii=False).encode("utf-8")
        response.headers["Content-Type"] = "text/plain"
        response.encoding = "ISO-8859-1"

        class Session:
            def get(self, *a, **k):
                return response

        saved = net._session
        net._session = lambda: Session()
        try:
            data = net._get("https://cdn.nba.com/x.json", None, {}, (1, 1), "cdn.nba.com")
        finally:
            net._session = saved
        self.assertEqual(data["name"], "Nikola Jokić")
        self.assertEqual(data["team"], "Dončić")

    def test_old_cache_is_emptied_once(self):
        import sqlite3

        from parquet import cache as cache_mod

        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "c.sqlite3"
            db = sqlite3.connect(str(path))
            db.execute("CREATE TABLE cache (key TEXT PRIMARY KEY, fetched_at REAL, payload TEXT)")
            db.execute("INSERT INTO cache VALUES ('live:scoreboard', 1, '{\"n\": \"JokiÄ\"}')")
            db.commit()
            db.close()
            c = cache_mod.Cache(path)
            self.assertIsNone(c._read("live:scoreboard"))
            c._db.execute("INSERT INTO cache VALUES ('k', 1, '1')")
            c._db.commit()
            c._db.close()
            again = cache_mod.Cache(path)  # déjà à jour : rien n'est effacé
            self.assertIsNotNone(again._read("k"))
            again._db.close()


class RaceTests(unittest.TestCase):
    def rows(self, records):
        return [
            {"teamId": 100 + i, "rank": i + 1, "w": w, "l": l, "pct": w / (w + l) if w + l else 0, "conf": "East"}
            for i, (w, l) in enumerate(records)
        ]

    def test_clinch_elimination_and_magic_numbers(self):
        from parquet import season

        records = [(60, 10), (50, 20), (48, 22), (45, 25), (42, 28), (40, 30), (39, 31), (36, 34), (35, 35), (33, 37), (30, 40), (25, 45), (20, 50), (15, 55), (10, 60)]
        out = season.race_rows(self.rows(records), remaining={100: [101, 102]}, home_left={100: 1})
        by_rank = {r["rank"]: r for r in out}
        self.assertEqual(by_rank[1]["status"], "playoffs")
        self.assertEqual(by_rank[1]["left"], 12)
        self.assertEqual(by_rank[1]["maxW"], 72)
        self.assertEqual(by_rank[1]["homeLeft"], 1)
        self.assertAlmostEqual(by_rank[1]["sos"], (50 / 70 + 48 / 70) / 2, places=3)
        self.assertEqual(by_rank[6]["status"], "race")
        # 83 - 40 victoires de la 6e - 31 défaites de la 7e
        self.assertEqual(by_rank[6]["magic6"], 12)
        self.assertEqual(by_rank[7]["gb6"], 1.0)
        self.assertEqual(by_rank[7]["elim6"], 83 - 40 - 31)
        # 10-60 : au mieux 22 victoires, dix équipes en ont déjà plus.
        self.assertEqual(by_rank[15]["status"], "out")
        self.assertIsNone(by_rank[15]["elim10"])
        # 20-50 : 32 victoires au mieux, dix équipes en ont déjà plus.
        self.assertEqual(by_rank[13]["status"], "out")
        # 25-45 : 37 au mieux ; sept équipes en ont déjà plus (plus de top 6), pas dix.
        self.assertEqual(by_rank[12]["status"], "playin-max")
        self.assertEqual(by_rank[12]["elim10"], 83 - 33 - 45)

    def test_finished_season_is_settled(self):
        from parquet import season

        records = [(82 - k * 3, k * 3) for k in range(15)]
        out = season.race_rows(self.rows(records))
        self.assertEqual([r["status"] for r in out], ["playoffs"] * 6 + ["playin"] * 4 + ["out"] * 5)
        self.assertTrue(all(r["left"] == 0 for r in out))

    def test_awards_ranking_rules(self):
        from parquet import season

        def b(pid, gp, mn, pts, reb, ast, stl=1.0, blk=0.5, team=1):
            return {"PLAYER_ID": pid, "PLAYER_NAME": f"J{pid}", "TEAM_ID": team, "GP": gp, "MIN": mn, "PTS": pts, "REB": reb, "AST": ast, "STL": stl, "BLK": blk, "DREB": reb * 0.8, "FG_PCT": 0.5}

        base = {1: b(1, 60, 36, 31, 8, 9, team=1), 2: b(2, 60, 34, 22, 5, 4, team=2), 3: b(3, 20, 36, 40, 10, 10), 4: b(4, 58, 30, 18, 4, 3, stl=2.2, blk=2.4),
                5: b(5, 55, 27, 16, 3, 2), 6: b(6, 59, 25, 12, 4, 2)}
        prev = {2: b(2, 70, 26, 11, 3, 2), 1: b(1, 70, 36, 30, 8, 9)}
        bench = {5: b(5, 50, 26, 16, 3, 2), 6: b(6, 10, 25, 12, 4, 2)}
        res = season.build_awards(base, {}, bench, prev, {1: 0.8, 2: 0.4}, rookies={4, 5})
        mvp = [p["id"] for p in res["mvp"]]
        self.assertEqual(mvp[0], 1)
        self.assertNotIn(3, mvp)  # pas assez de matchs joués
        self.assertEqual(res["mvp"][0]["share"], 100.0)
        self.assertEqual([p["id"] for p in res["roy"]][0], 4)
        self.assertEqual([p["id"] for p in res["dpoy"]][0], 4)
        self.assertEqual([p["id"] for p in res["smoy"]], [5])  # 6 a surtout été titulaire
        self.assertEqual([p["id"] for p in res["mip"]][0], 2)
        self.assertEqual(res["mip"][0]["dPts"], 11.0)


class PalmaresTests(unittest.TestCase):
    def test_data_is_consistent(self):
        from parquet import palmares

        data = palmares.raw()
        years = [f["year"] for f in data["finals"]]
        self.assertEqual(years, list(range(years[0], 1946, -1)))  # une finale par an depuis 1947
        for award in data["awards"]:
            seasons = [w["season"] for w in award["winners"]]
            self.assertTrue(all(re.fullmatch(r"\d{4}-\d{2}", s) for s in seasons), award["key"])
            self.assertEqual(seasons, sorted(seasons, reverse=True), award["key"])
            for s in seasons:  # deuxième année = première + 1
                self.assertEqual((int(s[:4]) + 1) % 100, int(s[5:]), s)
        mvp = [w for w in data["awards"][0]["winners"]]
        self.assertEqual(sum(1 for w in mvp if w["name"] == "Kareem Abdul-Jabbar"), 6)
        self.assertEqual(sum(1 for f in data["finals"] if f["champion"] == "Boston Celtics"), 18)

    def test_franchise_names_and_player_matching(self):
        from parquet import history, palmares

        self.assertEqual(palmares.team_tri("Seattle SuperSonics", 1979), "OKC")
        self.assertEqual(palmares.team_tri("Minneapolis Lakers", 1950), "LAL")
        self.assertIsNone(palmares.team_tri("Baltimore Bullets", 1948))
        self.assertEqual(palmares.team_tri("Baltimore Bullets", 1971), "WAS")
        self.assertIsNone(palmares.team_tri("Chicago Stags", 1947))
        self.assertEqual(palmares.norm("Nikola Jokić"), "nikola jokic")
        self.assertEqual(palmares.norm("J.R. Smith"), "jr smith")
        self.assertEqual(palmares.norm("Jimmy Butler III"), palmares.norm("Jimmy Butler"))
        self.assertEqual(palmares.norm("Jaren Jackson Jr."), "jaren jackson")
        by_name = {"eddie johnson": [(1, 1977, 1986), (2, 1981, 1998)], "kareem abdul-jabbar": [(3, 1969, 1988)], "kevin johnson": [(4, 1987, 1999)]}
        self.assertIsNone(history._player_id(by_name, "Eddie Johnson", 1984))  # deux possibles
        self.assertEqual(history._player_id(by_name, "Eddie Johnson", 1990), 2)
        self.assertEqual(history._player_id(by_name, "Lew Alcindor", 1969), 3)
        self.assertEqual(history._player_id(by_name, "Kevin Johnson", 1988), 4)
        self.assertIsNone(history._player_id(by_name, "Inconnu", 1990))


class PlayerSeasonTests(unittest.TestCase):
    def game(self, day, home, wl, pts, opp="BOS", fga=10, fgm=5, fta=2, tpa=4, tpm=2):
        return {"date": day, "home": home, "wl": wl, "pts": pts, "reb": 5, "ast": 4, "fga": fga, "fgm": fgm, "fta": fta, "tpa": tpa, "tpm": tpm, "min": 30.0, "pm": 3, "opp": opp}

    def test_splits_by_context(self):
        from parquet import player_season

        games = [
            self.game("2025-11-01", True, "W", 30, "BOS"),
            self.game("2025-11-02", False, "L", 10, "NYK"),
            self.game("2025-11-04", True, "W", 20, "BOS"),
            self.game("2025-12-10", False, "W", 40, "MIA"),
        ]
        groups = {g["key"]: g["rows"] for g in player_season.splits(games)}
        self.assertEqual(groups["form"][0]["gp"], 4)
        self.assertEqual(groups["form"][0]["pts"], 25.0)
        self.assertEqual(groups["form"][0]["w"], 3)
        self.assertEqual([r["gp"] for r in groups["place"]], [2, 2])
        self.assertEqual(groups["place"][0]["pts"], 25.0)
        rest = {r["label"]: r["gp"] for r in groups["rest"]}
        self.assertEqual(rest, {"Deux soirs de suite": 1, "1 jour de repos": 1, "2 jours ou plus": 1})
        self.assertEqual([r["label"] for r in groups["month"]], ["Novembre 2025", "Décembre 2025"])
        self.assertEqual(groups["opp"][0]["label"], "MIA")  # trié par points
        # Adresse réelle : 25 pts / (2 × (10 + 0,44 × 2))
        self.assertAlmostEqual(groups["form"][0]["ts"], round(25 / (2 * (10 + 0.88)), 3))
        self.assertEqual(player_season.splits([]), [])

    def test_zones_against_league(self):
        from parquet import player_season

        shots = [[0, 0, 1, "Restricted Area", "", "", 1, "", ""], [0, 0, 0, "Restricted Area", "", "", 1, "", ""], [200, 200, 1, "Above the Break 3", "", "", 25, "", ""]]
        league = [["Restricted Area", "Center(C)", "", 100, 60], ["Above the Break 3", "Center(C)", "", 100, 35]]
        zones = {z["key"]: z for z in player_season._zones(shots, league)}
        self.assertEqual(zones["Restricted Area"]["pct"], 0.5)
        self.assertEqual(zones["Restricted Area"]["league"], 0.6)
        self.assertAlmostEqual(zones["Restricted Area"]["share"], 0.667, places=3)
        self.assertEqual(zones["Mid-Range"]["fga"], 0)
        self.assertNotIn("Backcourt", zones)



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


class TeamStatsTests(unittest.TestCase):
    def test_ranks_respect_direction(self):
        from parquet import teamstats

        rows = [{"teamId": 1, "off": 120, "def": 110}, {"teamId": 2, "off": 110, "def": 105}, {"teamId": 3, "off": 115, "def": 115}]
        teamstats.rank(rows)
        self.assertEqual([r["ranks"]["off"] for r in rows], [1, 3, 2])
        self.assertEqual([r["ranks"]["def"] for r in rows], [2, 1, 3])  # moins encaissé = mieux

    def test_head_to_head_summary(self):
        from parquet import teamstats

        def g(day, season, win, pts, opp, po=False):
            return {"id": day, "date": day, "season": season, "playoffs": po, "home": True, "win": win, "pts": pts, "opp": opp}

        games = [
            g("2026-01-10", "2025-26", True, 110, 100),
            g("2025-12-01", "2025-26", True, 99, 98),
            g("2025-05-10", "2024-25", False, 90, 100, True),
            g("2025-05-08", "2024-25", True, 105, 101, True),
            g("2025-05-06", "2024-25", False, 88, 120, True),
            g("2024-11-01", "2024-25", False, 100, 104),
        ]
        s = teamstats.summarize_h2h(games)
        self.assertEqual(s["regular"], {"w": 2, "l": 1})
        self.assertEqual(s["playoffs"], {"w": 1, "l": 2})
        self.assertEqual(s["streak"], 2)
        self.assertEqual(s["series"], [{"season": "2024-25", "w": 1, "l": 2, "won": False}])
        self.assertEqual(s["best"]["pts"], 110)
        self.assertEqual(s["worst"]["opp"], 120)
        self.assertEqual(s["since"], "2024-25")
        self.assertEqual(teamstats.summarize_h2h([])["total"], 0)


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
        # Un joueur du match par rencontre terminée, le meilleur Game Score en premier.
        self.assertEqual([(p["gameId"], p["id"]) for p in recap["stars"]], [("A", 11), ("B", 31)])
        self.assertEqual((recap["stars"][0]["first"], recap["stars"][0]["last"]), ("Joueur", "11"))
        self.assertEqual(recap["stars"][1]["game"]["away"]["score"], 130)

    def test_split_name(self):
        self.assertEqual(nba._split_name({"first": "Shai", "last": "Gilgeous-Alexander"}), ("Shai", "Gilgeous-Alexander"))
        self.assertEqual(nba._split_name({"name": "Jaren Jackson Jr."}), ("Jaren", "Jackson Jr."))
        self.assertEqual(nba._split_name({"name": "Nenê"}), ("", "Nenê"))


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

    def test_playoff_race_and_awards_race_in_demo(self):
        from parquet import season

        race, _ = season.playoff_race()
        self.assertEqual(set(race["conferences"]), {"East", "West"})
        self.assertEqual(len(race["conferences"]["East"]), 15)
        aw, _ = season.awards_race()
        self.assertEqual([a["key"] for a in aw["awards"]], ["mvp", "roy", "dpoy", "smoy", "mip"])
        self.assertTrue(all(a["players"] for a in aw["awards"]))
        self.assertTrue(aw["advanced"])

    def test_records_and_palmares_in_demo(self):
        from parquet import history

        rec, _ = history.records()
        self.assertEqual([b["key"] for b in rec["boards"]], ["PTS", "REB", "AST", "STL", "BLK", "FG3M", "FTM", "GP"])
        pts = rec["boards"][0]["leaders"]
        self.assertEqual(len(pts), 50)
        self.assertEqual([p["rank"] for p in pts], list(range(1, 51)))
        chasing = [p for p in pts[1:] if p["active"]]
        self.assertTrue(all(p["next"]["gap"] >= 0 for p in chasing))
        po, _ = history.records("Playoffs")
        self.assertEqual(po["seasonType"], "Playoffs")
        pal, _ = history.palmares_data()
        self.assertEqual(pal["titles"][0]["count"], 18)
        self.assertEqual(pal["finals"][0]["championId"], 1610612752)

    def test_deep_verification_passes_on_demo_data(self):
        from parquet import verify

        report = verify.run_all()
        self.assertEqual(report["total"], len(verify.CHECKS))
        self.assertEqual(report["ok"], report["total"], [c for c in report["checks"] if c["level"] != "ok"])
        self.assertIn("sources fonctionnent normalement", verify.report_text(report))

    def test_deep_verification_flags_format_changes(self):
        from parquet import verify

        def broken():
            verify.need(False, "colonne PTS absente")

        def down():
            raise net.SourceError("stats.nba.com ne répond pas")

        self.assertEqual(verify._run(("x", "X", "Page", broken))["level"], "warn")
        self.assertIn("colonne PTS absente", verify._run(("x", "X", "Page", broken))["message"])
        self.assertEqual(verify._run(("x", "X", "Page", down))["level"], "error")
        self.assertEqual(verify._run(("x", "X", "Page", lambda: {}["absent"]))["level"], "warn")

    def test_draft_by_year_and_by_team(self):
        data, _ = nba.draft(2015)
        self.assertEqual(data["year"], 2015)
        self.assertEqual([p["pick"] for p in data["picks"]], list(range(1, 61)))
        self.assertEqual({p["round"] for p in data["picks"]}, {1, 2})
        self.assertEqual(data["years"][0], 2026)
        # Les anciens joueurs passés en NBA ont leur bilan (saisons, moyennes).
        self.assertTrue(any(p["career"] and p["career"]["seasons"] > 0 for p in data["picks"]))
        # Année inconnue : la draft la plus récente.
        self.assertEqual(nba.draft(1800)[0]["year"], 2026)
        team, _ = nba.draft(team=1610612738)
        self.assertTrue(team["picks"])
        self.assertTrue(all(p["teamId"] == 1610612738 for p in team["picks"]))
        years = [p["year"] for p in team["picks"]]
        self.assertEqual(years, sorted(years, reverse=True))

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
