"""Photos de joueurs choisies par l'utilisateur.

Elles remplacent, dans toute l'application, la photo officielle d'un joueur. Elles restent sur le
serveur qui héberge Parquet (dossier data/, jamais publié sur GitHub) : les photos appartiennent à
leurs auteurs, chacun choisit les siennes pour son propre usage.

Une photo = un fichier « <identifiant du joueur>.<jpg|png|webp> ». Le navigateur l'a déjà
réduite (au plus 1200 pixels de côté) avant l'envoi ; le serveur vérifie seulement qu'il s'agit
bien d'une image et que sa taille reste raisonnable.
"""

from __future__ import annotations

import ipaddress
import os
import threading
from pathlib import Path

MAX_BYTES = 3 * 1024 * 1024
TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

DIR: Path | None = None
_lock = threading.Lock()


def init(directory: Path) -> None:
    global DIR
    DIR = Path(directory)


def kind_of(body: bytes) -> str | None:
    """Format réel de l'image d'après ses premiers octets (pas d'après ce qu'annonce l'envoi)."""
    if body[:3] == b"\xff\xd8\xff":
        return "jpg"
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "webp"
    return None


def _valid_id(player_id: str) -> bool:
    return player_id.isdigit() and 0 < len(player_id) <= 12


def _files(player_id: str) -> list[Path]:
    if DIR is None or not _valid_id(player_id):
        return []
    return [p for p in (DIR / f"{player_id}.{ext}" for ext in TYPES) if p.is_file()]


def listing() -> dict[str, int]:
    """{identifiant du joueur: version} ; la version change à chaque nouvelle photo."""
    out: dict[str, int] = {}
    if DIR is None or not DIR.is_dir():
        return out
    for p in DIR.iterdir():
        stem, _, ext = p.name.partition(".")
        if ext in TYPES and _valid_id(stem):
            out[stem] = int(p.stat().st_mtime)
    return out


def read(player_id: str) -> tuple[bytes, str] | None:
    files = _files(player_id)
    if not files:
        return None
    path = files[0]
    return path.read_bytes(), TYPES[path.suffix.lstrip(".")]


def save(player_id: str, body: bytes) -> int:
    """Enregistre la photo ; renvoie sa version. ValueError si ce n'est pas une image acceptée."""
    if DIR is None:
        raise RuntimeError("stockage des photos non initialisé")
    if not _valid_id(player_id):
        raise ValueError("Joueur inconnu.")
    if not body or len(body) > MAX_BYTES:
        raise ValueError("La photo doit peser moins de 3 Mo.")
    kind = kind_of(body)
    if kind is None:
        raise ValueError("Ce fichier n'est pas une image JPEG, PNG ou WebP.")
    with _lock:
        DIR.mkdir(parents=True, exist_ok=True)
        for old in _files(player_id):
            old.unlink()
        target = DIR / f"{player_id}.{kind}"
        tmp = target.with_suffix(".tmp")
        tmp.write_bytes(body)
        os.replace(tmp, target)
    return int(target.stat().st_mtime)


def remove(player_id: str) -> bool:
    with _lock:
        files = _files(player_id)
        for p in files:
            p.unlink()
    return bool(files)


def may_edit(client_ip: str, headers, code_enabled: bool) -> bool:
    """Qui peut changer les photos (elles s'affichent pour tous les visiteurs) ?

    - avec un code d'accès : toute personne qui a le code (la requête est déjà passée par le contrôle) ;
    - sans code : seulement depuis la machine elle-même ou le réseau de la maison, pas depuis Internet.
    """
    if code_enabled:
        return True
    if any(headers.get(h) for h in ("CF-Connecting-IP", "X-Forwarded-For", "X-Forwarded-Proto", "CF-Visitor")):
        return False  # arrivée par un tunnel (Cloudflare…) : visiteur venu d'Internet
    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private
