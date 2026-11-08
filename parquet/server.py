"""Petit serveur HTTP local : sert l'interface (dossier web/) et l'API JSON (/api/...)."""

from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlsplit

from . import __version__, access, extras, history, nba, net, player_season, season, settings, teams_meta, teamstats, verify
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


@route(r"/api/sante")
def api_sante(q):
    # Contrôle de santé du déploiement automatique : accessible sans code d'accès, ne dit que la version.
    return _no_meta({"ok": True, "version": __version__})


@route(r"/api/push/cle")
def api_push_key(q):
    from . import push

    if push.STORE is None:
        return _no_meta({"available": False})
    return _no_meta({"available": True, "publicKey": push.STORE.vapid.public_b64, "subscribers": len(push.STORE.subs)})


@route(r"/api/deploiement")
def api_deploiement(q):
    from . import autodeploy

    return _no_meta(autodeploy.public_state())


@route(r"/api/diagnostic")
def api_diagnostic(q):
    return _no_meta(nba.diagnostic())


@route(r"/api/verify")
def api_verify(q):
    return _no_meta(verify.run_all())


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


@route(r"/api/game/(\d{10})/extras")
def api_game_extras(q, game_id):
    return extras.game_extras(game_id)


@route(r"/api/game/(\d{10})/video")
def api_game_video(q, game_id):
    return extras.game_video(game_id)


@route(r"/api/videos/night")
def api_night_videos(q):
    day = q.get("date") or ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        day = nba.game_day_et().isoformat()
    return extras.night_videos(day)


def _int_param(q: dict, name: str) -> int | None:
    value = q.get(name) or ""
    return int(value) if value.isdigit() else None


@route(r"/api/injuries")
def api_injuries(q):
    game = q.get("game") if re.fullmatch(r"\d{10}", q.get("game") or "") else None
    return extras.injuries_for(team_id=_int_param(q, "team"), game_id=game)


@route(r"/api/transactions")
def api_transactions(q):
    kind = q.get("type") if q.get("type") in extras.TYPE_FR else None
    days = _int_param(q, "days")
    return extras.transactions(
        team_id=_int_param(q, "team"), player_id=_int_param(q, "player"), kind=kind,
        days=120 if days is None else days, limit=min(_int_param(q, "limit") or 300, 2000),
    )


@route(r"/api/settings")
def api_settings(q):
    return _no_meta({"youtube": settings.youtube_status()})


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


@route(r"/api/teams/advanced")
def api_teams_advanced(q):
    return teamstats.league_advanced(q.get("season"))


@route(r"/api/team/(\d+)/profile")
def api_team_profile(q, team_id):
    return teamstats.team_profile(int(team_id))


@route(r"/api/h2h/(\d+)/(\d+)")
def api_h2h(q, a, b):
    if a == b:
        raise ValueError("Choisis deux équipes différentes.")
    return teamstats.head_to_head(int(a), int(b))


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


@route(r"/api/race")
def api_race(q):
    return season.playoff_race()


@route(r"/api/awards/race")
def api_awards_race(q):
    return season.awards_race(q.get("season"))


@route(r"/api/records")
def api_records(q):
    return history.records("Playoffs" if q.get("type") == "playoffs" else "Regular Season")


@route(r"/api/palmares")
def api_palmares(q):
    return history.palmares_data()


@route(r"/api/draft")
def api_draft(q):
    year = _int_param(q, "year")
    team = _int_param(q, "team")
    return nba.draft(year=year, team=team)


@route(r"/api/player/(\d+)")
def api_player(q, player_id):
    return nba.player_info(int(player_id))


