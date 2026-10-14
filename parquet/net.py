"""Accès réseau : NBA.com (flux live et stats) et Wikipédia / Wikidata.

Les flux de NBA.com ne sont pas une API publique documentée. On se présente donc comme
le site nba.com lui-même (mêmes en-têtes qu'une requête faite depuis www.nba.com),
on limite la cadence des appels et on prévoit un second jeu d'en-têtes en secours.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import requests

CHROME = "146"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    f"(KHTML, like Gecko) Chrome/{CHROME}.0.0.0 Safari/537.36"
)

# En-têtes d'une requête faite par le site www.nba.com (ce qui fonctionne dans un navigateur).
SITE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "Origin": "https://www.nba.com",
    "Referer": "https://www.nba.com/",
    "Sec-Ch-Ua": f'"Chromium";v="{CHROME}", "Google Chrome";v="{CHROME}", "Not:A-Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
}

# Jeu de secours : les en-têtes utilisés par la bibliothèque open source nba_api.
NBA_API_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Referer": "https://www.nba.com/",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Sec-Ch-Ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Fetch-Dest": "empty",
}

WIKI_HEADERS = {
    "User-Agent": "Parquet/1.0 (tableau de bord NBA personnel; python-requests)",
    "Accept": "application/json",
    "Accept-Encoding": "gzip, deflate",
}

CDN_BASE = "https://cdn.nba.com/static/json"
STATS_BASE = "https://stats.nba.com/stats"


class SourceError(Exception):
    """Une source distante n'a pas répondu correctement."""

    def __init__(self, message: str, status: int | None = None, source: str = ""):
        super().__init__(message)
        self.status = status
        self.source = source


class NotAvailable(SourceError):
    """La ressource n'existe pas (encore) : box score d'un match pas commencé, etc."""


_local = threading.local()


def _session() -> requests.Session:
    session = getattr(_local, "session", None)
    if session is None:
        session = requests.Session()
        _local.session = session
    return session


# Cadence des appels à stats.nba.com : deux requêtes simultanées au plus,
# et un léger espacement entre deux départs pour ne pas être bridé.
_stats_slots = threading.BoundedSemaphore(2)
_stats_spacing_lock = threading.Lock()
_stats_last_start = [0.0]
STATS_MIN_SPACING = 0.35


def _space_stats_calls() -> None:
    with _stats_spacing_lock:
        wait = STATS_MIN_SPACING - (time.monotonic() - _stats_last_start[0])
        if wait > 0:
            time.sleep(wait)
        _stats_last_start[0] = time.monotonic()


def _get(url: str, params: dict | None, headers: dict, timeout: tuple[float, float], source: str) -> Any:
    try:
        response = _session().get(url, params=params, headers=headers, timeout=timeout)
    except requests.exceptions.Timeout as exc:
        raise SourceError(f"{source} met trop de temps à répondre", source=source) from exc
    except requests.exceptions.RequestException as exc:
        raise SourceError(f"{source} est injoignable ({exc.__class__.__name__})", source=source) from exc

    if response.status_code in (403, 404) and source == "cdn.nba.com":
        # Sur le CDN, 403 signifie le plus souvent « fichier pas encore publié »
        # (box score d'un match qui n'a pas commencé).
        raise NotAvailable(f"{source} : ressource pas encore disponible", status=response.status_code, source=source)
    if response.status_code != 200:
        raise SourceError(f"{source} a répondu {response.status_code}", status=response.status_code, source=source)
    try:
        return response.json()
    except ValueError as exc:
        raise SourceError(f"{source} a renvoyé une réponse illisible", source=source) from exc


def cdn_json(path: str) -> Any:
    """Fichier JSON du CDN de NBA.com (scoreboard live, box scores, play-by-play, calendrier)."""
    url = f"{CDN_BASE}/{path}"
    try:
        return _get(url, None, SITE_HEADERS, (6, 15), "cdn.nba.com")
    except NotAvailable:
        raise
    except SourceError:
        # Second essai avec un autre jeu d'en-têtes.
        return _get(url, None, NBA_API_HEADERS, (6, 15), "cdn.nba.com")


def stats_json(endpoint: str, params: dict) -> Any:
    """Endpoint de stats.nba.com. Les paramètres sont triés (l'API y est sensible)."""
    url = f"{STATS_BASE}/{endpoint}"
    ordered = dict(sorted(params.items(), key=lambda kv: kv[0]))
    last_error: SourceError | None = None
    for headers in (SITE_HEADERS, NBA_API_HEADERS):
        with _stats_slots:
            _space_stats_calls()
            try:
                return _get(url, ordered, headers, (6, 25), "stats.nba.com")
            except SourceError as exc:
                last_error = exc
                if exc.status == 400:
                    # Paramètres refusés : inutile de réessayer.
                    break
    assert last_error is not None
    raise last_error


def wiki_json(url: str, params: dict) -> Any:
    return _get(url, params, WIKI_HEADERS, (6, 12), "Wikipédia")


def result_sets(payload: Any) -> dict[str, list[dict]]:
    """Transforme la réponse classique de stats.nba.com en {nom: [lignes sous forme de dict]}."""
    out: dict[str, list[dict]] = {}
    if not isinstance(payload, dict):
        return out
    sets = payload.get("resultSets")
    if sets is None:
        sets = payload.get("resultSet")
    if isinstance(sets, dict):
        sets = [sets]
    for rs in sets or []:
        if not isinstance(rs, dict):
            continue
        headers = rs.get("headers") or []
        rows = rs.get("rowSet") or []
        out[rs.get("name", "")] = [dict(zip(headers, row)) for row in rows]
    return out
