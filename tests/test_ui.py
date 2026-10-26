"""Tests d'interface : un vrai navigateur (Chromium, via Playwright) parcourt l'application en mode démo.

Prérequis : pip install playwright && python -m playwright install chromium
Lancer : python -m unittest tests.test_ui -v
Les tests sont ignorés si Playwright n'est pas installé.
"""

from __future__ import annotations

import os
import tempfile
import threading
import unittest
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - dépend de l'environnement
    sync_playwright = None

from parquet import demo, nba, net
from parquet.cache import Cache
from parquet.server import make_server

STAR = demo.STAR
PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#8592a6"/></svg>'


@unittest.skipIf(sync_playwright is None, "Playwright n'est pas installé")
class InterfaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_get = net._get
        demo.install()
        nba.init(Cache(Path(cls.tmp.name) / "ui.sqlite3"))
        cls.server = make_server("127.0.0.1", 0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}/"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

        cls.pw = sync_playwright().start()
        executable = os.environ.get("PARQUET_CHROMIUM") or None
        cls.browser = cls.pw.chromium.launch(executable_path=executable, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        net._get = cls.saved_get
        net.DEMO = False
        nba.CACHE._db.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        # Pas d'accès à NBA.com pendant les tests : logos et photos remplacés par une pastille.
        self.context.route("https://cdn.nba.com/**", lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=PLACEHOLDER))
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda exc: self.errors.append(str(exc)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "erreurs JavaScript dans la page")

    def open(self, hash_: str):
        self.page.goto(self.base + hash_)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_selector("main > :not(.state)", timeout=10000)

    def test_home_shows_games_recap_and_demo_banner(self):
        self.open("#/")
        self.assertEqual(self.page.locator(".game-tile").count(), 5)
        self.assertIn("Cette nuit en NBA", self.page.locator(".recap").inner_text())
        self.assertTrue(self.page.locator(".demo-banner").is_visible())
        self.assertTrue(self.page.locator("a[href='#/multi']").is_visible())

    def test_game_page_tabs_and_flow_chart(self):
        self.open("#/match/0012600050")
        self.page.wait_for_selector(".flow-chart")
        self.page.click('[role="tab"][data-tab="box"]')
        self.assertGreater(self.page.locator(".stat-table tbody tr").count(), 10)
        self.page.click('[role="tab"][data-tab="pbp"]')
        self.page.wait_for_selector(".pbp-row")
        self.page.click('[role="tab"][data-tab="shots"]')
        self.page.wait_for_selector(".court")

    def test_spoiler_mode_hides_scores_and_remembers_reveals(self):
        self.open("#/")
        self.page.click("#spoiler-toggle")
        self.page.wait_for_selector(".recap .spoiler-gate")
        first = self.page.locator(".game-tile", has=self.page.locator(".tile-reveal-btn")).first
        game_id = first.get_attribute("data-game-id")
        first.locator(".tile-reveal-btn").click()
        # La page est redessinée (comme lors d'une actualisation automatique) : le score reste révélé.
        self.page.evaluate("window.dispatchEvent(new HashChangeEvent('hashchange'))")
        self.page.wait_for_selector(f".game-tile[data-game-id='{game_id}'].is-revealed")
        # Le détail du match reste masqué tant qu'il n'est pas révélé.
        other = "0012600051" if game_id != "0012600051" else "0012600052"
        self.open(f"#/match/{other}")
        self.page.wait_for_selector(".spoiler-gate")
        self.assertEqual(self.page.locator(".stat-table").count(), 0)

    def test_playoff_series_are_collapsed(self):
        self.open("#/playoffs")
        lists = self.page.locator(".bracket-tree .matchup-games")
        self.assertGreater(lists.count(), 10)
        self.assertFalse(lists.first.is_visible())
        self.page.locator(".bracket-tree .matchup-expand-btn").first.click()
        self.assertTrue(lists.first.is_visible())

    def test_player_advanced_stats_and_comparison(self):
        self.open(f"#/joueur/{STAR}")
        self.page.click('[role="tab"][data-tab="stats"]')
        self.page.click('.segmented button:has-text("Sur 36 min")')
        self.assertIn("Adresse réelle", self.page.locator(".section").first.inner_text() + self.page.inner_text("main"))
        requests = []
        self.page.on("request", lambda r: requests.append(r.url) if "/api/player/" in r.url else None)
        self.open(f"#/comparer/{STAR}/{demo.STAR2}")
        self.page.wait_for_selector(".compare-row")
        self.assertLessEqual(len(requests), 6, "chaque fiche ne doit être chargée qu'une fois")

    def test_team_calendar_export(self):
        self.open("#/equipe/1610612738")
        self.page.click('[role="tab"][data-tab="schedule"]')
        href = self.page.locator("a[download]").get_attribute("href")
        response = self.page.request.get(self.base + href.lstrip("/"))
        self.assertEqual(response.status, 200)
        self.assertIn("text/calendar", response.headers["content-type"])
        self.assertTrue(response.text().startswith("BEGIN:VCALENDAR"))

    def test_multi_game_view(self):
        self.open("#/multi")
        self.page.wait_for_selector(".multi-panel")
        self.assertEqual(self.page.locator(".multi-panel").count(), 2)

    def test_no_horizontal_scroll_on_phone(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        for hash_ in ("#/", "#/playoffs", "#/multi", f"#/joueur/{STAR}", "#/match/0012600050", "#/classement"):
            self.open(hash_)
            width = self.page.evaluate("document.documentElement.scrollWidth")
            self.assertLessEqual(width, 390, f"la page {hash_} déborde sur téléphone")


if __name__ == "__main__":
    unittest.main()