@route(r"/api/player/(\d+)/season")
def api_player_season(q, player_id):
    return player_season.season_detail(int(player_id), q.get("season"))


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

    def _same_origin(self) -> bool:
        """Refuse les envois venant d'un autre site (une page web ne doit pas pouvoir modifier les réglages)."""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        # Derrière un tunnel (Cloudflare, Tailscale), l'adresse publique peut arriver dans X-Forwarded-Host.
        hosts = {self.headers.get("Host") or "", self.headers.get("X-Forwarded-Host") or ""} - {""}
        return urlsplit(origin).netloc in hosts

    # -- Code d'accès (facultatif, voir access.py) ----------------------------------------

    def _https(self) -> bool:
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

    def _gate(self, path: str) -> bool:
        """Vrai si la requête peut continuer ; sinon la réponse « code requis » est déjà envoyée."""
        if access.allowed(path, self.headers.get("Cookie")):
            return True
        if path.startswith("/api/"):
            self._json(401, {"error": "Code d'accès requis : recharge la page pour le taper.", "access": True})
        elif path in ("", "/") or path.endswith(".html") or "." not in path.rsplit("/", 1)[-1]:
            self._send(401, access.login_page(access.safe_next(self.path)), "text/html; charset=utf-8")
        else:
            self._send(401, "Code d'accès requis".encode("utf-8"), "text/plain; charset=utf-8")
        return False

    def _redirect(self, location: str, cookie: str | None = None) -> None:
        extra = {"Location": location}
        if cookie:
            extra["Set-Cookie"] = cookie
        self._send(303, b"", "text/plain; charset=utf-8", extra)

    def _login(self) -> None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            form = parse_qs(self.rfile.read(min(length, 4096)).decode("utf-8", "replace")) if 0 < length <= 4096 else {}
        except ValueError:
            form = {}
        code = (form.get("code") or [""])[0]
        target = access.safe_next((form.get("next") or ["/"])[0])
        if not access.enabled():
            self._redirect(target)
            return
        if not self._same_origin():
            self._send(403, "Requête refusée".encode("utf-8"), "text/plain; charset=utf-8")
            return
        if access.locked():
            self._send(429, access.login_page(target, "Trop d'essais ratés. Réessaie dans un quart d'heure."), "text/html; charset=utf-8")
            return
        if not access.check(code):
            error = "Trop d'essais ratés. Réessaie dans un quart d'heure." if access.locked() else "Ce n'est pas le bon code."
            self._send(401, access.login_page(target, error), "text/html; charset=utf-8")
            return
        self._redirect(target, access.set_cookie(self._https()))

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path == "/acces":
            self._login()
            return
        if not self._gate(path):
            return
        if path.startswith("/api/push/"):
            self._push(path)
            return
        if path != "/api/settings/youtube":
            self._json(404, {"error": "Adresse d'API inconnue"})
            return
        if not self._same_origin():
            self._json(403, {"error": "Requête refusée"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(min(length, 4096)) or b"{}") if 0 < length <= 4096 else {}
            key = str(payload.get("key") or "").strip()
        except (ValueError, AttributeError):
            self._json(400, {"error": "Requête illisible"})
            return
        if key and not re.fullmatch(r"[A-Za-z0-9_\-]{20,80}", key):
            self._json(400, {"error": "Cette clé n'a pas le bon format : une clé d'API YouTube ressemble à « AIza… » (39 caractères)."})
            return
        if key:
            problem = extras.verify_key(key)
            if problem:
                self._json(400, {"error": problem})
                return
        try:
            settings.save({"youtubeKey": key})
        except (OSError, RuntimeError) as exc:
            self._json(500, {"error": f"Impossible d'enregistrer la clé ({exc.__class__.__name__})"})
            return
        self._json(200, {"data": {"youtube": settings.youtube_status()}, "meta": {}})

    def _push(self, path: str) -> None:
        """Abonnement aux notifications push (voir push.py)."""
        from . import push

        if not self._same_origin():
            self._json(403, {"error": "Requête refusée"})
            return
        if push.STORE is None:
            self._json(503, {"error": "Notifications indisponibles sur ce serveur."})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(min(length, 8192)) or b"{}") if 0 < length <= 8192 else {}
            if not isinstance(payload, dict):
                raise ValueError
        except ValueError:
            self._json(400, {"error": "Requête illisible"})
            return
        sub = payload.get("subscription") or {}
        endpoint = str(sub.get("endpoint") or payload.get("endpoint") or "")
        try:
            if path == "/api/push/abonnement":
                origin = self.headers.get("Origin") or ""
                sid = push.STORE.subscribe(sub, payload.get("prefs") or {}, origin)
                self._json(200, {"data": {"id": sid, "prefs": push.STORE.subs[sid]["prefs"]}, "meta": {}})
            elif path == "/api/push/desabonnement":
                self._json(200, {"data": {"removed": push.STORE.unsubscribe(endpoint)}, "meta": {}})
            elif path == "/api/push/test":
                sid = push._sub_id(endpoint)
                if sid not in push.STORE.subs:
                    self._json(404, {"error": "Cet appareil n'est pas abonné."})
                    return
                ok = push.STORE.deliver(sid, push.test_message(), ttl=600)
                self._json(200 if ok else 502, {"data": {"sent": ok}, "meta": {}} if ok else {"error": "Le service de notification de ton navigateur a refusé l'envoi."})
            else:
                self._json(404, {"error": "Adresse d'API inconnue"})
        except ValueError as exc:
            self._json(400, {"error": str(exc)})

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parts = urlsplit(self.path)
        path = parts.path
        if path == "/acces/sortie":
            self._redirect("/", access.clear_cookie())
            return
        if path == "/acces":
            if access.allowed(path, self.headers.get("Cookie")):
                self._redirect("/")
            else:
                target = access.safe_next(parse_qs(parts.query).get("next", ["/"])[0])
                self._send(401, access.login_page(target), "text/html; charset=utf-8")
            return
        if not self._gate(path):
            return
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
    # Linux, Mac, Android : relancer juste après un arrêt doit reprendre le même port (même adresse,
    # donc mêmes favoris et réglages). Sous Windows, cette option permettrait au contraire à deux
    # programmes d'écouter le même port : elle y reste désactivée.
    allow_reuse_address = os.name != "nt"

    def handle_error(self, request, client_address):
        # Un onglet fermé ou un téléphone qui se met en veille coupe la connexion en cours :
        # ce n'est pas une erreur de Parquet, inutile d'afficher une trace dans la fenêtre.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def make_server(host: str, port: int) -> Server:
    return Server((host, port), Handler)
