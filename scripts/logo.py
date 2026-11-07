"""Logo de Parquet : vectorise les images sources de design/logo/ et génère les fichiers de web/img/.

Les sources sont des images (JPG) en trois couleurs : un fond uni, l'encre des lettres (crème ou noir)
et l'orange des accents. Chaque couleur devient un calque vectoriel (contours de la zone, trous
compris), ce qui donne des SVG nets à toutes les tailles et dont les couleurs suivent le thème :
- les lettres sont en `currentColor` (la couleur du texte autour) ;
- l'orange est en `var(--accent)` (l'orange du thème), avec l'orange sombre en valeur de secours.

Fichiers produits dans web/img/ :
- logo.svg            symbole « parquet-logo » (mot + étoile + élan) pour l'en-tête et le menu ;
- logo-complet.svg    grand logo (avec le cercle) pour la page du code d'accès, couleurs suivant le thème ;
- icon.svg            icône de l'onglet (P + étoile sur fond sombre arrondi) ;
- icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png  icônes de l'appli ;
- badge-96.png        silhouette blanche pour les notifications Android.

python3 scripts/logo.py   (OpenCV, NumPy et Pillow, déjà présents avec les outils de test)
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "logo"
IMG = ROOT / "web" / "img"

BG_DARK = (19, 20, 22)
CREAM = (240, 237, 230)
ORANGE = (255, 112, 25)
ACCENT = "var(--accent, #ff7a1a)"


def load(name: str, box: tuple[int, int, int, int] | None = None) -> np.ndarray:
    im = Image.open(SRC / name).convert("RGB")
    if box:
        im = im.crop(box)
    return np.asarray(im).astype(np.int32)


def layers(rgb: np.ndarray, palette: dict[str, tuple[int, int, int]]) -> dict[str, np.ndarray]:
    """Chaque pixel prend la couleur la plus proche de la palette (après un léger lissage du JPG)."""
    smooth = cv2.GaussianBlur(rgb.astype(np.uint8), (5, 5), 0).astype(np.int32)
    names = list(palette)
    dist = np.stack([((smooth - np.array(palette[n])) ** 2).sum(axis=2) for n in names])
    nearest = dist.argmin(axis=0)
    masks = {}
    for i, n in enumerate(names):
        m = (nearest == i).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        masks[n] = clean(m)
    return masks


def clean(mask: np.ndarray, min_area: int = 120) -> np.ndarray:
    """Retire les petites taches isolées (bruit du JPG)."""
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros_like(mask)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[labels == i] = 255
    return keep


def under(accent: np.ndarray, ink: np.ndarray, px: int = 4) -> np.ndarray:
    """Prolonge l'orange sous les lettres : pas de liseré de fond entre les deux calques."""
    grown = cv2.dilate(accent, np.ones((2 * px + 1, 2 * px + 1), np.uint8))
    return accent | (grown & ink)


def path(mask: np.ndarray, scale: float, ox: float, oy: float, eps: float = 0.9) -> str:
    contours, _ = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in contours:
        if cv2.contourArea(c) < 40:
            continue
        c = cv2.approxPolyDP(c, eps, True)
        pts = [((x - ox) * scale, (y - oy) * scale) for [[x, y]] in c]
        parts.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts) + "Z")
    return "".join(parts)


def bbox(*masks: np.ndarray, margin: int = 0) -> tuple[int, int, int, int]:
    union = np.zeros_like(masks[0])
    for m in masks:
        union |= m
    ys, xs = np.nonzero(union)
    return xs.min() - margin, ys.min() - margin, xs.max() + margin, ys.max() + margin


def vector(rgb, palette, ink_key, accent_key, width=1000.0, margin=6):
    m = layers(rgb, palette)
    ink, acc = m[ink_key], m[accent_key]
    acc = under(acc, ink)
    x0, y0, x1, y1 = bbox(ink, acc, margin=margin)
    scale = width / (x1 - x0)
    w, h = width, (y1 - y0) * scale
    return path(acc, scale, x0, y0), path(ink, scale, x0, y0), w, h, (ink, acc)


def write(name: str, text: str) -> None:
    (IMG / name).write_text(text, encoding="utf-8")
    print(f"{name:24} {len(text) // 1024} Ko")


