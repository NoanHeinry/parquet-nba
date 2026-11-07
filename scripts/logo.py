"""Logo de Parquet : un écusson biseauté (comme les contrôles de l'interface), liseré cuivré,
P à empattements, trois étoiles et un parquet à chevrons en filigrane.

Régénère les fichiers de web/img/ : python3 scripts/logo.py
(les PNG sont rendus avec Playwright et Chromium, déjà utilisés pour les tests).
"""
import math
from pathlib import Path

def octagon(x0, y0, x1, y1, c):
    return f"M{x0+c:.2f} {y0:.2f}H{x1-c:.2f}L{x1:.2f} {y0+c:.2f}V{y1-c:.2f}L{x1-c:.2f} {y1:.2f}H{x0+c:.2f}L{x0:.2f} {y1-c:.2f}V{y0+c:.2f}Z"

P = ("M21 18.5H34c6.2 0 10 3.7 10 9s-3.8 9-10 9h-3v6h2.5V46H21v-3.5h2.5V22H21Z"
     "M31 23.6v7.8h2.6c2.6 0 4.1-1.5 4.1-3.9s-1.5-3.9-4.1-3.9Z")

def mark(uid="p", tile=True, flat=False):
    o = octagon(12.5, 8.5, 51.5, 55.5, 8.5)       # liseré extérieur
    i = octagon(14.9, 10.9, 49.1, 53.1, 7.5)      # écrin
    k = octagon(17.0, 13.0, 47.0, 51.0, 6.6)      # filet intérieur
    # filigrane : chevrons (point de Hongrie) très discrets dans l'écrin
    chev = []
    for col in range(-1, 6):
        x = 14 + col * 8
        for row in range(-2, 9):
            y = 6 + row * 6
            chev.append(f"M{x} {y+4}L{x+4} {y}L{x+8} {y+4}")
    defs = f'''<defs>
  <linearGradient id="cu{uid}" x1="0" y1="0" x2=".35" y2="1">
    <stop offset="0" stop-color="#ffd2a1"/><stop offset=".22" stop-color="#ff9a45"/>
    <stop offset=".55" stop-color="#e8661a"/><stop offset=".8" stop-color="#b94a0e"/><stop offset="1" stop-color="#ff9a45"/>
  </linearGradient>
  <linearGradient id="pe{uid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffc58a"/><stop offset=".45" stop-color="#ff8a2e"/><stop offset="1" stop-color="#d9560c"/>
  </linearGradient>
  <linearGradient id="in{uid}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#23262b"/><stop offset="1" stop-color="#0c0d0f"/>
  </linearGradient>
  <radialGradient id="ti{uid}" cx=".5" cy=".3" r=".9">
    <stop offset="0" stop-color="#1f2226"/><stop offset="1" stop-color="#08090a"/>
  </radialGradient>
  <clipPath id="ck{uid}"><path d="{i}"/></clipPath>
</defs>'''
    radius = 0 if tile == "plein" else 14
    tile_svg = (f'<rect width="64" height="64" rx="{radius}" fill="url(#ti{uid})"/>'
                + (f'<rect x=".5" y=".5" width="63" height="63" rx="13.5" fill="none" stroke="#fff" stroke-opacity=".06"/>' if radius else "")) if tile else ""
    body = (
        f'<path d="{o}" fill="url(#cu{uid})"/>'
        f'<path d="{i}" fill="url(#in{uid})"/>'
        + ("" if flat else f'<g clip-path="url(#ck{uid})" fill="none" stroke="#fff" stroke-opacity=".045" stroke-width=".9">'
           + "".join(f'<path d="{d}"/>' for d in chev) + "</g>")
        + f'<path d="{k}" fill="none" stroke="url(#cu{uid})" stroke-opacity=".6" stroke-width=".55"/>'
        # ombre portée du P, puis le P cuivré, puis un fin reflet en haut
        + ("" if flat else f'<path d="{P}" fill="#000" fill-opacity=".55" fill-rule="evenodd" transform="translate(.6 1)"/>')
        + f'<path d="{P}" fill="url(#pe{uid})" fill-rule="evenodd"/>'
        + ("" if flat else f'<path d="M21.5 19.1H34c3.4 0 6 1.1 7.7 3" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".5" stroke-linecap="round"/>')
        # trois étoiles en tête de l'écusson
        + "".join(f'<path d="{star(cx, 15.6, 1.05)}" fill="url(#pe{uid})"/>' for cx in (28, 32, 36))
    )
    return defs + tile_svg + body

def star(cx, cy, r):
    pts = []
    for n in range(10):
        a = -math.pi / 2 + n * math.pi / 5
        rr = r if n % 2 == 0 else r * 0.45
        pts.append(f"{cx + rr*math.cos(a):.2f} {cy + rr*math.sin(a):.2f}")
    return "M" + "L".join(pts) + "Z"

def svg(uid="p", tile=True, size=None, flat=False):
    s = f' width="{size}" height="{size}"' if size else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"{s}>{mark(uid, tile, flat)}</svg>'


IMG = Path(__file__).resolve().parent.parent / "web" / "img"


def main() -> None:
    (IMG / "icon.svg").write_text(svg("i") + "\n", encoding="utf-8")   # onglet, page du code, icône « any »
    (IMG / "logo.svg").write_text(svg("l", tile=False) + "\n", encoding="utf-8")  # en-tête et menu
    from playwright.sync_api import sync_playwright

    renders = [("icon-192.png", 192, True), ("icon-512.png", 512, True), ("apple-touch-icon.png", 180, "plein"), ("icon-maskable-512.png", 512, "plein")]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 512, "height": 512})
        for name, size, tile in renders:
            page.set_viewport_size({"width": size, "height": size})
            page.set_content(f'<html><body style="margin:0;background:transparent">{svg("r", tile=tile, size=size)}</body></html>')
            page.locator("svg").screenshot(path=str(IMG / name), omit_background=True)
        browser.close()


if __name__ == "__main__":
    main()
