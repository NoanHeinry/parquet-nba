"""Notifications push : abonnements des appareils et surveillance des matchs, côté serveur.

Chaque appareil qui active les alertes s'abonne (Web Push) avec ses préférences : ses équipes favorites,
les alertes voulues, le mode sans spoiler. Un fil de fond suit le tableau des scores et envoie :
- coup d'envoi et résultat final des équipes favorites ;
- fin de match serrée (définition NBA : 5 dernières minutes du 4e quart-temps ou d'une prolongation,
  5 points d'écart ou moins), pour les favoris ou pour tous les matchs ;
- grosse performance en fin de match (40 points ou plus, ou triple-double) ;
- alertes du serveur : mise à jour ignorée (tests GitHub ratés), retour arrière, plantage.

Les alertes déjà envoyées sont mémorisées (data/push-envoyees.json) : un redémarrage n'en renvoie aucune.
Au premier passage, l'état des matchs est seulement relevé : rien n'est envoyé pour ce qui a eu lieu avant.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from . import nba, webpush

DEFAULT_PREFS = {"start": True, "final": True, "finalAll": False, "clutch": True, "clutchAll": False, "perf": True, "server": False, "spoiler": False, "teams": []}
STAT_LABELS = (("pts", "pts"), ("reb", "reb"), ("ast", "pd"), ("stl", "int"), ("blk", "ctr"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sub_id(endpoint: str) -> str:
    return hashlib.sha256(endpoint.encode("utf-8")).hexdigest()[:24]


def clean_prefs(raw: dict | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    prefs = dict(DEFAULT_PREFS)
    for k, v in DEFAULT_PREFS.items():
        if k == "teams":
            prefs[k] = sorted({int(t) for t in raw.get("teams", []) if str(t).isdigit()})[:30]
        elif k in raw:
            prefs[k] = bool(raw[k])
    return prefs


# ---------------------------------------------------------------------------
# Abonnements
# ---------------------------------------------------------------------------


class Store:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "push.json"
        self.sent_path = data_dir / "push-envoyees.json"
        self.lock = threading.Lock()
        self.vapid = webpush.Vapid.load_or_create(data_dir / "vapid.json")
        self.subs: dict[str, dict] = self._read(self.path).get("subs", {})
        sent = self._read(self.sent_path)
        self.sent: dict[str, float] = sent.get("sent", {})
        self.deploy_cursor: str | None = sent.get("deployCursor")

    @staticmethod
    def _read(path: Path) -> dict:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    @staticmethod
    def _write(path: Path, data: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    def save(self) -> None:
        with self.lock:
            self._write(self.path, {"subs": self.subs})

    def save_sent(self) -> None:
        limit = time.time() - 3 * 24 * 3600
        with self.lock:
            self.sent = {k: t for k, t in self.sent.items() if t > limit}
            self._write(self.sent_path, {"sent": self.sent, "deployCursor": self.deploy_cursor})

    def subscribe(self, subscription: dict, prefs: dict, origin: str = "") -> str:
        endpoint = str((subscription or {}).get("endpoint") or "")
        keys = (subscription or {}).get("keys") or {}
        local = endpoint.startswith(("http://127.0.0.1:", "http://localhost:"))  # tests
        if not (endpoint.startswith("https://") or local) or len(endpoint) > 1000:
            raise ValueError("Abonnement invalide (adresse du service de notification).")
        try:
            if len(webpush.unb64u(keys["p256dh"])) != 65 or len(webpush.unb64u(keys["auth"])) != 16:
                raise ValueError
        except (KeyError, ValueError, TypeError):
            raise ValueError("Abonnement invalide (clés de chiffrement).") from None
        sid = _sub_id(endpoint)
        with self.lock:
            old = self.subs.get(sid, {})
            self.subs[sid] = {
                "endpoint": endpoint,
                "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
                "prefs": clean_prefs(prefs),
                "origin": origin[:200],
                "created": old.get("created") or _now(),
                "updated": _now(),
            }
        self.save()
        return sid

    def unsubscribe(self, endpoint: str) -> bool:
        with self.lock:
            found = self.subs.pop(_sub_id(endpoint or ""), None) is not None
        if found:
            self.save()
        return found

    def deliver(self, sid: str, message: dict, ttl: int = 3600) -> bool:
        sub = self.subs.get(sid)
        if not sub:
            return False
        try:
            webpush.send(self.vapid, sub, message, ttl=ttl)
            return True
        except webpush.Gone:
            with self.lock:
                self.subs.pop(sid, None)
            self.save()
        except Exception as exc:  # noqa: BLE001 - un appareil injoignable ne doit pas gêner les autres
            print(f"[notifications] envoi impossible : {exc.__class__.__name__}", flush=True)
        return False


# ---------------------------------------------------------------------------
# Textes des alertes
# ---------------------------------------------------------------------------


def _side(g: dict, key: str) -> dict:
    return g.get(key) or {}


def _matchup(g: dict) -> str:
    return f"{_side(g, 'away').get('name') or '?'} – {_side(g, 'home').get('name') or '?'}"


def _score_line(g: dict) -> str:
    a, h = _side(g, "away"), _side(g, "home")
    return f"{a.get('tri')} {a.get('score')} – {h.get('score')} {h.get('tri')}"


def _period(g: dict) -> str:
    p = g.get("period") or 0
    return f"{p}e quart-temps" if p <= 4 else ("prolongation" if p == 5 else f"{p - 4}e prolongation")


def message_start(g: dict) -> dict:
    a, h = _side(g, "away"), _side(g, "home")
    return {"title": f"Coup d'envoi : {a.get('tri')} – {h.get('tri')}", "body": f"{a.get('city')} {a.get('name')} chez {h.get('city')} {h.get('name')} : c'est parti.", "url": f"#/match/{g['id']}", "tag": f"match-{g['id']}"}


def message_clutch(g: dict, spoiler: bool) -> dict:
    left = g.get("clock") or ""
    if spoiler:
        return {"title": f"Fin de match serrée : {_matchup(g)}", "body": "Moins de 5 minutes à jouer, 5 points d'écart ou moins.", "url": f"#/match/{g['id']}", "tag": f"match-{g['id']}"}
    return {"title": f"Fin de match serrée : {_score_line(g)}", "body": f"{_period(g).capitalize()}, {left} à jouer.", "url": f"#/match/{g['id']}", "tag": f"match-{g['id']}"}


def message_final(g: dict, spoiler: bool) -> dict:
    if spoiler:
        return {"title": f"Match terminé : {_matchup(g)}", "body": "Le résultat t'attend dans Parquet.", "url": f"#/match/{g['id']}", "tag": f"match-{g['id']}"}
    a, h = _side(g, "away"), _side(g, "home")
    winner, loser = (a, h) if (a.get("score") or 0) > (h.get("score") or 0) else (h, a)
    extra = " après prolongation" if (g.get("period") or 0) > 4 else ""
    return {"title": f"Fin du match : {_score_line(g)}", "body": f"Victoire des {winner.get('name')} contre les {loser.get('name')}{extra}.", "url": f"#/match/{g['id']}", "tag": f"match-{g['id']}"}


def big_games(box: dict) -> list[tuple[dict, dict, dict]]:
    """(joueur, son équipe, l'adversaire) pour chaque performance à 40 points ou triple-double."""
    teams = box.get("teams") or {}
    out = []
    for side, other in (("away", "home"), ("home", "away")):
        for p in (teams.get(side) or {}).get("players") or []:
            doubles = sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if (p.get(k) or 0) >= 10)
            if (p.get("pts") or 0) >= 40 or doubles >= 3:
                out.append((p, teams.get(side) or {}, teams.get(other) or {}))
    return out


