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
# Photo en pied de remplacement, aux dimensions des photos « silos » (440 × 700).
FULL_BODY = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="700" viewBox="0 0 440 700">'
    '<circle cx="220" cy="80" r="56" fill="#8592a6"/><rect x="150" y="150" width="140" height="300" fill="#8592a6"/>'
    '<rect x="160" y="440" width="50" height="250" fill="#8592a6"/><rect x="230" y="440" width="50" height="250" fill="#8592a6"/></svg>'
)
BUST = '<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="760" viewBox="0 0 1040 760"><circle cx="520" cy="300" r="200" fill="#8592a6"/></svg>'


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
        # Photos en pied : un seul joueur (Zacharie Weiss en démo) en a une.
        self.context.route(
            "https://ak-static.cms.nba.com/**",
            lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=PLACEHOLDER)
            if route.request.url.endswith("/1722532.png")
            else route.fulfill(status=404, body=""),
        )
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda exc: self.errors.append(str(exc)))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], "erreurs JavaScript dans la page")

    def open(self, hash_: str):
        self.page.goto(self.base + hash_)
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_selector("main > :not(.state):not(.visually-hidden)", timeout=10000)

    def test_home_shows_games_recap_and_demo_banner(self):
        self.open("#/")
        self.assertEqual(self.page.locator(".game-tile").count(), 5)
        self.assertEqual(self.page.locator(".recap").get_attribute("aria-label"), "Cette nuit en NBA")
        self.page.wait_for_selector(".night-num")
        # Accueil sans en-tête : la scène du joueur du match ouvre la page.
        self.assertFalse(self.page.locator(".topbar").is_visible())
        self.assertIn("Jolivet", self.page.text_content(".stage-name"))
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
        self.page.click(".menu-fab")
        self.page.click("#spoiler-toggle")
        self.page.wait_for_selector(".recap .spoiler-gate")
        self.assertTrue(self.page.locator(".stage-reveal").is_visible())
        self.assertEqual(self.page.locator(".stage-cutout").count(), 0)
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

    def test_home_stage_and_menu(self):
        self.open("#/matchs/2026-10-13")
        self.page.wait_for_selector(".stage-tab.is-active")
        self.assertEqual(self.page.locator(".stage-tab").count(), 4)
        first = self.page.inner_text(".stage-tab.is-active .st-name")
        # Bandeau des scores : chaque match deux fois, pour boucler sans raccord.
        self.assertEqual(self.page.locator(".ticker .tk-item").count(), 8)
        self.page.click(".stage-arrows .stage-round >> nth=1")
        self.assertNotEqual(self.page.inner_text(".stage-tab.is-active .st-name"), first)
        # L'ancien joueur sort en animation, puis disparaît de la page.
        self.assertEqual(self.page.locator(".stage .slide.is-leaving").count(), 1)
        self.page.wait_for_function("document.querySelectorAll('.stage .slide').length === 1")
        self.assertTrue(self.page.locator(".stage").evaluate("el => el.classList.contains('no-auto')"))
        # Le menu déroulant contient la recherche et les liens ; l'en-tête revient sur les autres pages.
        self.page.click(".menu-fab")
        self.page.wait_for_selector(".menu-panel.is-open #global-search")
        self.page.keyboard.press("Escape")
        self.page.wait_for_selector(".menu-panel", state="hidden")
        self.page.click(".menu-fab")
        self.page.click('.menu-link:has-text("Classement")')
        # Même grammaire sur tout le site : pas de barre, une affiche en tête, le menu flottant.
        self.page.wait_for_selector(".poster .poster-title")
        self.assertIn("Classement", self.page.text_content(".poster-title"))
        self.assertFalse(self.page.locator(".topbar").is_visible())
        self.assertEqual(self.page.locator(".menu-fab").count(), 1)
        self.assertEqual(self.page.locator(".section-index").count(), 0)

    def test_stage_uses_full_body_photo_with_portrait_fallback(self):
        self.open("#/matchs/2026-10-13")
        self.page.wait_for_selector(".stage-tab.is-active")
        layer = ".stage .slide:not(.is-leaving) .cut-layer"
        img = layer + " img"
        # Chaque joueur : la photo en pied s'il en a une, sinon son portrait (jamais de vide).
        seen = set()
        for _ in range(self.page.locator(".stage-tab").count()):
            self.page.wait_for_function(f"document.querySelector('{img}')?.complete")
            src = self.page.get_attribute(img, "src")
            cls = self.page.get_attribute(layer, "class")
            seen.add("full" if "/silos/" in src else "bust")
            if "/silos/" in src:
                self.assertIn("is-full", cls)
            else:
                self.assertIn("/headshots/", src)
                self.assertIn("is-bust", cls)
            self.page.click(".stage-arrows .stage-round >> nth=1")
            self.page.wait_for_function("document.querySelectorAll('.stage .slide').length === 1")
        self.assertEqual(seen, {"full", "bust"})

    def test_player_page_shows_portrait_and_full_body_side_by_side(self):
        self.open("#/matchs/2026-10-13")
        self.page.wait_for_selector(".stage-tab.is-active")
        # Fiche du joueur qui a une photo en pied (voir setUp) : portrait et joueur en pied.
        self.open("#/joueur/1722532")
        self.page.wait_for_selector(".player-poster .pp-face")
        self.page.wait_for_function("document.querySelector('.player-poster .pp-full')?.complete")
        self.assertEqual(self.page.locator(".player-poster .pp-full").count(), 1)
        title = self.page.locator(".player-poster .poster-title").bounding_box()
        card = self.page.locator(".player-poster .pp-card").bounding_box()
        self.assertLessEqual(title["x"] + title["width"], card["x"])  # le nom ne passe pas sous les photos
        # Un joueur sans photo en pied garde son portrait, agrandi.
        self.open("#/joueur/1722981")
        self.page.wait_for_selector(".player-poster .poster-visual.no-full")
        self.assertEqual(self.page.locator(".player-poster .pp-full").count(), 0)
        self.assertTrue(self.page.locator(".player-poster .pp-face").is_visible())

    def test_draft_page_lists_picks_filters_and_switches_view(self):
        self.open("#/draft/2003")
        self.page.wait_for_selector(".draft-row")
        rows = self.page.locator(".draft-row")
        self.assertEqual(rows.count(), 60)
        self.assertEqual(rows.first.locator(".dr-pick").text_content(), "1")
        self.assertEqual([g.text_content().split("30")[0].strip() for g in self.page.locator(".draft-group").all()], ["1er tour", "2e tour"])
        self.assertIn("2003", self.page.locator(".poster-kicker").text_content())
        # Le lien Draft figure dans le menu.
        self.assertEqual(self.page.locator(".menu-link[href='#/draft']").count(), 1)
        # Filtre par tour, puis recherche.
        self.page.click(".draft-tools .chip:text-is('2e tour')")
        self.assertEqual(rows.count(), 30)
        self.assertTrue(all(int(n) > 30 for n in rows.locator(".dr-pick").all_text_contents()))
        self.page.click(".draft-tools .chip:text-is('Tous les tours')")
        name = rows.nth(2).locator(".dr-name").text_content()
        self.page.fill(".dr-search", name.lower())
        self.page.wait_for_function("document.querySelectorAll('.draft-row').length < 60")
        self.assertIn(name, rows.locator(".dr-name").all_text_contents())
        # Année suivante, puis tous les choix d'une équipe depuis une rangée.
        self.page.fill(".dr-search", "")
        self.page.click(".dr-step:has-text('2004')")
        self.page.wait_for_function("document.querySelector('.poster-kicker')?.textContent.includes('2004')")
        self.page.locator(".draft-row a.dr-team").first.click()
        self.page.wait_for_selector(".draft-row .dr-team.is-year")
        self.assertIn("#/draft/equipe/", self.page.url)
        years = [int(g.text_content()[:4]) for g in self.page.locator(".draft-group").all()]
        self.assertEqual(years, sorted(years, reverse=True))
        # Une draft sans joueur passé en NBA s'affiche quand même.
        self.open("#/draft/2026")
        self.page.wait_for_selector(".draft-row")
        self.assertEqual(self.page.locator(".dr-future.is-none").count(), 60)
        self.assertEqual(self.errors, [])

    def test_playoff_race_page(self):
        self.open("#/classement")
        self.page.click(".poster-actions a[href='#/classement/course']")
        self.page.wait_for_selector(".race-row")
        self.assertEqual(self.page.locator(".race-row").count(), 30)
        self.assertEqual(self.page.locator(".race-cut").count(), 4)
        # Saison de démonstration terminée : tout est joué.
        self.assertEqual(self.page.locator(".rr-badge.is-in").count(), 12)
        self.assertEqual(self.page.locator(".rr-badge.is-out").count(), 10)
        self.page.click(".segmented button:has-text('Ouest')")
        self.assertEqual(self.page.locator(".race-row").count(), 15)
        self.assertIn("Conférence Ouest", self.page.text_content(".race-title"))
        self.assertEqual(self.page.locator(".menu-link[href='#/trophees']").count(), 1)

    def test_awards_race_page(self):
        self.open("#/trophees")
        self.page.wait_for_selector(".aw-block")
        self.assertEqual(self.page.locator(".aw-block").count(), 5)
        for key in ("mvp", "roy", "dpoy", "smoy", "mip"):
            self.assertGreater(self.page.locator(f"#trophee-{key} .aw-row").count(), 0, key)
        first = self.page.locator("#trophee-mvp .aw-row").first
        self.assertEqual(first.locator(".aw-share small").text_content(), "100")
        self.assertIn("Favori pour le MVP", self.page.text_content(".poster-meta"))
        self.assertIn("→", self.page.text_content("#trophee-mip .aw-row"))

    def test_records_page(self):
        self.open("#/records")
        self.page.wait_for_selector(".rc-step")
        self.assertEqual(self.page.locator(".rc-step").count(), 3)
        self.assertEqual(self.page.locator(".rc-row").count(), 47)
        self.page.click(".chip:has-text('Contres')")
        self.page.wait_for_function("document.querySelector('.rc-step-val small')?.textContent.includes('contres')")
        self.page.click(".segmented button:has-text('Playoffs')")
        self.page.wait_for_function("document.querySelector('.poster-kicker')?.textContent.includes('playoffs')")
        self.assertEqual(self.page.locator(".menu-link[href='#/records']").count(), 1)

    def test_palmares_page(self):
        self.open("#/trophees")
        self.page.click(".seg-links a[href='#/trophees/palmares']")
        self.page.wait_for_selector(".pl-season")
        self.assertGreaterEqual(self.page.locator(".pl-season").count(), 80)
        first = self.page.locator(".pl-season").first
        self.assertIn("New York Knicks", first.text_content())
        self.assertIn("Shai Gilgeous-Alexander", first.text_content())
        self.page.click(".chip:has-text('Titres par franchise')")
        self.page.wait_for_selector(".pl-title-row")
        self.assertIn("18", self.page.locator(".pl-title-row").first.text_content())
        self.page.click(".chip:text-is('MVP')")
        self.page.wait_for_selector(".pl-card")
        self.assertIn("6×", self.page.text_content(".pl-most-list"))

    def test_player_season_tab_shot_chart_and_splits(self):
        self.open("#/joueur/1722532")
        self.page.click('[role="tab"][data-tab="season"]')
        self.page.wait_for_selector(".court.heat polygon")
        self.assertGreater(self.page.locator(".court.heat polygon").count(), 30)
        self.assertEqual(self.page.locator(".ps-zone").count(), 7)
        self.page.click(".chip:has-text('Tous les tirs')")
        self.page.wait_for_selector(".court .made")
        groups = self.page.locator(".stat-table tr.group").all_text_contents()
        self.assertEqual(groups[:3], ["Forme", "Lieu", "Résultat"])
        self.assertIn("Par adversaire", groups)
        self.assertIn("2025-26", self.page.locator(".ps-tools select").input_value())

    def test_menu_fits_on_one_screen_and_marks_current_page(self):
        for width, height in ((1366, 768), (390, 740)):
            self.page.set_viewport_size({"width": width, "height": height})
            self.open("#/classement/course")
            self.page.click(".menu-fab")
            self.page.wait_for_selector(".menu-panel.is-open")
            self.page.wait_for_timeout(600)
            overflow = self.page.evaluate("(() => { const p = document.querySelector('.menu-panel'); return p.scrollHeight - p.clientHeight; })()")
            self.assertLessEqual(overflow, 0, f"le menu défile en {width}×{height}")
            self.assertEqual(self.page.locator(".menu-group").count(), 4)
            current = self.page.locator(".menu-link[aria-current]")
            self.assertEqual(current.count(), 1)
            self.assertEqual(current.get_attribute("href"), "#/classement/course")
            # Chaque lien de la barre principale figure dans le menu.
            for href in self.page.locator(".mainnav a").evaluate_all("els => els.map(a => a.getAttribute('href'))"):
                self.assertEqual(self.page.locator(f".menu-panel .menu-link[href='{href}']").count(), 1, href)
            self.page.click("label[for='theme-toggle']")
            self.assertIn(self.page.evaluate("document.documentElement.dataset.theme"), ("light", "dark"))
            self.page.keyboard.press("Escape")

    def test_status_page_deep_verification_and_browser_card(self):
        self.open("#/etat")
        self.page.wait_for_selector("#navigateur .verify-row")
        self.assertGreaterEqual(self.page.locator("#navigateur .verify-row").count(), 8)
        self.page.click("#verification .btn.primary")
        self.page.wait_for_selector("#verification .verify-row", timeout=90000)
        self.assertEqual(self.page.locator("#verification .verify-row").count(), 17)
        self.assertGreaterEqual(self.page.locator("#verification .verify-row.is-ok").count(), 16)
        self.assertTrue(self.page.locator("#verification button:has-text('Copier le rapport')").is_visible())

    # ------------------------------------------------------------ jeu « Qui est-ce ? »

    def quiz_photos(self, full=True):
        """Toutes les photos en pied répondent (ou aucune), portraits aux bonnes dimensions."""
        self.page.route(
            "https://ak-static.cms.nba.com/**",
            lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=FULL_BODY) if full else route.fulfill(status=404, body=""),
        )
        self.page.route("https://cdn.nba.com/headshots/**", lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=BUST))

    def quiz_state(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('parquet-quiz') || 'null')")

    def test_quiz_engine_rules(self):
        self.open("#/jeu")
        res = self.page.evaluate(
            """async () => {
              const Q = await import('/js/quiz.js');
              const a = Q.rng('parquet-defi-2026-11-06'), b = Q.rng('parquet-defi-2026-11-06'), c = Q.rng('autre');
              const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
              const pool = Array.from({length: 40}, (_, i) => ({id: i + 1, first: 'P', last: 'N' + i, pos: i % 2 ? 'G' : 'C', height: '6-' + (i % 12), pts: 40 - i}));
              const d = Q.distractors(pool[3], pool, Q.rng('x'));
              return {
                same: JSON.stringify(seqA) === JSON.stringify(seqB), differs: JSON.stringify(seqA) !== JSON.stringify(seqC),
                fast: Q.roundPoints({correct: true, hintsUsed: 0, ms: 1500}),
                slow: Q.roundPoints({correct: true, hintsUsed: 2, ms: 30000}),
                wrong: Q.roundPoints({correct: false, ms: 1000}),
                serie: Q.roundPoints({correct: true, ms: 1000, mode: 'serie'}),
                distractors: d.map((p) => p.id), samePos: d.every((p) => p.pos === pool[3].pos),
                hints: Q.hints({pos: 'G', height: '6-3', weight: '200', country: 'France', draftYear: 2019, draftNumber: 1, from: 2019, pts: 20, reb: 5, ast: 7, jersey: '7', teamId: 1610612738, statsTf: 'Season'}).map((h) => h.key),
                inches: Q.inches('6-11'),
              };
            }"""
        )
        self.assertTrue(res["same"])
        self.assertTrue(res["differs"])
        self.assertEqual(res["fast"], 150)
        self.assertEqual(res["slow"], 60)
        self.assertEqual(res["wrong"], 0)
        self.assertEqual(res["serie"], 1)
        self.assertEqual(len(res["distractors"]), 3)
        self.assertNotIn(4, res["distractors"])
        self.assertTrue(res["samePos"])
        self.assertEqual(res["hints"], ["gabarit", "parcours", "chiffres", "equipe"])
        self.assertEqual(res["inches"], 83)

    def test_quiz_home_lists_daily_modes_and_album(self):
        self.quiz_photos()
        self.open("#/jeu")
        self.page.wait_for_selector(".qz-daily")
        self.assertEqual(self.page.locator(".qz-mode").count(), 3)
        self.assertEqual(self.page.locator(".qz-team").count(), 30)
        self.assertEqual(self.page.locator(".qz-day").count(), 14)
        self.assertEqual(self.page.locator(".menu-link[href='#/jeu']").count(), 1)
        # Le niveau choisi est retenu.
        self.page.click(".qz-seg-btn:has-text('Expert')")
        self.assertEqual(self.quiz_state()["prefs"]["level"], "expert")
        self.page.wait_for_selector(".poster-visual.is-quiz canvas")

    def test_quiz_full_game_with_keyboard_and_results(self):
        self.quiz_photos()
        self.open("#/jeu/partie")
        for i in range(10):
            self.page.wait_for_selector(".qz-arena:not(.is-revealed) .qz-choice:not([disabled])")
            self.assertIn(f"{i + 1}/10", self.page.text_content(".qz-kicker"))
            self.page.keyboard.press("1")
            self.page.wait_for_selector(".qz-arena.is-revealed")
            # La bonne réponse est toujours montrée ; le nom révélé est le sien.
            right = self.page.locator(".qz-choice.is-right")
            self.assertEqual(right.count(), 1)
            self.assertIn(self.page.text_content(".qz-name").strip(), right.text_content())
            self.assertIn(f"{i + 1}/10", self.page.text_content(".qz-kicker"))
            self.page.keyboard.press("Enter")
        self.page.wait_for_selector(".qz-results")
        self.assertEqual(self.page.locator(".qz-card").count(), 10)
        state = self.quiz_state()
        self.assertEqual(state["rounds"], 10)
        self.assertEqual(state["games"], 1)
        hits = self.page.locator(".qz-card.is-hit").count()
        self.assertEqual(state["correct"], hits)
        self.assertEqual(len(state["found"]), hits)

    def test_quiz_daily_is_identical_and_played_once(self):
        def first_round(ctx_page):
            ctx_page.wait_for_selector(".qz-choice:not([disabled])")
            names = ctx_page.locator(".qz-choice span").all_text_contents()
            ctx_page.click(".qz-choice >> nth=0")
            ctx_page.wait_for_selector(".qz-arena.is-revealed")
            return names, ctx_page.text_content(".qz-name")

        self.quiz_photos()
        self.open("#/jeu/defi")
        mine = first_round(self.page)
        # Un autre navigateur, sans historique : même joueur, mêmes choix, dans le même ordre.
        other_ctx = self.browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        other_ctx.route("https://ak-static.cms.nba.com/**", lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=FULL_BODY))
        other_ctx.route("https://cdn.nba.com/**", lambda route: route.fulfill(status=200, content_type="image/svg+xml", body=BUST))
        other = other_ctx.new_page()
        other.goto(self.base + "#/jeu/defi")
        self.assertEqual(first_round(other), mine)
        other_ctx.close()
        for _ in range(4):
            self.page.click(".qz-next")
            self.page.wait_for_selector(".qz-arena:not(.is-revealed) .qz-choice:not([disabled])")
            self.page.click(".qz-choice >> nth=1")
            self.page.wait_for_selector(".qz-arena.is-revealed")
        self.assertEqual(self.page.text_content(".qz-next"), "Voir le bilan")
        self.page.click(".qz-next")
        self.page.wait_for_selector(".qz-results")
        self.assertEqual(self.page.locator(".qz-res-marks .qz-mark").count(), 5)
        # Une seule tentative par jour : on retombe sur le bilan.
        self.open("#/jeu")
        self.page.wait_for_selector(".qz-daily.is-done")
        self.open("#/jeu/defi")
        self.page.wait_for_selector(".qz-results")
        self.assertIn("déjà joué", self.page.text_content(".qz-results"))
        self.assertEqual(self.page.locator(".qz-choice").count(), 0)

    def test_quiz_typing_mode_hints_and_skip(self):
        self.context.add_init_script("localStorage.setItem('parquet-quiz', JSON.stringify({v: 1, prefs: {level: 'expert', answer: 'saisie'}}))")
        self.quiz_photos()
        self.open("#/jeu/partie")
        self.page.wait_for_selector(".qz-input")
        self.assertIn("3 essais", self.page.text_content(".qz-tries"))
        # Indice payant à la main.
        self.page.click(".qz-hint-btn")
        self.assertEqual(self.page.locator(".qz-hint").count(), 1)
        # Mauvaise réponse tapée : un essai en moins et un indice offert.
        self.page.fill(".qz-input", "a")
        self.page.fill(".qz-input", "an")
        self.page.wait_for_selector(".qz-suggest li")
        options = self.page.locator(".qz-suggest li").all_text_contents()
        revealed_name = None
        for idx, _ in enumerate(options):
            self.page.fill(".qz-input", "an")
            self.page.wait_for_selector(".qz-suggest li")
            for _ in range(idx):
                self.page.keyboard.press("ArrowDown")
            self.page.keyboard.press("Enter")
            if self.page.locator(".qz-arena.is-revealed").count():
                revealed_name = True
                break
            if self.page.locator(".qz-tries").text_content().startswith("2"):
                break
        if not revealed_name:
            self.assertIn("2 essais", self.page.text_content(".qz-tries"))
            self.assertEqual(self.page.locator(".qz-hint").count(), 2)
            self.page.click(".qz-skip")
            self.page.wait_for_selector(".qz-arena.is-wrong")
            self.assertIn("Passé", self.page.text_content(".qz-points"))
            self.assertIn("C'était", self.page.text_content(".qz-verdict"))

    def test_quiz_falls_back_to_portraits_without_full_body_photos(self):
        self.quiz_photos(full=False)
        self.open("#/jeu/partie")
        self.page.wait_for_selector(".qz-frame.is-bust", timeout=20000)
        self.page.wait_for_selector(".qz-choice:not([disabled])")

    def test_quiz_chrono_runs_clock_and_chains_players(self):
        self.quiz_photos()
        self.open("#/jeu/chrono")
        self.page.wait_for_selector(".qz-choice:not([disabled])")
        self.assertTrue(self.page.locator(".qz-clock").is_visible())
        self.assertFalse(self.page.locator(".qz-hint-btn").is_visible())
        first = self.page.locator(".qz-choice span").all_text_contents()
        self.page.keyboard.press("2")
        # Pas de bouton « suivant » : le joueur suivant arrive tout seul.
        self.page.wait_for_function(
            "(prev) => { const n = [...document.querySelectorAll('.qz-arena:not(.is-revealed) .qz-choice span')].map(e => e.textContent); return n.length === 4 && n.join() !== prev; }",
            arg=",".join(first),
            timeout=5000,
        )
        self.assertTrue(self.page.locator(".qz-next").is_hidden())

    def test_outdated_server_shows_restart_notice(self):
        # Fenêtre de Parquet jamais refermée après une mise à jour : le serveur répond encore
        # avec l'ancienne version, l'interface le signale.
        def old_status(route):
            route.fulfill(status=200, content_type="application/json", body='{"data":{"version":"1.5.0","demo":true},"meta":{}}')

        self.page.route("**/api/status", old_status)
        self.open("#/draft")
        notice = self.page.wait_for_selector(".update-notice")
        self.assertIn("1.5.0", notice.text_content())
        self.assertIn("relance", notice.text_content())
        self.page.click(".update-close")
        self.assertEqual(self.page.locator(".update-notice").count(), 0)

    def test_current_server_shows_no_notice(self):
        self.open("#/")
        self.page.wait_for_timeout(400)
        self.assertEqual(self.page.locator(".update-notice").count(), 0)

    def test_motion_toggle_overrides_system_setting(self):
        # Windows peut demander aux sites de limiter les animations : le bouton passe outre.
        self.page.emulate_media(reduced_motion="reduce")
        try:
            self.open("#/equipes")
            root = "document.documentElement.dataset.motion"
            self.assertEqual(self.page.evaluate(root), "reduce")
            self.page.click(".menu-fab")
            self.page.click("#motion-toggle")
            self.assertEqual(self.page.evaluate(root), "full")
            self.open("#/equipes")  # le choix est retenu au rechargement
            self.assertEqual(self.page.evaluate(root), "full")
            self.page.click(".menu-fab")
            self.page.click("#motion-toggle")
            self.assertEqual(self.page.evaluate(root), "reduce")
        finally:
            self.page.evaluate("localStorage.removeItem('parquet-motion')")
            self.page.emulate_media(reduced_motion="no-preference")

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

    def test_team_month_calendar(self):
        self.open("#/equipe/1610612738")
        self.page.click('[role="tab"][data-tab="schedule"]')
        self.page.wait_for_selector(".cal-grid")
        self.assertEqual(self.page.locator(".cal-head [role=columnheader]").count(), 7)
        self.assertGreater(self.page.locator(".cal-game").count(), 0)
        # Chaque match terminé affiche un V (victoire) ou un D (défaite) et le score.
        for badge in self.page.locator(".cal-game.is-w .cal-wl, .cal-game.is-l .cal-wl").all():
            self.assertIn(badge.inner_text(), ("V", "D"))
        first = self.page.inner_text(".cal-title")
        self.page.locator(".cal-months .chip").last.click()
        self.assertNotEqual(self.page.inner_text(".cal-title"), first)
        self.assertTrue(self.page.locator(".cal-nav[aria-label='Mois suivant']").is_disabled())
        self.page.click('.segmented button:has-text("À venir")')
        self.page.wait_for_selector(".sched-row")

    def test_game_videos_events_and_keys(self):
        self.open("#/match/0012600050")
        self.page.wait_for_selector(".events")
        self.assertEqual(self.page.locator(".events .event").count(), 3)
        self.assertGreaterEqual(self.page.locator(".key-line").count(), 2)
        self.page.click('[role="tab"][data-tab="videos"]')
        self.page.wait_for_selector(".moments")
        self.assertEqual(self.page.locator(".moment").count(), 5)
        self.assertTrue(self.page.locator(".nba-recap").is_visible())
        href = self.page.locator("a.btn", has_text="Chercher sur YouTube").get_attribute("href")
        self.assertTrue(href.startswith("https://www.youtube.com/results?search_query="))

    def test_pregame_injuries(self):
        self.open("#/match/0012600053")
        self.page.wait_for_selector(".pregame-team")
        self.assertGreater(self.page.locator(".inj-status").count(), 0)

    def test_infos_injuries_and_transactions(self):
        self.open("#/infos")
        self.page.wait_for_selector(".inj-game")
        self.page.click('.segmented button:has-text("Transactions")')
        self.page.wait_for_selector(".move-row")
        self.assertIn("#/infos/mouvements", self.page.url)
        self.page.click('.chips button:has-text("Échanges")')
        self.page.wait_for_selector(".move-type.trade")
        self.assertEqual(self.page.locator(".move-type").count(), self.page.locator(".move-type.trade").count())

    def test_team_tabs_do_not_mix(self):
        self.page.goto(self.base + "#/equipe/1610612741")
        # Changement d'onglet immédiat, avant la fin du chargement de l'effectif.
        self.page.click('[role="tab"][data-tab="news"]')
        self.page.wait_for_selector(".move-row")
        self.page.wait_for_load_state("networkidle")
        self.assertEqual(self.page.locator("main .stat-table").count(), 0, "l'effectif ne doit pas s'afficher dans l'onglet Infirmerie")

    def test_youtube_key_form(self):
        self.open("#/etat")
        self.page.wait_for_selector(".key-form")
        self.page.fill(".key-form input", "pas une clé")
        self.page.click(".key-form button")
        self.page.wait_for_function("document.querySelector('.form-msg').textContent.includes('format')")

    def test_multi_game_view(self):
        self.open("#/multi")
        self.page.wait_for_selector(".multi-panel")
        self.assertEqual(self.page.locator(".multi-panel").count(), 2)

    def test_no_horizontal_scroll_on_phone(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        for hash_ in ("#/", "#/playoffs", "#/multi", "#/infos", "#/infos/mouvements", f"#/joueur/{STAR}", "#/match/0012600050", "#/classement"):
            self.open(hash_)
            width = self.page.evaluate("document.documentElement.scrollWidth")
            self.assertLessEqual(width, 390, f"la page {hash_} déborde sur téléphone")
        self.open("#/equipe/1610612738")
        self.page.click('[role="tab"][data-tab="schedule"]')
        self.page.wait_for_selector(".cal-grid")
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390, "le calendrier déborde sur téléphone")


if __name__ == "__main__":
    unittest.main()
