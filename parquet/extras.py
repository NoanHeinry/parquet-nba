"""Contenus complémentaires : vidéos et clés d'un match, faits marquants, résumés YouTube,
rapport officiel des blessures et transactions.

Sources :
- la page d'un match sur www.nba.com (données intégrées à la page : résumé vidéo, moments décisifs
  avec leurs vidéos, rapport d'analyse) ;
- le fil des actions déjà utilisé par Parquet (fautes techniques, flagrantes, expulsions, challenges) ;
- la chaîne YouTube officielle de la NBA (flux public, et l'API YouTube si une clé est réglée) ;
- le rapport officiel des blessures, publié en PDF par la NBA toutes les 15 minutes ;
- la liste officielle des transactions (signatures, échanges, joueurs libérés).
"""

from __future__ import annotations

import html
import json
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote_plus

from . import nba, net, settings, teams_meta
from .net import NotAvailable, SourceError

# ---------------------------------------------------------------------------
# Outils
# ---------------------------------------------------------------------------

MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SAFE_HOSTS = ("https://videos.nba.com/", "https://cdn.nba.com/", "https://www.nba.com/", "https://ak-static.cms.nba.com/")


def _safe_url(value: Any) -> str | None:
    """N'accepte que des liens https vers les domaines de la NBA (jamais javascript:, data:, etc.)."""
    url = str(value or "").strip()
    return url if url.startswith(SAFE_HOSTS) else None


def _txt(value: Any, limit: int = 600) -> str:
    text = html.unescape(str(value or "")).strip()
    return text[:limit]


