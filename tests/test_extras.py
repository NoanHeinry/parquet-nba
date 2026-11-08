"""Tests des contenus complémentaires : page d'un match, faits marquants, YouTube,
rapport des blessures, transactions, réglages. Aucun accès réseau."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

from parquet import access, demo, extras, nba, net, settings
from parquet.cache import Cache
from parquet.server import make_server

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class InjuryReportTests(unittest.TestCase):
    """La mise en page est celle d'un vrai rapport de la NBA ; les noms des joueurs sont inventés."""

    @classmethod
    def setUpClass(cls):
        pages = json.loads((FIXTURES / "injury_report_words.json").read_text(encoding="utf-8"))
        cls.games = extras.parse_report_words([[tuple(w) for w in page] for page in pages])

    def test_games_and_teams_across_pages(self):
        self.assertEqual(len(self.games), 11)
        self.assertEqual(self.games[0]["matchup"], "ORL@PHX")
        self.assertEqual(self.games[0]["date"], "11/05/2026")
        self.assertEqual(self.games[0]["time"], "09:00 (ET)")
        # La page 2 commence par un match sans date : la date de la page 1 continue de valoir.
        self.assertEqual(self.games[3]["matchup"], "WAS@ATL")
        self.assertEqual(self.games[3]["date"], "11/06/2026")
        self.assertEqual([t["name"] for t in self.games[-1]["teams"]], ["San Antonio Spurs", "Sacramento Kings"])

    def test_multiline_reasons_and_names(self):
        magic = self.games[0]["teams"][0]
        self.assertEqual(magic["name"], "Orlando Magic")
        self.assertEqual(len(magic["players"]), 5)
        first = magic["players"][0]
        self.assertEqual((first["name"], first["status"]), ("Cyril Arnaud", "Out"))
        self.assertEqual(first["reason"], "Injury/Illness - Right High Ankle Sprain")
        self.assertEqual(magic["players"][4]["reason"], "Injury/Illness - Right Knee Contusion / Bone Bruise")
        warriors = self.games[1]["teams"][1]
        self.assertEqual(warriors["players"][0]["name"], "Ilan Hugo III")
        self.assertEqual(warriors["players"][2]["reason"], "Not With Team")

    def test_not_yet_submitted(self):
        suns = self.games[0]["teams"][1]
        self.assertFalse(suns["submitted"])
        self.assertEqual(suns["players"], [])

    def test_reason_translation(self):
        cases = {
            "Injury/Illness - Right High Ankle Sprain": "Cheville droite : entorse haute",
            "Injury/Illness - Right Knee Contusion / Bone Bruise": "Genou droit : contusion, contusion osseuse",
            "Injury/Illness - Right Partially Torn Hamstring": "Ischio-jambiers droits : déchirure partielle",
            "Injury/Illness - Left Third Metatarsal Fracture": "3e métatarse gauche : fracture",
            "Injury/Illness - Low Back; Spasms": "Bas du dos : spasmes",
            "G League - Two-Way": "G League (contrat two-way)",
            "Not With Team": "Absent du groupe",
        }
        for raw, expected in cases.items():
            self.assertEqual(extras.injury_fr(raw), expected, raw)
        # Mot inconnu : pas de traduction approximative, l'anglais sera affiché.
        self.assertEqual(extras.injury_fr("Injury/Illness - Left Zygomatic Arch Thing"), "")

    def test_report_file_names(self):
        url = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-05_12_15PM.pdf"
        when = extras.report_time(url)
        self.assertEqual((when.hour, when.minute), (12, 15))
        self.assertEqual(extras.report_url(when), url)
        self.assertEqual(extras.report_time("Injury-Report_2026-11-05_12_00AM.pdf").hour, 0)