def message_perf(g: dict, player: dict, opp_side: dict) -> dict:
    line = ", ".join(f"{player.get(k) or 0} {label}" for k, label in STAT_LABELS if (player.get(k) or 0) >= (10 if k != "pts" else 1))
    kind = "Triple-double" if sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if (player.get(k) or 0) >= 10) >= 3 else "Grosse performance"
    opp = opp_side.get("name") or ""
    return {"title": f"{kind} : {player.get('name')}", "body": f"{line}{f' contre les {opp}' if opp else ''}.", "url": f"#/match/{g['id']}", "tag": f"perf-{g['id']}-{player.get('id')}"}


DEPLOY_ALERTS = {
    "rollback": "Mise à jour annulée",
    "ci-failed": "Mise à jour ignorée",
    "blocked": "Mise à jour bloquée",
    "crash": "Le serveur a redémarré",
}


# ---------------------------------------------------------------------------
# Surveillance
# ---------------------------------------------------------------------------


def is_clutch(g: dict) -> bool:
    if g.get("status") != 2 or (g.get("period") or 0) < 4:
        return False
    a, h = _side(g, "away").get("score"), _side(g, "home").get("score")
    if a is None or h is None:
        return False
    clock = g.get("clock") or ""
    try:
        if ":" in clock:
            m, s = clock.split(":")
            left = int(m) * 60 + float(s)
        else:
            left = float(clock)
    except ValueError:
        return False
    return left <= 300 and abs(a - h) <= 5