def main() -> None:
    # 1. Logo de l'en-tête : moitié sombre de la planche « deux thèmes » (mot, étoile, élan).
    head = load("entete-deux-themes.jpg", (0, 0, 2064, 1024))
    acc, ink, w, h, _ = vector(head, {"bg": BG_DARK, "ink": CREAM, "acc": ORANGE}, "ink", "acc")
    write("logo.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}">
<symbol id="parquet-logo" viewBox="0 0 {w:.0f} {h:.0f}">
<path fill="{ACCENT}" fill-rule="evenodd" d="{acc}"/>
<path fill="currentColor" fill-rule="evenodd" d="{ink}"/>
</symbol>
<use href="#parquet-logo" color="#f3f2ef"/>
</svg>
''')

    # 2. Grand logo (avec le cercle), pour la page du code d'accès.
    full = load("logo-sombre.jpg")
    acc, ink, w, h, _ = vector(full, {"bg": BG_DARK, "ink": CREAM, "acc": ORANGE}, "ink", "acc")
    write("logo-complet.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}">
<style>.i{{fill:#f3f2ef}}.a{{fill:#ff7a1a}}@media (prefers-color-scheme: light){{.i{{fill:#141518}}.a{{fill:#c2410c}}}}</style>
<path class="a" fill-rule="evenodd" d="{acc}"/>
<path class="i" fill-rule="evenodd" d="{ink}"/>
</svg>
''')

    # 3. Icône de l'onglet : le P et l'étoile, sur une tuile sombre arrondie (lisible sur tout navigateur).
    fav = load("favicon.jpg")
    m = layers(fav, {"bg": BG_DARK, "ink": CREAM, "acc": ORANGE})
    ink, acc = m["ink"], under(m["acc"], m["ink"])
    x0, y0, x1, y1 = bbox(ink, acc)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    scale = 52 / side  # le dessin occupe 52 unités de la tuile de 64
    ox, oy = cx - 32 / scale, cy - 32 / scale
    write("icon.svg", f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#0f1113"/>
<path fill="#ff7a1a" fill-rule="evenodd" d="{path(acc, scale, ox, oy, 1.4)}"/>
<path fill="#f3f2ef" fill-rule="evenodd" d="{path(ink, scale, ox, oy, 1.4)}"/>
</svg>
''')

    # 4. Icônes de l'appli : le P dans le cercle et l'étoile, sur fond sombre plein.
    app = Image.open(SRC / "icone-appli.jpg").convert("RGB")
    bg = Image.new("RGB", (2048, 2048), BG_DARK)

    def tile(size: int, content: float, rounded: bool) -> Image.Image:
        inner = app.resize((round(size * content),) * 2, Image.LANCZOS)
        out = bg.resize((size, size))
        out.paste(inner, ((size - inner.width) // 2, (size - inner.height) // 2))
        if not rounded:
            return out
        mask = Image.new("L", (size * 4, size * 4), 0)
        from PIL import ImageDraw

        ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=size * 4 * 14 // 64, fill=255)
        rgba = out.convert("RGBA")
        rgba.putalpha(mask.resize((size, size), Image.LANCZOS))
        return rgba

    tile(192, 1.0, True).save(IMG / "icon-192.png", optimize=True)
    tile(512, 1.0, True).save(IMG / "icon-512.png", optimize=True)
    tile(180, 1.0, False).save(IMG / "apple-touch-icon.png", optimize=True)
    # Android découpe les icônes « maskable » en cercle ou en goutte : on garde de la marge.
    tile(512, 0.8, False).save(IMG / "icon-maskable-512.png", optimize=True)

    # 5. Badge des notifications : silhouette blanche sur fond transparent.
    mono = load("monochrome.jpg")
    white = layers(mono, {"bg": BG_DARK, "w": (255, 255, 255)})["w"]
    x0, y0, x1, y1 = bbox(white, margin=60)
    side = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    crop = white[max(cy - side // 2, 0): cy + side // 2, max(cx - side // 2, 0): cx + side // 2]
    alpha = Image.fromarray(crop).resize((96, 96), Image.LANCZOS)
    badge = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
    badge.putalpha(alpha)
    badge.save(IMG / "badge-96.png", optimize=True)
    for n in ("icon-192.png", "icon-512.png", "apple-touch-icon.png", "icon-maskable-512.png", "badge-96.png"):
        print(f"{n:24} {(IMG / n).stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