class GamePageTests(unittest.TestCase):
    def page(self, **report):
        return {
            "props": {
                "pageProps": {
                    "game": {"gameRecap": {"title": "Game Recap: Celtics 109, Bucks 102", "permalink": "https://www.nba.com/watch/video/x", "videoDuration": "03:04", "featuredImage": "javascript:alert(1)"}},
                    "highlightVideos": [{"title": "4th Quarter Highlights", "permalink": "https://www.nba.com/watch/video/y", "videoDuration": "01:22"}],
                    "blueprintReport": report,
                    "story": {"header": {"headline": "Celtics turn back Bucks", "byline": "By X", "bytitle": "Associated Press"}},
                }
            }
        }

    def test_recap_moments_and_safe_urls(self):
        moment = {"rank": 2, "title": "Big Three", "summary": "s", "category": "Scoring", "eventNum": 708, "playerId": 202331,
                  "largeDuration": 8900, "mediumUrl": "https://videos.nba.com/a_960x540.mp4", "largeUrl": "https://evil.example/x.mp4"}
        data = extras.parse_game_page(self.page(defining_moments={"definingMoments": [moment, {**moment, "rank": 1, "mediumUrl": ""}]}))
        self.assertEqual(data["recap"]["duration"], "03:04")
        self.assertIsNone(data["recap"]["image"], "lien non https vers la NBA refusé")
        self.assertEqual([m["rank"] for m in data["moments"]], [1, 2])
        self.assertEqual(data["moments"][1]["video"], "https://videos.nba.com/a_960x540.mp4")
        self.assertIsNone(data["moments"][1]["videoHd"])
        self.assertEqual(data["moments"][1]["category"], "Panier")
        self.assertEqual(data["moments"][1]["seconds"], 9)
        self.assertEqual(data["story"]["agency"], "Associated Press")
        self.assertEqual(len(data["highlights"]), 1)

    def test_keys_of_the_game(self):
        report = {
            "defensive_spotlight": {"homeDefensiveSpotlight": {"defPlayerId": "1", "defPlayerName": "A", "defTeamId": "2", "defTeamAbbreviation": "BOS",
                                                               "offPlayerId": "3", "offPlayerName": "B", "offTeamAbbreviation": "MIL", "fieldGoalMakes": "1",
                                                               "fieldGoalAttempts": "6", "threePointMakes": "1", "threePointAttempts": "2", "matchupTime": "4:32"}},
            "shot_difficulty": {"shotDifficulty": [
                {"success": True, "expFieldGoalPct": "0.41", "shooter": {"playerId": 9, "firstName": "C", "lastName": "D"}, "shotType": "3PT"},
                {"success": False, "expFieldGoalPct": "0.05", "shooter": {}},
                {"success": True, "expFieldGoalPct": "0.12", "shooter": {"id": 8, "name": "E F"}, "shotType": "2PT"},
            ]},
        }
        data = extras.parse_game_page(self.page(**report))
        self.assertEqual(data["defense"][0]["fga"], 6)
        self.assertEqual([s["shooter"]["name"] for s in data["hardest"]], ["E F", "C D"], "tirs réussis, du plus difficile au plus facile")
        self.assertTrue(data["hardest"][1]["three"])

    def test_next_data_extraction(self):
        html = '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script></html>'
        self.assertEqual(extras.next_data(html), {"props": {"pageProps": {}}})
        with self.assertRaises(net.SourceError):
            extras.next_data("<html></html>")


class EventsTests(unittest.TestCase):
    def test_notable_events(self):
        actions = [
            {"type": "foul", "sub": "technical", "descr": "flopping", "desc": "H. González flopping technical FOUL (1 Tech)", "period": 3, "clock": "10:28", "player": "H. González"},
            {"type": "foul", "sub": "technical", "descr": "defensive-3-second", "desc": "Defense 3 Second", "period": 1, "clock": "5:00"},
            {"type": "foul", "sub": "personal", "descr": "flagrant-type-1", "desc": "M. Wagner flagrant-type-1 personal FOUL (2 PF)", "period": 1, "clock": "3:47"},
            {"type": "timeout", "sub": "challenge", "desc": "MIL Timeout", "period": 1, "clock": "3:55", "tri": "MIL"},
            {"type": "ejection", "sub": "", "desc": "X ejection", "period": 4, "clock": "1:00"},
            {"type": "2pt", "sub": "Jump Shot", "desc": "made shot", "period": 1, "clock": "1:00"},
        ]
        events = extras.notable_events(actions)
        self.assertEqual([e["kind"] for e in events], ["technical", "flagrant", "challenge", "ejection"])
        self.assertEqual(events[0]["detail"], "simulation")
        self.assertEqual(events[1]["label"], "Faute flagrante 1")