class Watcher:
    def __init__(self, store: Store, scoreboard: Callable[[], dict] | None = None, box: Callable[[str], dict] | None = None,
                 deploy_state: Callable[[], dict] | None = None):
        self.store = store
        self.scoreboard = scoreboard or (lambda: nba.live_scoreboard()[0])
        self.box = box or (lambda gid: nba.game_box(gid)[0])
        self.deploy_state = deploy_state or _deploy_state
        self.last: dict[str, int] = {}
        self.seeded = False
        if self.store.deploy_cursor is None:
            self.store.deploy_cursor = _now()  # pas d'alerte pour l'historique d'avant l'activation

    def _recipients(self, want: Callable[[dict], bool]) -> list[tuple[str, dict]]:
        return [(sid, s["prefs"]) for sid, s in list(self.store.subs.items()) if want(s["prefs"])]

    def _send_once(self, key: str, want: Callable[[dict], bool], build: Callable[[dict], dict | None]) -> int:
        if key in self.store.sent:
            return 0
        self.store.sent[key] = time.time()
        count = 0
        for sid, prefs in self._recipients(want):
            msg = build(prefs)
            if msg and self.store.deliver(sid, msg):
                count += 1
        return count

    def tick(self) -> int:
        """Un passage : renvoie le nombre de notifications envoyées."""
        sent = self._deploy_alerts()
        if not self.store.subs:
            self.seeded = False
            return sent
        games = (self.scoreboard() or {}).get("games") or []
        for g in games:
            gid, status = g.get("id"), g.get("status")
            if not gid:
                continue
            prev = self.last.get(gid)
            self.last[gid] = status
            if not self.seeded:
                continue
            teams = {_side(g, "away").get("id"), _side(g, "home").get("id")}

            def fav(p, teams=teams):
                return bool(teams & set(p["teams"]))

            if prev == 1 and status == 2:
                sent += self._send_once(f"{gid}:start", lambda p: p["start"] and fav(p), lambda p, g=g: message_start(g))
            if is_clutch(g):
                sent += self._send_once(f"{gid}:clutch", lambda p: p["clutch"] and (p["clutchAll"] or fav(p)), lambda p, g=g: message_clutch(g, p["spoiler"]))
            if prev == 2 and status == 3:
                # Score final : équipes favorites, ou tous les matchs (option « finalAll »).
                sent += self._send_once(f"{gid}:final", lambda p: (p["final"] and fav(p)) or p.get("finalAll", False), lambda p, g=g: message_final(g, p["spoiler"]))
                if any(s["prefs"]["perf"] and not s["prefs"]["spoiler"] for s in self.store.subs.values()):
                    try:
                        box = self.box(gid)
                    except Exception:  # noqa: BLE001 - box score indisponible : pas d'alerte de performance
                        box = {}
                    for player, _team, opp in big_games(box):
                        sent += self._send_once(f"{gid}:perf:{player.get('id')}", lambda p: p["perf"] and not p["spoiler"], lambda p, g=g, pl=player, o=opp: message_perf(g, pl, o))
        self.seeded = True
        self.store.save_sent()
        return sent

    def _deploy_alerts(self) -> int:
        state = self.deploy_state() or {}
        cursor = self.store.deploy_cursor or ""
        fresh = [e for e in state.get("events", []) if e.get("at", "") > cursor and e.get("kind") in DEPLOY_ALERTS]
        if not fresh and not state.get("events"):
            return 0
        newest = max((e.get("at", "") for e in state.get("events", [])), default=cursor)
        self.store.deploy_cursor = max(cursor, newest)
        sent = 0
        for e in sorted(fresh, key=lambda e: e.get("at", "")):
            msg = {"title": f"Parquet : {DEPLOY_ALERTS[e['kind']].lower()}", "body": e.get("message", ""), "url": "#/etat", "tag": "serveur"}
            for sid, _prefs in self._recipients(lambda p: p["server"]):
                if self.store.deliver(sid, msg, ttl=24 * 3600):
                    sent += 1
        self.store.save_sent()
        return sent

    def interval(self) -> int:
        statuses = set(self.last.values())
        return 20 if 2 in statuses else 60 if 1 in statuses else 300


def _deploy_state() -> dict:
    from . import autodeploy

    return autodeploy.read_state()


# ---------------------------------------------------------------------------
# Démarrage avec le serveur
# ---------------------------------------------------------------------------

STORE: Store | None = None


def start(data_dir: Path) -> Store:
    global STORE
    STORE = Store(data_dir)
    watcher = Watcher(STORE)

    def loop() -> None:
        while True:
            try:
                watcher.tick()
            except Exception as exc:  # noqa: BLE001 - la surveillance ne doit jamais s'arrêter
                print(f"[notifications] surveillance : {exc.__class__.__name__} {exc}", flush=True)
            time.sleep(watcher.interval())

    threading.Thread(target=loop, name="parquet-push", daemon=True).start()
    return STORE


def test_message() -> dict:
    return {"title": "Parquet : notifications activées", "body": "Tu recevras tes alertes même quand Parquet est fermé.", "url": "#/", "tag": "test"}