def _num_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int_or_none(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def norm_name(value: str) -> str:
    """Nom comparable : sans accents, en minuscules, sans ponctuation."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9 ]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def _without_suffix(name: str) -> str:
    return " ".join(w for w in name.split() if w not in SUFFIXES)


def us_date_label(day: str) -> str:
    """'2026-11-04' -> 'November 4, 2026' (format des titres de la NBA sur YouTube)."""
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
    except (TypeError, ValueError):
        return ""
    return f"{MONTHS_EN[d.month - 1]} {d.day}, {d.year}"


def _team_by_name(text: str) -> dict | None:
    """Retrouve une équipe à partir de son nom complet ('Golden State Warriors', 'LA Clippers')."""
    key = norm_name(text)
    if not key:
        return None
    for t in teams_meta.TEAMS:
        if norm_name(f"{t['city']} {t['name']}") == key:
            return t
    for t in teams_meta.TEAMS:
        if key.endswith(norm_name(t["name"])):
            return t
    return None


# ---------------------------------------------------------------------------
# Page d'un match sur nba.com : résumé vidéo, moments décisifs, clés du match
# ---------------------------------------------------------------------------

NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>', re.S)

CATEGORY_FR = {
    "scoring": "Panier", "defense": "Défense", "defensive": "Défense", "playmaking": "Passe", "rebounding": "Rebond",
    "clutch": "Moment décisif", "momentum": "Tournant", "hustle": "Effort",
}

STAT_FR = {
    "points": "points", "pts": "points", "rebounds": "rebonds", "reb": "rebonds", "assists": "passes décisives",
    "ast": "passes décisives", "steals": "interceptions", "stl": "interceptions", "blocks": "contres", "blk": "contres",
    "plus_minus": "+/-", "plusminus": "+/-", "plus-minus": "+/-", "threes": "tirs à 3 points", "fg3m": "tirs à 3 points",
}


def next_data(page_html: str) -> dict:
    m = NEXT_DATA.search(page_html or "")
    if not m:
        raise SourceError("la page du match ne contient pas les données attendues", source="www.nba.com")
    try:
        return json.loads(m.group(1))
    except ValueError as exc:
        raise SourceError("données de la page du match illisibles", source="www.nba.com") from exc


def _person(value: Any) -> dict:
    """Joueur décrit de façon variable selon les modules ({playerId, firstName, lastName} ou {id, name})."""
    if not isinstance(value, dict):
        return {"id": None, "name": _txt(value, 80)}
    pid = value.get("playerId") or value.get("personId") or value.get("id")
    name = value.get("name") or value.get("playerName") or " ".join(x for x in (value.get("firstName"), value.get("lastName")) if x)
    return {"id": _int_or_none(pid), "name": _txt(name, 80), "teamId": _int_or_none(value.get("teamId"))}


def parse_game_page(data: dict) -> dict:
    """Extrait de la page d'un match ce que Parquet affiche (tout le reste est ignoré)."""
    pp = ((data or {}).get("props") or {}).get("pageProps") or {}
    game = pp.get("game") or {}
    report = pp.get("blueprintReport") or {}

    recap = None
    r = game.get("gameRecap")
    if isinstance(r, dict) and _safe_url(r.get("permalink")):
        recap = {
            "title": _txt(r.get("title"), 200),
            "url": _safe_url(r.get("permalink")),
            "duration": _txt(r.get("videoDuration"), 10),
            "image": _safe_url(r.get("featuredImage")),
            "excerpt": _txt(r.get("excerpt"), 400),
        }

    moments = []
    for m in ((report.get("defining_moments") or {}).get("definingMoments") or [])[:12]:
        if not isinstance(m, dict):
            continue
        category = _txt(m.get("category"), 40)
        duration = _num_or_none(m.get("largeDuration") or m.get("mediumDuration"))
        moments.append(
            {
                "rank": _int_or_none(m.get("rank")),
                "title": _txt(m.get("title"), 160),
                "summary": _txt(m.get("summary"), 400),
                "category": CATEGORY_FR.get(category.lower(), category),
                "eventNum": _int_or_none(m.get("eventNum")),
                "playerId": _int_or_none(m.get("playerId")),
                "video": _safe_url(m.get("mediumUrl")) or _safe_url(m.get("largeUrl")) or _safe_url(m.get("smallUrl")),
                "videoHd": _safe_url(m.get("largeUrl")),
                "poster": _safe_url(m.get("mediumThumbnail")) or _safe_url(m.get("largeThumbnail")),
                "seconds": round(duration / 1000) if duration else None,
            }
        )
    moments.sort(key=lambda m: m["rank"] if m["rank"] is not None else 99)

    highlights = []
    for v in pp.get("highlightVideos") or []:
        if isinstance(v, dict) and _safe_url(v.get("permalink")):
            highlights.append({"title": _txt(v.get("title"), 160), "url": _safe_url(v.get("permalink")), "duration": _txt(v.get("videoDuration"), 10), "image": _safe_url(v.get("featuredImage"))})

    performers = []
    for p in ((report.get("top_performers") or {}).get("topPerformers") or [])[:6]:
        if not isinstance(p, dict):
            continue
        cat = _txt(p.get("statCategory"), 40)
        performers.append(
            {
                "id": _int_or_none(p.get("playerId")),
                "name": _txt(f"{p.get('firstName') or ''} {p.get('lastName') or ''}", 80),
                "teamId": _int_or_none(p.get("teamId")),
                "tri": _txt(p.get("teamAbbreviation"), 4),
                "value": _txt(p.get("statValue"), 20),
                "stat": STAT_FR.get(cat.lower().replace(" ", "_"), cat),
                "summary": _txt(p.get("summary"), 400),
            }
        )

    defense = []
    spot = report.get("defensive_spotlight") or {}
    for key in ("awayDefensiveSpotlight", "homeDefensiveSpotlight"):
        d = spot.get(key)
        if not isinstance(d, dict) or not d.get("defPlayerId"):
            continue
        defense.append(
            {
                "defenderId": _int_or_none(d.get("defPlayerId")),
                "defender": _txt(d.get("defPlayerName"), 80),
                "defTeamId": _int_or_none(d.get("defTeamId")),
                "defTri": _txt(d.get("defTeamAbbreviation"), 4),
                "attackerId": _int_or_none(d.get("offPlayerId")),
                "attacker": _txt(d.get("offPlayerName"), 80),
                "offTri": _txt(d.get("offTeamAbbreviation"), 4),
                "fgm": _int_or_none(d.get("fieldGoalMakes")),
                "fga": _int_or_none(d.get("fieldGoalAttempts")),
                "tpm": _int_or_none(d.get("threePointMakes")),
                "tpa": _int_or_none(d.get("threePointAttempts")),
                "time": _txt(d.get("matchupTime"), 10),
            }
        )

    hardest = []
    for s in (report.get("shot_difficulty") or {}).get("shotDifficulty") or []:
        if not isinstance(s, dict) or not s.get("success") or s.get("success") in ("false", "0", 0):
            continue
        exp = _num_or_none(s.get("expFieldGoalPct"))
        if exp is None:
            continue
        shooter = _person(s.get("shooter"))
        hardest.append(
            {
                "shooter": shooter,
                "defender": _person(s.get("defender")),
                "chance": exp if exp <= 1 else exp / 100,
                "period": _int_or_none(s.get("period")),
                "clock": _txt(s.get("gameClockTime"), 10),
                "type": _txt(s.get("shotType"), 40),
                "three": "3" in str(s.get("shotType") or ""),
            }
        )
    hardest.sort(key=lambda s: s["chance"])

    story = None
    st = pp.get("story")
    if isinstance(st, dict) and isinstance(st.get("header"), dict):
        story = {"headline": _txt(st["header"].get("headline"), 200), "byline": _txt(st["header"].get("byline"), 120), "agency": _txt(st["header"].get("bytitle"), 80)}

    return {
        "recap": recap,
        "moments": moments,
        "highlights": highlights[:12],
        "performers": performers,
        "defense": defense,
        "hardest": hardest[:3],
        "story": story,
    }


def _extras_ttl(data: dict) -> float:
    if data.get("final") and data.get("recap") and data.get("moments"):
        return 7 * 24 * 3600  # match terminé et page complète : elle ne bougera plus
    return 10 * 60 if data.get("final") else 5 * 60


def game_page(game_id: str) -> tuple[dict, dict]:
    def fetch() -> dict:
        page = parse_game_page(next_data(net.nba_page(f"https://www.nba.com/game/{game_id}")))
        box, _ = nba.game_box(game_id)
        page["final"] = (box.get("game") or {}).get("status") == 3
        return page

    return nba._cache().get(f"extras:{game_id}", _extras_ttl, fetch)


# ---------------------------------------------------------------------------
# Faits marquants : fautes techniques et flagrantes, expulsions, challenges
# ---------------------------------------------------------------------------

TECH_DETAIL = {
    "flopping": "simulation", "taunting": "provocation", "hanging": "suspendu au cercle", "delay-of-game": "retard de jeu",
    "unsportsmanlike": "comportement antisportif", "excess-timeout": "temps mort de trop", "too-many-players": "joueur en trop",
}


def notable_events(actions: list[dict]) -> list[dict]:
    out = []
    for a in actions or []:
        kind_raw = (a.get("type") or "").lower()
        sub = (a.get("sub") or "").lower()
        descr = (a.get("descr") or "").lower()
        low = (a.get("desc") or "").lower()
        detail = ""
        if kind_raw == "foul" and ("flagrant" in descr or "flagrant" in low):
            level = "2" if ("type-2" in descr or "type 2" in low or "flagrant-type-2" in low or "flagrant 2" in low) else "1"
            kind, label = "flagrant", f"Faute flagrante {level}"
        elif kind_raw == "foul" and (sub == "technical" or "technical" in low):
            if "defensive-3-second" in descr or "defensive 3" in low or "def 3 sec" in low:
                continue  # trois secondes défensives : faute technique de routine
            kind, label = "technical", "Faute technique"
            detail = TECH_DETAIL.get(descr, "")
        elif kind_raw == "ejection" or "ejection" in low:
            kind, label = "ejection", "Expulsion"
        elif kind_raw == "timeout" and sub == "challenge":
            kind, label = "challenge", "Challenge de l'entraîneur"
        else:
            continue
        out.append(
            {
                "kind": kind, "label": label, "detail": detail, "period": a.get("period"), "clock": a.get("clock"),
                "teamId": a.get("teamId"), "tri": a.get("tri") or "", "personId": a.get("personId"), "player": a.get("player") or "",
            }
        )
    return out


def game_extras(game_id: str) -> tuple[dict, dict]:
    """Vidéos NBA.com, clés du match et faits marquants. Chaque partie peut manquer sans bloquer les autres."""
    out: dict = {"page": None, "pageError": "", "events": [], "pageUrl": f"https://www.nba.com/game/{game_id}"}
    meta: dict = {"fetchedAt": datetime.now(timezone.utc).timestamp(), "stale": False}
    try:
        out["page"], meta = game_page(game_id)
    except SourceError as exc:
        out["pageError"] = str(exc)
    try:
        pbp, _ = nba.game_pbp(game_id)
        out["events"] = notable_events(pbp.get("actions") or [])
    except SourceError:
        pass
    return out, meta


# ---------------------------------------------------------------------------
# YouTube : résumé officiel d'un match, résumé de la nuit et top 10
# ---------------------------------------------------------------------------

NBA_CHANNEL = "UCWJ2lWNubArHWmf3FIHbfcQ"
FEED_URL = f"https://www.youtube.com/feeds/videos.xml?channel_id={NBA_CHANNEL}"
SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
OEMBED_URL = "https://www.youtube.com/oembed"
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
ATOM = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


def parse_feed(xml_text: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out = []
    for e in root.findall("a:entry", ATOM):
        vid = (e.findtext("yt:videoId", "", ATOM) or "").strip()
        if YT_ID.match(vid):
            out.append({"id": vid, "title": (e.findtext("a:title", "", ATOM) or "").strip(), "published": e.findtext("a:published", "", ATOM) or ""})
    return out


def _feed() -> list[dict]:
    data, _ = nba._cache().get("yt:feed", 15 * 60, lambda: parse_feed(net.youtube_feed(FEED_URL)), persist=False)
    return data


def _upper(text: str) -> str:
    return re.sub(r"\s+", " ", norm_name(text).upper())


def title_matches_game(title: str, away: str, home: str, day: str) -> bool:
    """« HEAT at CLIPPERS | FULL GAME HIGHLIGHTS | November 4, 2026 » pour Heat à Clippers le 4 novembre."""
    t = _upper(html.unescape(title))
    if "HIGHLIGHTS" not in t:
        return False
    a, h = _upper(away), _upper(home)
    if not any(f"{a} {sep} {h}" in t for sep in ("AT", "VS")):
        return False
    label = _upper(us_date_label(day))
    if label and any(m.upper() in t for m in MONTHS_EN) and label not in t:
        return False  # autre rencontre entre les deux mêmes équipes
    return True


def title_matches_night(title: str, day: str, kind: str) -> bool:
    t = _upper(html.unescape(title))
    label = _upper(us_date_label(day))
    if not label or label not in t:
        return False
    return ("NIGHTLY RECAP" in t) if kind == "recap" else ("TOP 10 PLAYS" in t)


def _search_api(key: str, q: str, after: datetime | None = None, before: datetime | None = None, n: int = 10) -> list[dict]:
    params = {"part": "snippet", "channelId": NBA_CHANNEL, "q": q, "type": "video", "order": "date", "maxResults": n, "key": key}
    if after:
        params["publishedAfter"] = after.strftime("%Y-%m-%dT%H:%M:%SZ")
    if before:
        params["publishedBefore"] = before.strftime("%Y-%m-%dT%H:%M:%SZ")
    raw = net.youtube_json(SEARCH_URL, params)
    out = []
    for item in (raw or {}).get("items") or []:
        vid = ((item.get("id") or {}).get("videoId") or "").strip()
        if YT_ID.match(vid):
            out.append({"id": vid, "title": html.unescape((item.get("snippet") or {}).get("title") or "")})
    return out


def _embeddable(video_id: str) -> bool:
    try:
        net.youtube_json(OEMBED_URL, {"format": "json", "url": f"https://www.youtube.com/watch?v={video_id}"})
        return True
    except SourceError as exc:
        return exc.status not in (401, 403)


def verify_key(key: str) -> str:
    """Vérifie une clé d'API YouTube (1 unité de quota). Renvoie un message d'erreur, ou "" si elle marche."""
    try:
        net.youtube_json(CHANNELS_URL, {"part": "id", "id": NBA_CHANNEL, "key": key})
        return ""
    except SourceError as exc:
        if exc.status == 400:
            return "YouTube refuse cette clé : vérifie qu'elle est copiée en entier."
        if exc.status == 403:
            return "YouTube refuse la clé : active « YouTube Data API v3 » pour ce projet dans la console Google Cloud, ou attends le lendemain si le quota du jour est épuisé."
        return f"Impossible de joindre YouTube pour vérifier la clé ({exc})."


def _parse_start(value: str) -> datetime | None:
    try:
        return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def game_video(game_id: str) -> tuple[dict, dict]:
    box, _ = nba.game_box(game_id)
    g = box.get("game") or {}
    away, home = teams_meta.team((g.get("away") or {}).get("id")), teams_meta.team((g.get("home") or {}).get("id"))
    day = g.get("etDate") or ""
    key, source = settings.youtube_key()
    names = (away["name"] if away else "", home["name"] if home else "")
    search_q = f"{names[0]} at {names[1]} full game highlights {us_date_label(day)}".strip()
    base = {
        "found": False, "configured": bool(key), "status": g.get("status"),
        "searchUrl": f"https://www.youtube.com/results?search_query={quote_plus(search_q)}",
    }
    if g.get("status") != 3 or not away or not home:
        return {**base, "reason": "pending"}, {"fetchedAt": datetime.now(timezone.utc).timestamp(), "stale": False}

    def fetch() -> dict:
        found = next((v for v in _feed_safe() if title_matches_game(v["title"], names[0], names[1], day)), None)
        via = "feed"
        if not found and key:
            start = _parse_start(g.get("start") or "") or (datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc) if day else None)
            hits = _search_api(key, f"{names[0]} at {names[1]} full game highlights", start, start + timedelta(days=5) if start else None)
            found = next((v for v in hits if title_matches_game(v["title"], names[0], names[1], day)), None)
            via = "api"
        if not found:
            return {"found": False}
        return {"found": True, "videoId": found["id"], "title": found["title"], "via": via, "embeddable": _embeddable(found["id"])}

    data, meta = nba._cache().get(f"yt:game:{game_id}:{'k' if key else '-'}", lambda d: 60 * 24 * 3600 if d.get("found") else 20 * 60, fetch)
    out = {**base, **data}
    if data.get("found"):
        out["url"] = f"https://www.youtube.com/watch?v={data['videoId']}"
    return out, meta


def _feed_safe() -> list[dict]:
    try:
        return _feed()
    except SourceError:
        return []


def night_videos(day: str) -> tuple[dict, dict]:
    """« NBA's Nightly Recap » et « Top 10 Plays of the Night » de la journée."""
    key, _ = settings.youtube_key()

    def fetch() -> dict:
        feed = _feed_safe()
        picks = {kind: next((v for v in feed if title_matches_night(v["title"], day, kind)), None) for kind in ("recap", "top10")}
        if key and not all(picks.values()):
            try:
                hits = _search_api(key, f"{us_date_label(day)} Nightly Recap Top 10 Plays", n=15)
            except SourceError:
                hits = []
            for kind in picks:
                picks[kind] = picks[kind] or next((v for v in hits if title_matches_night(v["title"], day, kind)), None)
        videos = []
        for kind, label in (("recap", "Le résumé de la nuit"), ("top10", "Le top 10 de la nuit")):
            v = picks[kind]
            if v:
                videos.append({"kind": kind, "label": label, "videoId": v["id"], "title": v["title"], "url": f"https://www.youtube.com/watch?v={v['id']}"})
        return {"videos": videos}

    return nba._cache().get(f"yt:night:{day}:{'k' if key else '-'}", lambda d: 12 * 3600 if len(d.get("videos") or []) == 2 else 20 * 60, fetch, persist=False)


# ---------------------------------------------------------------------------
# Rapport officiel des blessures (PDF de la NBA)
# ---------------------------------------------------------------------------

STATUS_FR = {"out": "Forfait", "doubtful": "Peu probable", "questionable": "Incertain", "probable": "Probable", "available": "Disponible"}
STATUS_ORDER = {"out": 0, "doubtful": 1, "questionable": 2, "probable": 3, "available": 4}

REASON_FR = {
    "g league - two-way": "G League (contrat two-way)",
    "g league - on assignment": "En mission en G League",
    "g league - on assignment - two-way": "En mission en G League (two-way)",
    "not with team": "Absent du groupe",
    "personal reasons": "Raisons personnelles",
    "personal reason": "Raisons personnelles",
    "rest": "Repos",
    "coach's decision": "Choix de l'entraîneur",
    "coach decision": "Choix de l'entraîneur",
    "suspension": "Suspension",
    "league suspension": "Suspension de la ligue",
    "team suspension": "Suspension par l'équipe",
    "health and safety protocols": "Protocole sanitaire",
    "return to competition reconditioning": "Remise en condition",
    "concussion protocol": "Protocole commotion",
    "illness": "Maladie",
    "trade pending": "Échange en cours",
}

# Parties du corps : (traduction, genre et nombre pour l'accord du côté).
BODY = {
    "ankle": ("Cheville", "f"), "knee": ("Genou", "m"), "foot": ("Pied", "m"),
    "hip": ("Hanche", "f"), "hamstring": ("Ischio-jambiers", "mp"), "calf": ("Mollet", "m"), "thigh": ("Cuisse", "f"),
    "quad": ("Quadriceps", "m"), "quadriceps": ("Quadriceps", "m"), "groin": ("Aine", "f"), "adductor": ("Adducteur", "m"),
    "back": ("Dos", "m"), "lower back": ("Bas du dos", "m"), "low back": ("Bas du dos", "m"), "neck": ("Cou", "m"),
    "shoulder": ("Épaule", "f"), "elbow": ("Coude", "m"), "wrist": ("Poignet", "m"), "hand": ("Main", "f"),
    "finger": ("Doigt", "m"), "thumb": ("Pouce", "m"), "toe": ("Orteil", "m"), "great toe": ("Gros orteil", "m"), "big toe": ("Gros orteil", "m"),
    "heel": ("Talon", "m"), "shin": ("Tibia", "m"), "tibia": ("Tibia", "m"), "fibula": ("Péroné", "m"), "achilles": ("Tendon d'Achille", "m"),
    "achilles tendon": ("Tendon d'Achille", "m"), "patellar tendon": ("Tendon rotulien", "m"), "acl": ("Ligament croisé antérieur", "m"),
    "mcl": ("Ligament collatéral médial", "m"), "meniscus": ("Ménisque", "m"), "glute": ("Fessier", "m"), "gluteal": ("Fessier", "m"),
    "abdominal": ("Abdominaux", "mp"), "abdomen": ("Abdomen", "m"), "oblique": ("Oblique", "m"), "rib": ("Côte", "f"), "ribs": ("Côtes", "fp"),
    "chest": ("Poitrine", "f"), "eye": ("Œil", "m"), "nose": ("Nez", "m"), "face": ("Visage", "m"), "jaw": ("Mâchoire", "f"),
    "head": ("Tête", "f"), "forearm": ("Avant-bras", "m"), "pelvis": ("Bassin", "m"), "sacroiliac": ("Articulation sacro-iliaque", "f"),
    "plantar fascia": ("Fascia plantaire", "m"), "metatarsal": ("Métatarse", "m"), "navicular": ("Os naviculaire", "m"),
    "hamate": ("Os crochu", "m"), "labrum": ("Labrum", "m"), "rotator cuff": ("Coiffe des rotateurs", "f"), "ucl": ("Ligament collatéral ulnaire", "m"), "lumbar": ("Lombaires", "fp"), "spine": ("Colonne vertébrale", "f"),
}

TYPES = {
    "sprain": "entorse", "high-sprain": "entorse haute", "strain": "élongation", "soreness": "douleurs", "sore": "douleurs", "contusion": "contusion",
    "bone bruise": "contusion osseuse", "bruise": "contusion", "fracture": "fracture", "stress fracture": "fracture de fatigue",
    "tear": "déchirure", "torn": "déchirure", "partially torn": "déchirure partielle", "partial tear": "déchirure partielle",
    "surgery": "opération", "repair": "réparation", "injury management": "gestion de la blessure", "injury recovery": "rétablissement",
    "recovery": "rétablissement", "management": "gestion de la blessure", "tendinitis": "tendinite", "tendinopathy": "tendinopathie",
    "tendonitis": "tendinite", "inflammation": "inflammation", "dislocation": "luxation", "subluxation": "subluxation",
    "spasms": "spasmes", "spasm": "spasmes", "stress reaction": "réaction de stress osseux", "laceration": "coupure",
    "impingement": "conflit articulaire", "effusion": "épanchement", "bursitis": "bursite", "injury": "blessure",
    "concussion": "commotion cérébrale", "fasciitis": "aponévrosite", "irritation": "irritation", "tightness": "raideur",
    "discomfort": "gêne", "pain": "douleur", "swelling": "gonflement", "hyperextension": "hyperextension", "rupture": "rupture",
    "reconstruction": "reconstruction", "sore throat": "mal de gorge", "illness": "maladie", "infection": "infection",
    "rest": "repos", "post-surgical": "suites opératoires", "procedure": "intervention",
}
ORDINALS = {"first": "1er", "second": "2e", "third": "3e", "fourth": "4e", "fifth": "5e"}
SIDES = {"left": {"m": "gauche", "f": "gauche", "mp": "gauches", "fp": "gauches"}, "right": {"m": "droit", "f": "droite", "mp": "droits", "fp": "droites"}}


def _longest(words: list[str], i: int, table: dict) -> tuple[str | None, int]:
    for size in (3, 2, 1):
        if i + size <= len(words):
            key = " ".join(words[i:i + size])
            if key in table:
                return key, size
    return None, 0


def injury_fr(reason: str) -> str:
    """Traduit un motif du rapport. Renvoie "" si la traduction n'est pas sûre (l'anglais est alors affiché)."""
    raw = re.sub(r"\s+", " ", (reason or "").strip())
    low = raw.lower()
    if low in REASON_FR:
        return REASON_FR[low]
    if low.startswith("injury/illness"):
        low = low[len("injury/illness"):].lstrip(" -;:")
    elif not low:
        return ""
    if low in REASON_FR:
        return REASON_FR[low]
    low = low.replace("high ankle sprain", "ankle high-sprain")
    parts_out: list[list] = []
    for part in re.split(r"\s*[;/]\s*", low):
        words = [w for w in re.split(r"[\s,]+", part.replace("(", " ").replace(")", " ")) if w]
        side, body, types, i, ordinal = None, None, [], 0, ""
        while i < len(words):
            w = words[i]
            if w in ORDINALS and body is None:
                ordinal, i = ORDINALS[w], i + 1
                continue
            if w in SIDES and side is None:
                side, i = w, i + 1
                continue
            if w == "bilateral":
                side, i = "both", i + 1
                continue
            key, size = _longest(words, i, BODY)
            if key and body is None:
                body, i = key, i + size
                continue
            key, size = _longest(words, i, TYPES)
            if key:
                types.append(TYPES[key])
                i += size
                continue
            return ""  # mot inconnu : on garde l'anglais
        if body:
            label, gender = BODY[body]
            if ordinal:
                label = f"{ordinal} {label[:1].lower()}{label[1:]}"
            if side == "both":
                label += " (des deux côtés)"
            elif side:
                label += f" {SIDES[side][gender]}"
            parts_out.append([label, types])
        elif types and parts_out:
            parts_out[-1][1].extend(types)  # « Right Knee Contusion / Bone Bruise » : même genou
        elif types:
            parts_out.append(["", types])
    chunks = []
    for label, types in parts_out:
        kinds = ", ".join(dict.fromkeys(types))
        chunks.append(f"{label} : {kinds}" if label and kinds else (label or kinds))
    text = " ; ".join(chunks)
    return text[:1].upper() + text[1:] if text else ""


REPORT_FILE = re.compile(r"Injury-Report_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf")
REPORT_BASE = "https://ak-static.cms.nba.com/referee/injury/"


def report_time(url: str) -> datetime | None:
    m = REPORT_FILE.search(url or "")
    if not m:
        return None
    day, hh, mm, ampm = m.groups()
    hour = int(hh) % 12 + (12 if ampm == "PM" else 0)
    return datetime.strptime(day, "%Y-%m-%d").replace(hour=hour, minute=int(mm))


def report_url(when: datetime) -> str:
    hour12 = when.hour % 12 or 12
    return f"{REPORT_BASE}Injury-Report_{when:%Y-%m-%d}_{hour12:02d}_{when.minute:02d}{'AM' if when.hour < 12 else 'PM'}.pdf"


def _latest_report() -> tuple[str, bytes]:
    """Le rapport le plus récent : la page officielle donne la liste du jour, sinon on remonte le temps."""
    candidates: list[str] = []
    try:
        season = nba.current_season()
        page = net.nba_page(f"https://official.nba.com/nba-injury-report-{season}-season/")
        found = {m.group(0) for m in REPORT_FILE.finditer(page)}
        candidates = [REPORT_BASE + name for name in sorted(found, key=lambda n: report_time(n) or datetime.min, reverse=True)][:3]
    except SourceError:
        pass
    now = nba.et_now().replace(tzinfo=None)
    slot = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    for k in range(12):
        url = report_url(slot - timedelta(minutes=15 * k))
        if url not in candidates:
            candidates.append(url)
    last: Exception | None = None
    for url in candidates:
        try:
            return url, net.injury_pdf(url)
        except NotAvailable as exc:
            last = exc
            continue
    raise SourceError("aucun rapport des blessures récent n'a été trouvé", source="rapport des blessures") from last


def pdf_words(data: bytes) -> list[list[tuple[float, float, str]]]:
    """Mots de chaque page du PDF, avec leur position (x, y)."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # installation antérieure à la version 1.5
        raise SourceError("il manque la bibliothèque pypdf : relance Parquet avec son lanceur pour la mettre à jour", source="rapport des blessures") from exc
    import io
    import logging

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    reader = PdfReader(io.BytesIO(data), strict=False)
    pages = []
    for page in reader.pages:
        words: list[tuple[float, float, str]] = []

        def visit(text, cm, tm, font, size, words=words):
            t = (text or "").strip()
            if t:
                words.append((float(tm[4]), float(tm[5]), t))

        page.extract_text(visitor_text=visit)
        pages.append(words)
    return pages


COLS = ("date", "time", "matchup", "team", "player", "status", "reason")
DEFAULT_STARTS = (0, 115, 195, 260, 420, 580, 660)


def _column_starts(words: list[tuple[float, float, str]]) -> tuple[tuple[float, ...], float | None]:
    by_line: dict[int, list[tuple[float, str]]] = {}
    for x, y, t in words:
        by_line.setdefault(round(y), []).append((x, t))
    for y, items in by_line.items():
        texts = [t for _, t in sorted(items)]
        if "Player" in texts and "Reason" in texts and "Matchup" in texts:
            xs = dict()
            games = [x for x, t in sorted(items) if t == "Game"]
            for x, t in sorted(items):
                xs.setdefault(t, x)
            if len(games) >= 2:
                return (0.0, games[1] - 4, xs["Matchup"] - 4, xs["Team"] - 4, xs["Player"] - 4, xs.get("Current", xs["Player"] + 160) - 4, xs["Reason"] - 4), float(y)
    return DEFAULT_STARTS, None


def parse_report_words(pages: list[list[tuple[float, float, str]]]) -> list[dict]:
    """Reconstruit les lignes du tableau à partir de la position des mots.

    Les motifs longs passent sur plusieurs lignes, centrées sur la ligne du joueur : chaque morceau
    est rattaché à la ligne de joueur la plus proche. Date, heure, match et équipe ne sont écrits
    qu'une fois par bloc : ils valent pour les lignes suivantes, y compris d'une page à l'autre.
    """
    rows: list[dict] = []
    for words in pages:
        starts, header_y = _column_starts(words)

        def col(x: float) -> str:
            idx = 0
            for i, s in enumerate(starts):
                if x >= s:
                    idx = i
            return COLS[idx]

        lines: dict[int, list[tuple[float, float, str]]] = {}
        for x, y, t in words:
            lines.setdefault(round(y), []).append((x, y, t))
        body = {}
        for y, items in lines.items():
            texts = " ".join(t for _, _, t in sorted(items))
            if header_y is not None and y <= header_y + 1:
                continue
            if texts.startswith("Injury Report:") or re.fullmatch(r"Page \d+ of \d+", texts):
                continue
            body[y] = items
        anchors = sorted(y for y, items in body.items() if any(col(x) != "reason" for x, _, _ in items))
        if not anchors:
            continue
        cells = {y: {c: [] for c in COLS} for y in anchors}
        for y, items in body.items():
            # Une ligne qui n'a que du motif appartient à la ligne de joueur la plus proche.
            target = y if y in cells else min(anchors, key=lambda a: (abs(a - y), a))
            for x, yy, t in items:
                cells[target][col(x)].append((yy, x, t))
        for y in anchors:
            rows.append({c: " ".join(t for _, _, t in sorted(cells[y][c], key=lambda w: (round(w[0]), w[1]))) for c in COLS})

    games: list[dict] = []
    cur = {"date": "", "time": "", "matchup": "", "team": ""}
    game = team = None
    for r in rows:
        for c in ("date", "time"):
            if r[c]:
                cur[c] = r[c]
        if r["matchup"] and r["matchup"] != cur["matchup"]:
            cur["matchup"] = r["matchup"]
            game = {"date": cur["date"], "time": cur["time"], "matchup": cur["matchup"], "teams": []}
            games.append(game)
            team = None
        if game is None:
            continue
        if r["team"]:
            team = {"name": r["team"], "submitted": True, "players": []}
            game["teams"].append(team)
        if team is None:
            continue
        if r["reason"].upper() == "NOT YET SUBMITTED" and not r["player"]:
            team["submitted"] = False
            continue
        if r["player"]:
            last, _, first = r["player"].partition(",")
            team["players"].append({"name": f"{first.strip()} {last.strip()}".strip(), "status": r["status"], "reason": r["reason"]})
    return games


def _us_to_iso(value: str) -> str:
    try:
        return datetime.strptime(value.strip(), "%m/%d/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def _player_lookup() -> dict[str, tuple[int, int | None]]:
    try:
        index, _ = nba.player_index()
    except SourceError:
        return {}
    fields = index.get("fields") or []
    pos = {name: i for i, name in enumerate(fields)}
    out: dict[str, tuple[int, int | None]] = {}
    for row in index.get("rows") or []:
        try:
            pid, first, last, team_id = row[pos["id"]], row[pos["first"]], row[pos["last"]], row[pos.get("teamId", 4)]
            active = row[pos["active"]] if "active" in pos else 1
        except (KeyError, IndexError):
            continue
        name = norm_name(f"{first} {last}")
        for key in {name, _without_suffix(name)}:
            if key and (key not in out or active):
                out[key] = (pid, team_id)
    return out


def enrich_report(games: list[dict]) -> list[dict]:
    """Ajoute les identifiants (équipes, joueurs, match) et les libellés en français."""
    lookup = _player_lookup()
    sched = nba._schedule_or_none()
    by_key = {}
    for g in (sched or {}).get("games") or []:
        by_key[(g["etDate"], (g.get("away") or {}).get("tri"), (g.get("home") or {}).get("tri"))] = g
    out = []
    for g in games:
        day = _us_to_iso(g["date"])
        away_tri, _, home_tri = g["matchup"].partition("@")
        found = by_key.get((day, away_tri, home_tri))
        teams = []
        for t in g["teams"]:
            meta = _team_by_name(t["name"])
            players = []
            for p in t["players"]:
                key = norm_name(p["name"])
                pid = lookup.get(key) or lookup.get(_without_suffix(key))
                status = p["status"].strip().lower()
                players.append(
                    {
                        "name": p["name"], "id": pid[0] if pid else None, "status": p["status"],
                        "statusFr": STATUS_FR.get(status, p["status"]), "level": STATUS_ORDER.get(status, 5),
                        "reason": p["reason"], "reasonFr": injury_fr(p["reason"]),
                    }
                )
            players.sort(key=lambda p: (p["level"], p["name"]))
            teams.append({"name": t["name"], "id": meta["id"] if meta else None, "tri": meta["tri"] if meta else "", "submitted": t["submitted"], "players": players})
        out.append({"date": day, "timeEt": g["time"].replace("(ET)", "").strip(), "matchup": g["matchup"], "gameId": found["id"] if found else None, "start": found["start"] if found else "", "teams": teams})
    return out


def injury_report() -> tuple[dict, dict]:
    def fetch() -> dict:
        if net.DEMO:
            from . import demo

            url, games = demo.INJURY_URL, demo.injury_report_games()
        else:
            url, data = _latest_report()
            games = parse_report_words(pdf_words(data))
        when = report_time(url)
        return {"url": url, "publishedEt": when.isoformat() if when else "", "games": enrich_report(games)}

    return nba._cache().get("injuries:latest", 15 * 60, fetch)


def injuries_for(team_id: int | None = None, game_id: str | None = None) -> tuple[dict, dict]:
    data, meta = injury_report()
    games = data["games"]
    if game_id:
        games = [g for g in games if g["gameId"] == game_id]
    if team_id:
        games = [{**g, "teams": [t for t in g["teams"] if t["id"] == team_id]} for g in games]
        games = [g for g in games if g["teams"]]
    return {**data, "games": games}, meta


# ---------------------------------------------------------------------------
# Transactions officielles
# ---------------------------------------------------------------------------

MOVES_URL = "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json"
TYPE_FR = {"Signing": "Signature", "Waive": "Libéré", "AwardOnWaivers": "Récupéré (waivers)", "ContractConverted": "Contrat modifié", "Trade": "Échange"}
POS_FR = {
    "guard": "arrière", "forward": "ailier", "center": "pivot", "guard-forward": "arrière-ailier", "forward-guard": "ailier-arrière",
    "forward-center": "ailier-pivot", "center-forward": "pivot-ailier",
}
NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6}


def contract_fr(text: str) -> str:
    t = (text or "").strip().rstrip(".").lower()
    t = re.sub(r"^(?:a|an|the)\s+", "", t)
    simple = {
        "rest-of-season contract": "contrat jusqu'à la fin de la saison", "two-way contract": "contrat two-way",
        "10-day contract": "contrat de 10 jours", "second 10-day contract": "deuxième contrat de 10 jours",
        "exhibit 10 contract": "contrat Exhibit 10 (camp d'entraînement)", "rookie scale contract": "contrat de rookie",
        "multi-year contract": "contrat pluriannuel", "multi-year contract extension": "prolongation de contrat pluriannuelle",
        "rookie scale contract extension": "prolongation de contrat de rookie", "rookie scale extension": "prolongation de contrat de rookie", "contract extension": "prolongation de contrat", "extension": "prolongation de contrat",
        "standard nba contract": "contrat NBA standard", "standard contract": "contrat NBA standard", "contract": "contrat",
        "rookie contract": "contrat de rookie", "exhibit 9 contract": "contrat Exhibit 9 (camp d'entraînement)",
    }
    if t in simple:
        return simple[t]
    m = re.fullmatch(r"(one|two|three|four|five|six|\d)[ -]year (?:contract|deal)(?: extension)?", t)
    if m:
        n = NUMBERS[m.group(1)]
        return f"contrat d'un an" if n == 1 else f"contrat de {n} ans"
    return text.strip().rstrip(".")


def _who(pos: str | None, name: str) -> str:
    p = POS_FR.get((pos or "").lower())
    return f"{name} ({p})" if p else name


def _asset_fr(what: str) -> str:
    m = re.match(r"(?:(guard|forward|center|guard-forward|forward-guard|forward-center|center-forward) )?(.+)$", what.strip(), re.I)
    pos, rest = (m.group(1), m.group(2)) if m else (None, what)
    pick = re.fullmatch(r"(?:the )?(\d{4}) (first|second)[- ]round (?:draft )?pick(.*)", rest.strip(), re.I)
    if pick:
        tour = "1er" if pick.group(2).lower() == "first" else "2e"
        return f"un choix de {tour} tour de draft {pick.group(1)}"
    if re.fullmatch(r"cash(?: considerations)?", rest.strip(), re.I):
        return "une compensation financière"
    if "rights to" in rest.lower():
        return f"les droits de {re.sub(r'(?i)^(?:the )?draft rights to ', '', rest).strip()}"
    return _who(pos, rest.strip())


def transaction_fr(kind: str, desc: str) -> str:
    """Phrase en français, sans le nom de l'équipe (affiché à côté). "" si la phrase n'est pas reconnue."""
    d = re.sub(r"\s+", " ", (desc or "").strip()).rstrip(".")
    pos = r"(?:(guard|forward|center|guard-forward|forward-guard|forward-center|center-forward) )?"
    if kind == "Signing":
        m = re.match(rf"^.+? (?:re-)?signed (?:free agent )?{pos}(.+?)(?: to (?:a |an )?(.+))?$", d, re.I)
        if m:
            contract = contract_fr(m.group(3)) if m.group(3) else ""
            return f"Signe {_who(m.group(1), m.group(2))}" + (f", {contract}" if contract else "")
    elif kind == "Waive":
        m = re.match(rf"^.+? waived {pos}(.+)$", d, re.I)
        if m:
            return f"Libère {_who(m.group(1), m.group(2))}"
    elif kind == "AwardOnWaivers":
        m = re.match(rf"^.+? claimed {pos}(.+?) off waivers.*$", d, re.I)
        if m:
            return f"Récupère {_who(m.group(1), m.group(2))} via les waivers"
    elif kind == "ContractConverted":
        m = re.match(rf"^.+? converted the contract of {pos}(.+?) (?:to|into) (?:a |an )?(.+)$", d, re.I)
        if m:
            return f"Change le contrat de {_who(m.group(1), m.group(2))} en {contract_fr(m.group(3))}"
    elif kind == "Trade":
        m = re.match(r"^.+? received (.+?) from (.+)$", d, re.I)
        if m:
            other = _team_by_name(m.group(2))
            source = f"des {other['name']}" if other else f"de {m.group(2)}"
            return f"Reçoit {_asset_fr(m.group(1))} {source}"
    return ""


def _fetch_moves() -> dict:
    raw = net.nba_file_json(MOVES_URL)
    rows = ((raw or {}).get("NBA_Player_Movement") or {}).get("rows") or []
    items = []
    for r in rows:
        kind = r.get("Transaction_Type") or ""
        desc = _txt(r.get("TRANSACTION_DESCRIPTION"), 500)
        pid = _int_or_none(r.get("PLAYER_ID")) or None
        items.append(
            {
                "date": str(r.get("TRANSACTION_DATE") or "")[:10],
                "type": kind,
                "typeFr": TYPE_FR.get(kind, kind),
                "teamId": _int_or_none(r.get("TEAM_ID")),
                "playerId": pid,
                "text": transaction_fr(kind, desc),
                "original": desc,
                "group": str(r.get("GroupSort") or ""),
            }
        )
    items.sort(key=lambda x: (x["date"], x["group"]), reverse=True)
    return {"items": items}


def transactions(team_id: int | None = None, player_id: int | None = None, kind: str | None = None, days: int | None = 120, limit: int = 300) -> tuple[dict, dict]:
    data, meta = nba._cache().get("moves:all", 60 * 60, _fetch_moves)
    items = data["items"]
    if days:
        since = (nba.game_day_et() - timedelta(days=days)).isoformat()
        items = [x for x in items if x["date"] >= since]
    if team_id:
        items = [x for x in items if x["teamId"] == team_id]
    if player_id:
        items = [x for x in items if x["playerId"] == player_id]
    if kind:
        items = [x for x in items if x["type"] == kind]
    return {"items": items[:limit], "total": len(items)}, meta