class YoutubeTests(unittest.TestCase):
    def test_title_matching(self):
        title = "HEAT at CLIPPERS | FULL GAME HIGHLIGHTS | November 4, 2026"
        self.assertTrue(extras.title_matches_game(title, "Heat", "Clippers", "2026-11-04"))
        self.assertFalse(extras.title_matches_game(title, "Clippers", "Heat", "2026-11-04"))
        self.assertFalse(extras.title_matches_game(title, "Heat", "Clippers", "2026-12-04"), "autre rencontre entre les mêmes équipes")
        self.assertFalse(extras.title_matches_game("Klay hits the game-winner vs Clippers", "Heat", "Clippers", "2026-11-04"))
        self.assertTrue(extras.title_matches_game("TRAIL BLAZERS at 76ERS | FULL GAME HIGHLIGHTS | January 2, 2027", "Trail Blazers", "76ers", "2027-01-02"))
        self.assertTrue(extras.title_matches_night("NBA's Nightly Recap | November 4, 2026", "2026-11-04", "recap"))
        self.assertTrue(extras.title_matches_night("NBA's Top 10 Plays of the Night | November 4, 2026", "2026-11-04", "top10"))
        self.assertFalse(extras.title_matches_night("NBA's Top 10 Plays of the Night | November 3, 2026", "2026-11-04", "top10"))

    def test_feed_parsing(self):
        xml = ('<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">'
               "<entry><yt:videoId>qz1LM3gsHNw</yt:videoId><title>HEAT at CLIPPERS | FULL GAME HIGHLIGHTS | November 4, 2026</title>"
               "<published>2026-11-05T06:37:49+00:00</published></entry>"
               "<entry><yt:videoId>bad id</yt:videoId><title>x</title></entry></feed>")
        self.assertEqual([e["id"] for e in extras.parse_feed(xml)], ["qz1LM3gsHNw"])
        self.assertEqual(extras.parse_feed("pas du xml"), [])


class TransactionTests(unittest.TestCase):
    def test_french_sentences(self):
        cases = [
            ("Signing", "Oklahoma City Thunder signed forward Dalen Terry to a Rest-of-Season Contract.", "Signe Dalen Terry (ailier), contrat jusqu'à la fin de la saison"),
            ("Waive", "Minnesota Timberwolves waived forward Enrique Freeman.", "Libère Enrique Freeman (ailier)"),
            ("AwardOnWaivers", "Phoenix Suns claimed forward Drew Timme off waivers.", "Récupère Drew Timme (ailier) via les waivers"),
            ("ContractConverted", "Phoenix Suns converted the contract of center Duop Reath to a Two-Way Contract.", "Change le contrat de Duop Reath (pivot) en contrat two-way"),
            ("Trade", "Chicago Bulls received guard Buddy Hield from Charlotte Hornets.", "Reçoit Buddy Hield (arrière) des Hornets"),
            ("Trade", "Utah Jazz received 2028 second round draft pick from Charlotte Hornets.", "Reçoit un choix de 2e tour de draft 2028 des Hornets"),
        ]
        for kind, desc, expected in cases:
            self.assertEqual(extras.transaction_fr(kind, desc), expected)
        self.assertEqual(extras.transaction_fr("Signing", "Something unusual happened"), "")
        self.assertEqual(extras.contract_fr("a three-year contract"), "contrat de 3 ans")


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        settings.init(Path(self.tmp.name) / "settings.json")

    def tearDown(self):
        settings.init(None)
        self.tmp.cleanup()

    def test_save_and_environment_priority(self):
        with mock.patch.dict(os.environ, {settings.ENV_YOUTUBE: ""}):
            self.assertEqual(settings.youtube_key(), ("", ""))
            settings.save({"youtubeKey": "AIzaSyTESTKEY1234567890abcdef"})
            self.assertEqual(settings.youtube_key(), ("AIzaSyTESTKEY1234567890abcdef", "file"))
            self.assertEqual(settings.youtube_status()["hint"], "…cdef")
        with mock.patch.dict(os.environ, {settings.ENV_YOUTUBE: "AIzaENVKEY000000000000000"}):
            self.assertEqual(settings.youtube_key()[1], "env")
        settings.save({"youtubeKey": ""})
        with mock.patch.dict(os.environ, {settings.ENV_YOUTUBE: ""}):
            self.assertFalse(settings.youtube_status()["configured"])


