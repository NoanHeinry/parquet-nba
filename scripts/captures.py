"""Régénère les captures d'écran de la documentation (docs/captures/) à partir du mode démo.

    pip install playwright && python -m playwright install chromium
    python scripts/captures.py

Les logos et photos de NBA.com ne sont pas utilisés : ils sont remplacés par des pastilles
aux couleurs des équipes, pour que le dépôt ne contienne aucune image appartenant à la NBA.
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from playwright.sync_api import sync_playwright  # noqa: E402

from parquet import demo, nba, teams_meta  # noqa: E402
from parquet.cache import Cache  # noqa: E402
from parquet.server import make_server  # noqa: E402

OUT = ROOT / "docs" / "captures"
SILHOUETTE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 190">'
    '<circle cx="130" cy="78" r="44" fill="#7b8799"/><path d="M40 190c8-52 46-74 90-74s82 22 90 74z" fill="#7b8799"/></svg>'
)


FULL_BODY = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 700">'
    '<g fill="#8a8f98"><circle cx="220" cy="78" r="46"/>'
    '<path d="M150 140h140l38 190-30 8-26-120v170l24 290h-48l-28-250-28 250h-48l24-290V218l-26 120-30-8z"/></g></svg>'
)


def placeholder(route):
    url = route.request.url
    if "/silos/" in url:
        route.fulfill(status=200, content_type="image/svg+xml", body=FULL_BODY)
        return
    if "/logos/nba/" in url:
        t = teams_meta.team(url.split("/logos/nba/")[1].split("/")[0]) or {"colors": ["#888", "#ccc"], "tri": "?"}
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 150">'
            f'<circle cx="75" cy="75" r="70" fill="{t["colors"][0]}"/>'
            f'<circle cx="75" cy="75" r="58" fill="none" stroke="{t["colors"][1]}" stroke-width="6"/>'
            f'<text x="75" y="88" text-anchor="middle" font-family="Arial" font-weight="700" font-size="38" fill="#fff">{t["tri"]}</text></svg>'
        )
        route.fulfill(status=200, content_type="image/svg+xml", body=svg)
    else:
        route.fulfill(status=200, content_type="image/svg+xml", body=SILHOUETTE)


def main() -> None:
    tmp = tempfile.TemporaryDirectory()
    demo.install()
    nba.init(Cache(Path(tmp.name) / "captures.sqlite3"))
    server = make_server("127.0.0.1", 0)
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.environ.get("PARQUET_CHROMIUM") or None, args=["--no-sandbox"])

        def context(width=1360, height=860, scheme="dark", scale=1):
            ctx = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme, device_scale_factor=scale, service_workers="block")
            ctx.route("https://cdn.nba.com/**", placeholder)
            ctx.route("https://ak-static.cms.nba.com/wp-content/uploads/silos/**", placeholder)
            return ctx

        def shot(page, name, hash_, *, before=None, scroll=0, full=False, clip=None, element=None):
            page.goto(base + hash_)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(1600)  # fin des animations d'entrée
            if before:
                before(page)
                page.wait_for_timeout(700)
            if scroll:
                page.evaluate(f"window.scrollTo(0, {scroll})")
                page.wait_for_timeout(900)
            if not (before and getattr(before, "keeps_pointer", False)):
                page.mouse.move(2, 2)
            if element:
                page.locator(element).screenshot(path=str(OUT / name))
                print("capture", name)
                return
            page.screenshot(path=str(OUT / name), full_page=full, clip=clip)
            print("capture", name)

        def go_to(selector, offset=0):
            def run(p):
                p.wait_for_selector(selector)
                top = p.evaluate(f"document.querySelector('{selector}').getBoundingClientRect().top + window.scrollY")
                p.evaluate(f"window.scrollTo(0, {top} - {offset})")
                p.wait_for_timeout(1400)  # apparition de la section
            return run

        page = context().new_page()
        shot(page, "01-accueil.png", "#/matchs/2026-10-13", before=lambda p: p.wait_for_timeout(1200))
        shot(page, "02-matchs.png", "#/", before=go_to("#matchs", -20))
        shot(page, "16-chiffres-de-la-nuit.png", "#/matchs/2026-10-13", before=go_to("#chiffres", -20))
        shot(page, "17-menu.png", "#/", before=lambda p: p.click(".menu-fab"))

        def hover_flow(p):
            p.wait_for_selector(".flow-chart")
            top = p.evaluate("(e => (e.closest('.section') || e).getBoundingClientRect())(document.querySelector('.flow-chart')).top + window.scrollY")
            p.evaluate(f"window.scrollTo(0, {top} - 90)")
            p.wait_for_timeout(300)
            box = p.locator(".flow-chart").bounding_box()
            p.mouse.move(box["x"] + box["width"] * 0.47, box["y"] + box["height"] * 0.45)

        hover_flow.keeps_pointer = True
        shot(page, "03-scenario-du-match.png", "#/match/0012600050", before=hover_flow)
        shot(page, "04-carte-des-tirs.png", "#/match/0012600050", before=lambda p: p.click('[role="tab"][data-tab="shots"]'), scroll=330)
        shot(page, "05-multi-matchs.png", "#/multi")
        shot(page, "06-playoffs.png", "#/playoffs")
        shot(page, "07-fiche-joueur.png", f"#/joueur/{demo.STAR}", before=lambda p: p.click('[role="tab"][data-tab="stats"]'), scroll=640)
        shot(page, "08-comparateur.png", f"#/comparer/{demo.STAR}/{demo.STAR2}", scroll=380)

        spoiler = context().new_page()
        spoiler.goto(base + "#/")
        spoiler.wait_for_load_state("networkidle")
        spoiler.click(".menu-fab")
        spoiler.click("#spoiler-toggle")
        shot(spoiler, "09-anti-spoiler.png", "#/", before=go_to("#matchs", -20))

        light = context(scheme="light").new_page()
        shot(light, "10-equipe-theme-clair.png", "#/equipe/1610612738")

        phone = context(390, 844, scale=2).new_page()
        shot(phone, "11-mobile.png", "#/matchs/2026-10-13", before=lambda p: p.wait_for_timeout(1200))

        def videos_tab(p):
            p.click('[role="tab"][data-tab="videos"]')
            p.wait_for_selector(".moments")
            top = p.evaluate("(e => (e.closest('.section') || e).getBoundingClientRect())(document.querySelector('.nba-recap')).top + window.scrollY")
            p.evaluate(f"window.scrollTo(0, {top} - 80)")

        def keys(p):
            p.click('[role="tab"][data-tab="resume"]')
            p.wait_for_selector(".events")
            top = p.evaluate("(e => (e.closest('.section') || e).getBoundingClientRect())(document.querySelector('.events')).top + window.scrollY")
            p.evaluate(f"window.scrollTo(0, {top} - 80)")

        page = context().new_page()
        shot(page, "12-videos-du-match.png", "#/match/0012600050", before=videos_tab)
        shot(page, "13-cles-du-match.png", "#/match/0012600050", before=keys)
        shot(page, "14-blessures.png", "#/infos", before=lambda p: p.wait_for_selector(".inj-game"))
        shot(page, "18-draft.png", "#/draft/2003", before=lambda p: p.wait_for_selector(".draft-row"), scroll=300)
        def quiz_hints(p):
            p.wait_for_selector(".qz-choice:not([disabled])")
            p.wait_for_timeout(700)
            p.click(".qz-hint-btn")
            p.click(".qz-hint-btn")
            p.wait_for_timeout(500)

        shot(page, "19-qui-est-ce.png", "#/jeu/partie", before=quiz_hints)
        shot(page, "15-transactions.png", "#/infos/mouvements", before=lambda p: p.wait_for_selector(".move-row"))
        browser.close()
    server.shutdown()
    tmp.cleanup()


if __name__ == "__main__":
    main()
