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


def placeholder(route):
    url = route.request.url
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
            return ctx

        def shot(page, name, hash_, *, before=None, scroll=0, full=False, clip=None, element=None):
            page.goto(base + hash_)
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(900)
            if before:
                before(page)
                page.wait_for_timeout(700)
            if scroll:
                page.evaluate(f"window.scrollTo(0, {scroll})")
                page.wait_for_timeout(300)
            if not (before and getattr(before, "keeps_pointer", False)):
                page.mouse.move(2, 2)
            if element:
                page.locator(element).screenshot(path=str(OUT / name))
                print("capture", name)
                return
            page.screenshot(path=str(OUT / name), full_page=full, clip=clip)
            print("capture", name)

        page = context().new_page()
        shot(page, "01-matchs.png", "#/")
        shot(page, "02-resume-de-la-nuit.png", "#/matchs/2026-10-13", element=".recap")

        def hover_flow(p):
            p.wait_for_selector(".flow-chart")
            top = p.evaluate("document.querySelector('.flow-chart').closest('.section').getBoundingClientRect().top + window.scrollY")
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
        spoiler.click("#spoiler-toggle")
        shot(spoiler, "09-anti-spoiler.png", "#/")

        light = context(scheme="light").new_page()
        shot(light, "10-equipe-theme-clair.png", "#/equipe/1610612738")

        phone = context(390, 844, scale=2).new_page()
        shot(phone, "11-mobile.png", "#/")
        browser.close()
    server.shutdown()
    tmp.cleanup()


if __name__ == "__main__":
    main()