class AccessCodeTests(unittest.TestCase):
    """Code d'accès facultatif (hébergement) : tout est fermé tant que le code n'a pas été tapé."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_get = net._get
        demo.install()
        nba.init(Cache(Path(cls.tmp.name) / "c.sqlite3"))
        settings.init(Path(cls.tmp.name) / "settings.json")
        cls.key = Path(cls.tmp.name) / "acces.key"
        access.init("code-secret", cls.key)
        cls.server = make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        cls.opener = urllib.request.build_opener(NoRedirect)

    @classmethod
    def tearDownClass(cls):
        access.init(None, None)
        cls.server.shutdown()
        cls.server.server_close()
        net._get = cls.saved_get
        net.DEMO = False
        settings.init(None)
        nba.CACHE._db.close()
        cls.tmp.cleanup()

    def setUp(self):
        access._failures.clear()

    def request(self, path, data=None, cookie=None, headers=None):
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        if cookie:
            req.add_header("Cookie", cookie)
        try:
            with self.opener.open(req) as r:
                return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def login(self, code, next_path="/joueurs"):
        body = urllib.parse.urlencode({"code": code, "next": next_path}).encode()
        return self.request("/acces", data=body, headers={"Content-Type": "application/x-www-form-urlencoded"})

    def test_everything_is_closed_without_the_code(self):
        status, _, body = self.request("/")
        self.assertEqual(status, 401)
        self.assertIn("Code d'accès", body.decode())
        self.assertIn('value="/"', body.decode())
        status, _, body = self.request("/equipe/1610612738?onglet=profil")
        self.assertIn('value="/equipe/1610612738?onglet=profil"', body.decode())
        status, _, body = self.request("/api/status")
        self.assertEqual(status, 401)
        self.assertTrue(json.loads(body)["access"])
        self.assertEqual(self.request("/js/app.js")[0], 401)
        self.assertEqual(self.request("/img/icon.svg")[0], 200)  # icône de l'onglet

    def test_right_code_gives_a_signed_cookie(self):
        status, headers, _ = self.login("code-secret")
        self.assertEqual(status, 303)
        self.assertEqual(headers["Location"], "/joueurs")
        cookie = headers["Set-Cookie"].split(";")[0]
        self.assertNotIn("code-secret", headers["Set-Cookie"])
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        self.assertEqual(self.request("/api/status", cookie=cookie)[0], 200)
        self.assertEqual(self.request("/js/app.js", cookie=cookie)[0], 200)
        self.assertEqual(self.request("/api/status", cookie="parquet_acces=faux")[0], 401)
        # La clé est gardée : le même cookie reste valable après un redémarrage.
        access.init("code-secret", self.key)
        self.assertEqual(self.request("/api/status", cookie=cookie)[0], 200)
        # Changer le code déconnecte tout le monde.
        access.init("autre-code", self.key)
        self.assertEqual(self.request("/api/status", cookie=cookie)[0], 401)
        access.init("code-secret", self.key)

    def test_wrong_code_redirect_safety_and_lockout(self):
        status, _, body = self.login("mauvais")
        self.assertEqual(status, 401)
        self.assertIn("pas le bon code", body.decode())
        self.assertEqual(self.login("code-secret", "//exemple.com")[1]["Location"], "/")
        self.assertEqual(self.login("code-secret", "https://exemple.com")[1]["Location"], "/")
        self.assertEqual(self.login("code-secret", "/\r\nSet-Cookie: x=1")[1]["Location"], "/")
        self.assertEqual(self.login("code-secret", "/#/equipe/1610612738")[1]["Location"], "/#/equipe/1610612738")
        with mock.patch("parquet.access.time.sleep"):
            for _ in range(access.MAX_FAILURES):
                self.login("mauvais")
        status, _, body = self.login("code-secret")
        self.assertEqual(status, 429)
        self.assertIn("Trop d'essais", body.decode())

    def test_login_behind_a_tunnel_checks_the_public_origin(self):
        body = urllib.parse.urlencode({"code": "code-secret", "next": "/"}).encode()
        form = {"Content-Type": "application/x-www-form-urlencoded"}
        tunnel = {**form, "Origin": "https://parquet.exemple.fr", "X-Forwarded-Host": "parquet.exemple.fr", "X-Forwarded-Proto": "https"}
        status, headers, _ = self.request("/acces", data=body, headers=tunnel)
        self.assertEqual(status, 303)
        self.assertIn("Secure", headers["Set-Cookie"])
        status, _, _ = self.request("/acces", data=body, headers={**form, "Origin": "https://autre-site.fr"})
        self.assertEqual(status, 403)

    def test_logout_and_short_codes(self):
        status, headers, _ = self.request("/acces/sortie")
        self.assertEqual(status, 303)
        self.assertIn("Max-Age=0", headers["Set-Cookie"])
        with self.assertRaises(ValueError):
            access.init("court", None)
        access.init("code-secret", self.key)


class ServerTests(unittest.TestCase):
    """Les nouvelles routes, en mode démo, dans un vrai serveur."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_get = net._get
        demo.install()
        nba.init(Cache(Path(cls.tmp.name) / "c.sqlite3"))
        settings.init(Path(cls.tmp.name) / "settings.json")
        cls.server = make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        net._get = cls.saved_get
        net.DEMO = False
        settings.init(None)
        nba.CACHE._db.close()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return json.load(r)["data"]

    def post(self, body, origin=None):
        req = urllib.request.Request(self.base + "/api/settings/youtube", data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"})
        if origin:
            req.add_header("Origin", origin)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def test_static_files_revalidate_with_etag_and_skip_cdn_cache(self):
        # Une mise à jour doit se voir au rechargement, même sur téléphone et derrière Cloudflare.
        with urllib.request.urlopen(self.base + "/js/app.js") as r:
            etag = r.headers["ETag"]
            self.assertEqual(r.headers["Cache-Control"], "no-cache")
            self.assertEqual(r.headers["Cloudflare-CDN-Cache-Control"], "no-store")
            self.assertTrue(r.read())
        self.assertTrue(etag.startswith('W/"'))
        req = urllib.request.Request(self.base + "/js/app.js", headers={"If-None-Match": etag})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 304)
        req = urllib.request.Request(self.base + "/js/app.js", headers={"If-None-Match": 'W/"ancienne"'})
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.status, 200)

    def test_game_extras_and_events(self):
        data = self.get("/api/game/0012600050/extras")
        self.assertTrue(data["page"]["recap"]["title"].startswith("Game Recap"))
        self.assertEqual(len(data["page"]["moments"]), 5)
        self.assertEqual({e["kind"] for e in data["events"]}, {"technical", "challenge", "flagrant"})

    def test_video_search_without_key(self):
        data = self.get("/api/game/0012600050/video")
        self.assertFalse(data["found"])
        self.assertFalse(data["configured"])
        self.assertIn("youtube.com/results", data["searchUrl"])

    def test_injuries_and_transactions(self):
        inj = self.get("/api/injuries")
        self.assertTrue(inj["games"])
        player = next(p for g in inj["games"] for t in g["teams"] for p in t["players"])
        self.assertIn(player["statusFr"], ("Forfait", "Peu probable", "Incertain", "Probable"))
        game = next(g for g in inj["games"] if g["gameId"])
        self.assertEqual([g["gameId"] for g in self.get(f"/api/injuries?game={game['gameId']}")["games"]], [game["gameId"]])
        moves = self.get("/api/transactions?days=0&type=Trade")
        self.assertTrue(moves["items"])
        self.assertTrue(all(m["type"] == "Trade" for m in moves["items"]))

    def test_settings_post_is_protected(self):
        status, body = self.post({"key": "AIzaSyTESTKEY1234567890abcdef"}, origin="http://evil.example")
        self.assertEqual(status, 403)
        status, body = self.post({"key": "pas une clé !"})
        self.assertEqual(status, 400)
        status, body = self.post({"key": ""})
        self.assertEqual(status, 200)
        self.assertFalse(body["data"]["youtube"]["configured"])


if __name__ == "__main__":
    unittest.main()
