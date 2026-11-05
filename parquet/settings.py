"""Réglages de l'utilisateur, gardés dans data/settings.json (dossier local, jamais publié).

Pour l'instant, un seul réglage : la clé de l'API YouTube, qui permet de retrouver le résumé
vidéo officiel de n'importe quel match. Elle peut aussi venir de la variable d'environnement
PARQUET_YOUTUBE_KEY, prioritaire.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

ENV_YOUTUBE = "PARQUET_YOUTUBE_KEY"

_path: Path | None = None
_lock = threading.Lock()


def init(path: Path | None) -> None:
    global _path
    _path = path


def load() -> dict:
    if _path is None or not _path.is_file():
        return {}
    try:
        data = json.loads(_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save(changes: dict) -> dict:
    """Fusionne les changements (une valeur vide supprime la clé) et enregistre le fichier."""
    if _path is None:
        raise RuntimeError("emplacement des réglages non défini")
    with _lock:
        data = load()
        for key, value in changes.items():
            if value in (None, ""):
                data.pop(key, None)
            else:
                data[key] = value
        _path.parent.mkdir(parents=True, exist_ok=True)
        tmp = _path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)  # la clé reste lisible par son seul propriétaire
        except OSError:
            pass
        tmp.replace(_path)
        return data


def youtube_key() -> tuple[str, str]:
    """(clé, origine) : origine vaut "env", "file" ou "" quand aucune clé n'est réglée."""
    env = (os.environ.get(ENV_YOUTUBE) or "").strip()
    if env:
        return env, "env"
    key = str(load().get("youtubeKey") or "").strip()
    return (key, "file") if key else ("", "")


def youtube_status() -> dict:
    key, source = youtube_key()
    return {"configured": bool(key), "source": source, "hint": f"…{key[-4:]}" if len(key) >= 8 else ""}
