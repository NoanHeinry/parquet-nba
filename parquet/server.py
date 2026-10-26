"""Petit serveur HTTP local : sert l'interface (dossier web/) et l'API JSON (/api/...)."""

from __future__ import annotations

import gzip
import json
import re
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from . import __version__, nba, net, teams_meta
from .net import SourceError

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

# Types MIME fixés à la main : sous Windows, le registre renvoie parfois text/plain
# pour les .js, ce qui empêche le navigateur de charger les modules.
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".txt": "text/plain; charset=utf-8",
}

Route = tuple[re.Pattern, Callable[..., tuple[Any, dict]]]
ROUTES: list[Route] = []


def route(pattern: str):
    def register(fn):
        ROUTES.append((re.compile(f"^{pattern}$"), fn))
        return fn

    return register


class Raw:
    """Réponse qui n'est pas du JSON (fichier à télécharger)."""

    def __init__(self, body: str, content_type: str, filename: str | None = None):
        self.body = body.encode("utf-8")
        self.content_type = content_type
        self.filename = filename


def _no_meta(data: Any) -> tuple[Any, dict]:
    return data, {"fetchedAt": time.time(), "stale": False}


@route(r"/api/status")
def api_status(q):
    return _no_meta(
        {"version": __version__, "season": nba.current_season(), "gameDay": nba.game_day_et().isoformat(), "demo": net.DEMO}
    )


@route(r"/api/diagnostic")
def api_diagnostic(q):
    return _no_meta(nba.diagnostic())


@route(r"/api/scoreboard")
def api_scoreboard(q):
    day = q.get("date")
    if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        day = None
    return nba.scoreboard(day)


@route(r"/api/game/(\d{10})")
def api_game(q, game_id):
    return nba.game_box(game_id)


@route(r"/api/game/(\d{10})/pbp")
def api_pbp(q, game_id):
    return nba.game_pbp(game_id)


@route(r"/api/standings")
def api_standings(q):
    return nba.standings(q.get("season"))


@route(r"/api/playoffs")
def api_playoffs(q):
    return nba.playoffs(q.get("season"))


@route(r"/api/teams")
def api_teams(q):
    if q.get("meta"):
        return _no_meta({"teams": teams_meta.TEAMS})
    return nba.teams_overview()


@route(r"/api/team/(\d+)")
def api_team(q, team_id):
    return nba.team_details(int(team_id))


@route(r"/api/team/(\d+)/roster")
def api_team_roster(q, team_id):
    return nba.team_roster(int(team_id), q.get("season"))


@route(r"/api/team/(\d+)/history")
def api_team_history(q, team_id):
    return nba.team_history(int(team_id))


@route(r"/api/team/(\d+)/schedule")
def api_team_schedule(q, team_id):
    return nba.team_schedule(int(team_id))


@route(r"/api/team/(\d+)/calendar\.ics")
def api_team_calendar(q, team_id):
    body, filename = nba.team_calendar_ics(int(team_id))
    return Raw(body, "text/calendar; charset=utf-8", filename), {}


@route(r"/api/recap")
def api_recap(q):
    day = q.get("date")
    if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        day = None
    return nba.recap(day)


@route(r"/api/team/(\d+)/bio")
def api_team_bio(q, team_id):
    return nba.team_bio(int(team_id))


@route(r"/api/players/index")
def api_player_index(q):
    return nba.player_index()


@route(r"/api/player/(\d+)")
def api_player(q, player_id):
    return nba.player_info(int(player_id))


@route(r"/api/player/(\d+)/career")
def api_player_career(q, player_id):
    return nba.player_career(int(player_id))


@route(r"/api/player/(\d+)/awards")
def api_player_awards(q, player_id):
    return nba.player_awards(int(player_id))


@route(r"/api/player/(\d+)/gamelog")
def api_player_gamelog(q, player_id):
    return nba.player_gamelog(int(player_id))


@route(r"/api/player/(\d+)/bio")
def api_player_bio(q, player_id):
    return nba.player_bio(int(player_id))


@route(r"/api/leaders")
def api_leaders(q):
    return nba.leaders(q.get("season"))


class Handler(BaseHTTPRequestHandler):
    server_version = f"Parquet/{__version__}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # silence : pas de ligne par requête
        return

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        accepts_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "")
        compressible = content_type.startswith(("application/json", "text/"))
        if accepts_gzip and compressible and len(body) > 1400:
            body = gzip.compress(body, compresslevel=5)
            extra = {**(extra or {}), "Content-Encoding": "gzip"}
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parts = urlsplit(self.path)
        path = parts.path
        if path.startswith("/api/"):
            self._api(path, {k: v[0] for k, v in parse_qs(parts.query).items()})
        else:
            self._static(path)

    def _api(self, path: str, query: dict) -> None:
        for pattern, fn in ROUTES:
            m = pattern.match(path)
            if not m:
                continue
            try:
                data, meta = fn(query, *m.groups())
                if isinstance(data, Raw):
                    extra = {"Content-Disposition": f'attachment; filename="{data.filename}"'} if data.filename else None
                    self._send(200, data.body, data.content_type, extra)
                else:
                    self._json(200, {"data": data, "meta": meta})
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return  # la page a été fermée avant la fin de la réponse
            except SourceError as exc:
                status = 404 if exc.status == 404 else 502
                self._json(status, {"error": str(exc), "source": exc.source})
            except Exception as exc:  # noqa: BLE001
                traceback.print_exc(file=sys.stderr)
                self._json(500, {"error": f"Erreur interne : {exc.__class__.__name__}"})
            return
        self._json(404, {"error": "Adresse d'API inconnue"})

    def _static(self, path: str) -> None:
        if path in ("", "/"):
            path = "/index.html"
        target = (WEB_ROOT / path.lstrip("/")).resolve()
        if WEB_ROOT not in target.parents or not target.is_file():
            self._send(404, "Page introuvable".encode("utf-8"), "text/plain; charset=utf-8")
            return
        content_type = MIME.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, target.read_bytes(), content_type)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def handle_error(self, request, client_address):
        # Un onglet fermé ou un téléphone qui se met en veille coupe la connexion en cours :
        # ce n'est pas une erreur de Parquet, inutile d'afficher une trace dans la fenêtre.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def make_server(host: str, port: int) -> Server:
    return Server((host, port), Handler)
