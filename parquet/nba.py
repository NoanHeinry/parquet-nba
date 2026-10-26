"""Récupération et mise en forme des données NBA.

Deux familles de sources :
- le CDN de NBA.com (fichiers JSON publics) : scores en direct, box scores, play-by-play, calendrier ;
- stats.nba.com : effectifs, fiches joueurs, carrières, palmarès, classements, historique des franchises.

Chaque fonction publique renvoie (données, méta) où méta indique l'heure de mise à jour
et si la donnée vient du cache faute de réponse de la source (stale).
"""

from __future__ import annotations

from collections import defaultdict
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from . import teams_meta, wiki
from .cache import Cache
from .net import NotAvailable, SourceError, cdn_json, result_sets, stats_json

try:  # Fuseau horaire de New York (les « journées NBA » sont en heure de l'Est).
    from zoneinfo import ZoneInfo

    _ET = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001 - Windows sans base tz : calcul manuel plus bas
    _ET = None

CACHE: Cache | None = None


def init(cache: Cache) -> None:
    global CACHE
    CACHE = cache


def _cache() -> Cache:
    assert CACHE is not None, "nba.init() n'a pas été appelé"
    return CACHE


# ---------------------------------------------------------------------------
# Dates et saisons
# ---------------------------------------------------------------------------


def et_now() -> datetime:
    if _ET is not None:
        return datetime.now(_ET)
    utc = datetime.now(timezone.utc)
    year = utc.year
    march = datetime(year, 3, 8, 7, tzinfo=timezone.utc)
    dst_start = march + timedelta(days=(6 - march.weekday()) % 7)
    november = datetime(year, 11, 1, 6, tzinfo=timezone.utc)
    dst_end = november + timedelta(days=(6 - november.weekday()) % 7)
    offset = -4 if dst_start <= utc < dst_end else -5
    return utc.astimezone(timezone(timedelta(hours=offset)))


def game_day_et() -> date:
    """La journée NBA en cours : elle bascule à 6 h du matin, heure de New York."""
    return (et_now() - timedelta(hours=6)).date()


def current_season_start() -> int:
    today = et_now().date()
    return today.year if today.month >= 9 else today.year - 1


def season_label(start_year: int) -> str:
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def current_season() -> str:
    return season_label(current_season_start())


def previous_season() -> str:
    return season_label(current_season_start() - 1)


def valid_season(value: str | None) -> str | None:
    if value and re.fullmatch(r"(19|20)\d\d-\d\d", value):
        return value
    return None


# ---------------------------------------------------------------------------
# Petits utilitaires de conversion
# ---------------------------------------------------------------------------


def _int(value: Any, default: int | None = 0) -> int | None:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _iso_duration_seconds(value: Any) -> float | None:
    """« PT05M23.40S » -> 323.4 ; « 21:25 » -> 1285."""
    if not value or not isinstance(value, str):
        return None
    m = re.fullmatch(r"PT(?:(\d+)M)?(?:([\d.]+)S)?", value)
    if m:
        return int(m.group(1) or 0) * 60 + float(m.group(2) or 0)
    m = re.fullmatch(r"(\d+):(\d+)(?:\.\d+)?", value)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    return None


def fmt_clock(value: Any) -> str:
    """Horloge de match : « 5:23 », ou « 23.4 » dans la dernière minute."""
    seconds = _iso_duration_seconds(value)
    if seconds is None:
        return ""
    if seconds < 60:
        return f"{seconds:.1f}"
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def fmt_minutes(value: Any) -> str:
    seconds = _iso_duration_seconds(value)
    if not seconds:
        return ""
    return f"{int(seconds // 60)}:{int(round(seconds % 60)):02d}"


def _et_date(value: Any) -> str:
    """« 10/13/2026 00:00:00 » ou « 2026-10-13… » -> « 2026-10-13 »."""
    if not value:
        return ""
    s = str(value)
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return s[:10]


_MONTHS = {m: i for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], 1)}


def _us_date(value: Any) -> str:
    """« DEC 26, 2002 » / « Oct 13, 2026 » / « Mar 03 2014 » -> ISO."""
    if not value:
        return ""
    m = re.match(r"([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})", str(value).strip())
    if not m:
        return str(value)[:10]
    month = _MONTHS.get(m.group(1).upper())
    if not month:
        return ""
    return f"{m.group(3)}-{month:02d}-{int(m.group(2)):02d}"


def _parse_utc(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


GAME_KINDS = {"1": "pre", "2": "reg", "3": "allstar", "4": "playoffs", "5": "playin", "6": "cup"}


def game_kind(game_id: str) -> str:
    return GAME_KINDS.get(game_id[2:3], "other") if game_id else "other"


# ---------------------------------------------------------------------------
# Matchs : mise en forme commune (scoreboard live, scoreboardv3, calendrier)
# ---------------------------------------------------------------------------


def _team_side(t: dict | None) -> dict | None:
    if not t:
        return None
    tid = _int(t.get("teamId"), None)
    return {
        "id": tid or None,
        "tri": t.get("teamTricode") or "",
        "city": t.get("teamCity") or "",
        "name": t.get("teamName") or "",
        "wins": _int(t.get("wins"), None),
        "losses": _int(t.get("losses"), None),
        "score": _int(t.get("score"), None),
        "periods": [_int(p.get("score")) for p in (t.get("periods") or []) if isinstance(p, dict)],
        "timeouts": _int(t.get("timeoutsRemaining"), None),
        "bonus": t.get("inBonus") in ("1", 1, True),
        "seed": _int(t.get("seed"), None) or None,
    }


def _leader(x: dict | None) -> dict | None:
    if not x or not x.get("personId"):
        return None
    return {
        "id": _int(x.get("personId")),
        "name": x.get("name") or "",
        "jersey": x.get("jerseyNum") or "",
        "pos": x.get("position") or "",
        "tri": x.get("teamTricode") or "",
        "pts": _int(x.get("points"), None),
        "reb": _int(x.get("rebounds"), None),
        "ast": _int(x.get("assists"), None),
    }


def _broadcasters(g: dict) -> list[str]:
    bc = g.get("broadcasters") or {}
    names: list[str] = []
    for key in ("nationalBroadcasters", "nationalTvBroadcasters", "nationalOttBroadcasters"):
        for b in bc.get(key) or []:
            name = (b or {}).get("broadcasterDisplay")
            if name and name not in names:
                names.append(name)
    return names


def normalize_game(g: dict, et_date: str = "") -> dict:
    gid = str(g.get("gameId") or "")
    start = g.get("gameDateTimeUTC") or g.get("gameTimeUTC") or ""
    if start.startswith("1900"):
        start = ""
    leaders = None
    gl = g.get("gameLeaders")
    if isinstance(gl, dict):
        home_l, away_l = _leader(gl.get("homeLeaders")), _leader(gl.get("awayLeaders"))
        if home_l or away_l:
            leaders = {"home": home_l, "away": away_l}
    top = []
    for p in g.get("pointsLeaders") or []:
        if p and p.get("personId"):
            top.append(
                {
                    "id": _int(p.get("personId")),
                    "name": f"{p.get('firstName', '')} {p.get('lastName', '')}".strip(),
                    "teamId": _int(p.get("teamId")),
                    "tri": p.get("teamTricode") or "",
                    "pts": _int(p.get("points"), None),
                }
            )
    status_text = g.get("gameStatusText") or ""
    return {
        "id": gid,
        "kind": game_kind(gid),
        "status": _int(g.get("gameStatus"), 1) or 1,
        "statusText": status_text.strip(),
        "period": _int(g.get("period")),
        "clock": fmt_clock(g.get("gameClock")),
        "start": start,
        "etDate": et_date or _et_date(g.get("gameDate") or g.get("gameDateEst") or g.get("gameEt")),
        "label": g.get("gameLabel") or "",
        "subLabel": g.get("gameSubLabel") or "",
        "series": g.get("seriesText") or "",
        "arena": g.get("arenaName") or "",
        "arenaCity": g.get("arenaCity") or "",
        "arenaState": g.get("arenaState") or "",
        "neutral": bool(g.get("isNeutral")),
        "postponed": "PPD" in status_text.upper() or "POSTPONED" in status_text.upper(),
        "tv": _broadcasters(g),
        "away": _team_side(g.get("awayTeam")),
        "home": _team_side(g.get("homeTeam")),
        "leaders": leaders,
        "topScorers": top,
    }


# ---------------------------------------------------------------------------
# Santé des sources (pour basculer vers stats.nba.com si le CDN refuse l'accès)
# ---------------------------------------------------------------------------


class _Health:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cdn_blocked_until = 0.0
        self.last_errors: dict[str, dict] = {}

    def record(self, source: str, exc: Exception | None) -> None:
        with self.lock:
            if exc is None:
                self.last_errors.pop(source, None)
            else:
                self.last_errors[source] = {"message": str(exc), "at": time.time()}

    def block_cdn(self) -> None:
        with self.lock:
            self.cdn_blocked_until = time.time() + 600

    def cdn_ok(self) -> bool:
        return time.time() >= self.cdn_blocked_until


HEALTH = _Health()


# ---------------------------------------------------------------------------
# Scoreboard du jour et calendrier
# ---------------------------------------------------------------------------


def _fetch_live_scoreboard() -> dict:
    raw = None
    source = "cdn"
    if HEALTH.cdn_ok():
        try:
            raw = cdn_json("liveData/scoreboard/todaysScoreboard_00.json")
            HEALTH.record("cdn", None)
        except SourceError as exc:
            HEALTH.record("cdn", exc)
            HEALTH.block_cdn()
    if raw is None:
        source = "stats"
        raw = stats_json("scoreboardv3", {"GameDate": game_day_et().isoformat(), "LeagueID": "00"})
    sb = (raw or {}).get("scoreboard") or {}
    day = sb.get("gameDate") or game_day_et().isoformat()
    games = [normalize_game(g, day) for g in sb.get("games") or []]
    return {"date": day, "games": games, "source": source}


def _live_ttl(data: dict) -> float:
    games = (data or {}).get("games") or []
    if any(g.get("status") == 2 for g in games):
        return 8
    now = datetime.now(timezone.utc)
    for g in games:
        start = _parse_utc(g.get("start") or "")
        if g.get("status") == 1 and start and start - now < timedelta(minutes=20):
            return 20
    return 60


def live_scoreboard() -> tuple[dict, dict]:
    return _cache().get("live:scoreboard", _live_ttl, _fetch_live_scoreboard)


def _fetch_schedule() -> dict:
    raw = None
    source = "cdn"
    if HEALTH.cdn_ok():
        try:
            raw = cdn_json("staticData/scheduleLeagueV2.json")
        except SourceError as exc:
            HEALTH.record("cdn", exc)
    if raw is None:
        source = "stats"
        raw = stats_json("scheduleleaguev2", {"LeagueID": "00", "Season": current_season()})
    ls = (raw or {}).get("leagueSchedule") or {}
    games: list[dict] = []
    for gd in ls.get("gameDates") or []:
        day = _et_date(gd.get("gameDate"))
        for g in gd.get("games") or []:
            games.append(normalize_game(g, day))
    games.sort(key=lambda g: (g["etDate"], g["start"] or "", g["id"]))
    return {
        "season": ls.get("seasonYear") or current_season(),
        "games": games,
        "dates": sorted({g["etDate"] for g in games if g["etDate"]}),
        "source": source,
    }


def schedule() -> tuple[dict, dict]:
    return _cache().get("schedule:current", 30 * 60, _fetch_schedule)


def _schedule_or_none() -> dict | None:
    try:
        return schedule()[0]
    except SourceError:
        return None


def find_game(game_id: str) -> dict | None:
    """Retrouve l'en-tête d'un match : état du scoreboard du jour, complété par le calendrier."""
    found = None
    live = _cache().peek("live:scoreboard")
    if live:
        for g in live[1].get("games") or []:
            if g["id"] == game_id:
                found = g
                break
    sched = _schedule_or_none()
    if sched:
        for g in sched["games"]:
            if g["id"] == game_id:
                return _merge_schedule_info([found], sched)[0] if found else g
    return found


def _merge_schedule_info(games: list[dict], sched: dict | None) -> list[dict]:
    if not sched:
        return games
    by_id = {g["id"]: g for g in sched["games"]}
    merged = []
    for g in games:
        s = by_id.get(g["id"])
        if s:
            g = dict(g)
            for key in ("arena", "arenaCity", "arenaState", "tv", "label", "subLabel"):
                if not g.get(key) and s.get(key):
                    g[key] = s[key]
            if not g.get("topScorers") and s.get("topScorers"):
                g["topScorers"] = s["topScorers"]
        merged.append(g)
    return merged


def _scoreboard_v3(day: str) -> tuple[list[dict], dict]:
    today = game_day_et()
    if day < (today - timedelta(days=3)).isoformat():
        ttl = 7 * 24 * 3600  # journée ancienne : les scores ne bougeront plus
    elif day < today.isoformat():
        ttl = 6 * 3600
    else:
        ttl = 60

    def fetch() -> list[dict]:
        raw = stats_json("scoreboardv3", {"GameDate": day, "LeagueID": "00"})
        sb = (raw or {}).get("scoreboard") or {}
        return [normalize_game(g, day) for g in sb.get("games") or []]

    return _cache().get(f"scoreboardv3:{day}", ttl, fetch)


def scoreboard(day: str | None) -> tuple[dict, dict]:
    live, meta = live_scoreboard()
    sched = _schedule_or_none()
    today = live["date"]
    day = day or today
    if day == today:
        games = _merge_schedule_info(live["games"], sched)
        source = live.get("source")
    else:
        games = [g for g in (sched or {}).get("games", []) if g["etDate"] == day]
        source = "schedule"
        needs_scores = day < today and any(g["status"] != 3 for g in games)
        sched_dates = (sched or {}).get("dates") or []
        outside = not sched_dates or day < sched_dates[0] or day > sched_dates[-1]
        if needs_scores or (not games and outside):
            # Calendrier incomplet ou date d'une autre saison : on demande le scoreboard de ce jour-là.
            try:
                v3_games, meta = _scoreboard_v3(day)
                if v3_games:
                    games = _merge_schedule_info(v3_games, sched)
                    source = "stats"
            except SourceError:
                pass
        if sched and source == "schedule":
            _, meta = schedule()
    dates = (sched or {}).get("dates") or []
    if today not in dates:
        dates = sorted(set(dates) | {today})
    prev_day = max((d for d in dates if d < day), default=None)
    next_day = min((d for d in dates if d > day), default=None)
    if dates and day <= dates[0]:
        # Avant le calendrier de la saison en cours : navigation jour par jour dans les archives.
        d = date.fromisoformat(day)
        prev_day = (d - timedelta(days=1)).isoformat()
        if day < dates[0]:
            next_day = min((d + timedelta(days=1)).isoformat(), dates[0])
    games.sort(key=lambda g: (g.get("start") or "", g["id"]))
    return (
        {
            "date": day,
            "today": today,
            "isToday": day == today,
            "prev": prev_day,
            "next": next_day,
            "season": (sched or {}).get("season") or current_season(),
            "games": games,
            "source": source,
        },
        meta,
    )


# ---------------------------------------------------------------------------
# Box score
# ---------------------------------------------------------------------------

_REASONS = {
    "INACTIVE_INJURY": "Blessé",
    "INACTIVE_ILLNESS": "Malade",
    "INACTIVE_PERSONAL": "Raisons personnelles",
    "INACTIVE_GLEAGUE_TWOWAY": "G League (contrat two-way)",
    "INACTIVE_GLEAGUE_ON_ASSIGNMENT": "En G League",
    "INACTIVE_SUSPENSION": "Suspendu",
    "INACTIVE_NOT_WITH_TEAM": "Absent de l'équipe",
    "INACTIVE_COACH": "Choix de l'entraîneur",
    "DNP_COACH": "Choix de l'entraîneur",
    "DNP_INJURY": "Blessé",
}


def _player_line(p: dict) -> dict:
    s = p.get("statistics") or {}
    seconds = _iso_duration_seconds(s.get("minutes")) or 0
    reason = p.get("notPlayingReason") or ""
    return {
        "id": _int(p.get("personId")),
        "order": _int(p.get("order"), 0),
        "name": p.get("name") or f"{p.get('firstName', '')} {p.get('familyName', '')}".strip(),
        "nameI": p.get("nameI") or "",
        "jersey": p.get("jerseyNum") or "",
        "pos": p.get("position") or "",
        "starter": str(p.get("starter")) == "1",
        "oncourt": str(p.get("oncourt")) == "1",
        "played": str(p.get("played")) == "1",
        "active": (p.get("status") or "ACTIVE") == "ACTIVE",
        "reason": _REASONS.get(reason, reason.replace("_", " ").capitalize() if reason else ""),
        "note": p.get("notPlayingDescription") or "",
        "min": fmt_minutes(s.get("minutes")),
        "sec": seconds,
        "pts": _int(s.get("points")),
        "reb": _int(s.get("reboundsTotal")),
        "oreb": _int(s.get("reboundsOffensive")),
        "dreb": _int(s.get("reboundsDefensive")),
        "ast": _int(s.get("assists")),
        "stl": _int(s.get("steals")),
        "blk": _int(s.get("blocks")),
        "tov": _int(s.get("turnovers")),
        "pf": _int(s.get("foulsPersonal")),
        "fgm": _int(s.get("fieldGoalsMade")),
        "fga": _int(s.get("fieldGoalsAttempted")),
        "tpm": _int(s.get("threePointersMade")),
        "tpa": _int(s.get("threePointersAttempted")),
        "ftm": _int(s.get("freeThrowsMade")),
        "fta": _int(s.get("freeThrowsAttempted")),
        "pm": _int(s.get("plusMinusPoints")),
    }


def _team_stats(s: dict | None) -> dict:
    s = s or {}
    return {
        "pts": _int(s.get("points")),
        "fgm": _int(s.get("fieldGoalsMade")),
        "fga": _int(s.get("fieldGoalsAttempted")),
        "fgPct": _num(s.get("fieldGoalsPercentage")),
        "tpm": _int(s.get("threePointersMade")),
        "tpa": _int(s.get("threePointersAttempted")),
        "tpPct": _num(s.get("threePointersPercentage")),
        "ftm": _int(s.get("freeThrowsMade")),
        "fta": _int(s.get("freeThrowsAttempted")),
        "ftPct": _num(s.get("freeThrowsPercentage")),
        "oreb": _int(s.get("reboundsOffensive")),
        "dreb": _int(s.get("reboundsDefensive")),
        "reb": _int(s.get("reboundsTotal")),
        "ast": _int(s.get("assists")),
        "stl": _int(s.get("steals")),
        "blk": _int(s.get("blocks")),
        "tov": _int(s.get("turnoversTotal") if s.get("turnoversTotal") is not None else s.get("turnovers")),
        "pf": _int(s.get("foulsPersonal")),
        "paint": _int(s.get("pointsInThePaint"), None),
        "fast": _int(s.get("pointsFastBreak"), None),
        "second": _int(s.get("pointsSecondChance"), None),
        "fromTov": _int(s.get("pointsFromTurnovers"), None),
        "bench": _int(s.get("benchPoints"), None),
        "biggestLead": _int(s.get("biggestLead"), None),
        "leadChanges": _int(s.get("leadChanges"), None),
        "timesTied": _int(s.get("timesTied"), None),
    }


def _box_from_live(raw: dict, header: dict | None) -> dict:
    g = (raw or {}).get("game") or {}
    arena = g.get("arena") or {}
    away, home = g.get("awayTeam") or {}, g.get("homeTeam") or {}
    game = {
        "id": g.get("gameId"),
        "kind": game_kind(str(g.get("gameId") or "")),
        "status": _int(g.get("gameStatus"), 1),
        "statusText": (g.get("gameStatusText") or "").strip(),
        "period": _int(g.get("period")),
        "clock": fmt_clock(g.get("gameClock")),
        "start": g.get("gameTimeUTC") or "",
        "arena": arena.get("arenaName") or "",
        "arenaCity": arena.get("arenaCity") or "",
        "arenaState": arena.get("arenaState") or "",
        "attendance": _int(g.get("attendance"), None),
        "sellout": str(g.get("sellout")) == "1",
        "duration": _int(g.get("duration"), None),
        "officials": [o.get("name") for o in g.get("officials") or [] if o.get("name")],
        "away": _team_side(away),
        "home": _team_side(home),
    }
    if header:
        for key in ("label", "subLabel", "series", "tv", "etDate", "neutral"):
            game[key] = header.get(key)
        if not game["arena"]:
            game["arena"], game["arenaCity"], game["arenaState"] = header.get("arena"), header.get("arenaCity"), header.get("arenaState")
    teams = {}
    for side, t in (("away", away), ("home", home)):
        players = [_player_line(p) for p in t.get("players") or []]
        teams[side] = {"stats": _team_stats(t.get("statistics")), "players": players}
    return {"available": True, "game": game, "teams": teams, "source": "cdn"}


def _box_from_stats(game_id: str, header: dict | None) -> dict:
    raw = stats_json(
        "boxscoretraditionalv3",
        {"GameID": game_id, "StartPeriod": 0, "EndPeriod": 0, "StartRange": 0, "EndRange": 0, "RangeType": 0},
    )
    b = (raw or {}).get("boxScoreTraditional") or {}
    teams = {}
    for side in ("away", "home"):
        t = b.get(f"{side}Team") or {}
        players = []
        for i, p in enumerate(t.get("players") or []):
            s = p.get("statistics") or {}
            minutes = s.get("minutes") or ""
            comment = (p.get("comment") or "").strip()
            line = _player_line(
                {
                    "personId": p.get("personId"),
                    "name": f"{p.get('firstName', '')} {p.get('familyName', '')}".strip(),
                    "nameI": p.get("nameI"),
                    "jerseyNum": p.get("jerseyNum"),
                    "position": p.get("position"),
                    "starter": "1" if p.get("position") else "0",
                    "played": "1" if minutes and minutes not in ("0:00", "00:00") else "0",
                    "status": "ACTIVE",
                    "statistics": s,
                }
            )
            line["min"] = minutes if line["played"] else ""
            line["sec"] = _iso_duration_seconds(minutes) or 0
            if comment and not line["played"]:
                line["reason"] = comment
            line["order"] = i
            players.append(line)
        teams[side] = {"stats": _team_stats(t.get("statistics")), "players": players}
    game = dict(header) if header else {"id": game_id, "kind": game_kind(game_id), "status": 3, "statusText": "Final"}
    for side in ("away", "home"):
        t = b.get(f"{side}Team") or {}
        side_info = dict(game.get(side) or {})
        side_info.update(
            {
                "id": _int(t.get("teamId"), None) or side_info.get("id"),
                "tri": t.get("teamTricode") or side_info.get("tri", ""),
                "city": t.get("teamCity") or side_info.get("city", ""),
                "name": t.get("teamName") or side_info.get("name", ""),
                "score": teams[side]["stats"]["pts"],
            }
        )
        side_info.setdefault("periods", [])
        game[side] = side_info
    return {"available": True, "game": game, "teams": teams, "source": "stats"}


def _box_ttl(data: dict) -> float:
    status = ((data or {}).get("game") or {}).get("status")
    if not data.get("available"):
        return 60
    return 8 if status == 2 else (6 * 3600 if status == 3 else 30)


def game_box(game_id: str) -> tuple[dict, dict]:
    def fetch() -> dict:
        header = find_game(game_id)
        if HEALTH.cdn_ok():
            try:
                return _box_from_live(cdn_json(f"liveData/boxscore/boxscore_{game_id}.json"), header)
            except NotAvailable:
                if header and header.get("status") == 1:
                    return {"available": False, "game": header, "teams": None, "source": "cdn"}
            except SourceError as exc:
                HEALTH.record("cdn", exc)
        if header and header.get("status") == 1:
            return {"available": False, "game": header, "teams": None, "source": "schedule"}
        return _box_from_stats(game_id, header)

    return _cache().get(f"box:{game_id}", _box_ttl, fetch)


# ---------------------------------------------------------------------------
# Play-by-play
# ---------------------------------------------------------------------------


def _finish_actions(actions: list[dict]) -> list[dict]:
    """Complète le score courant et repère les actions qui ont fait évoluer le score."""
    away = home = 0
    for a in actions:
        new_away = a.pop("_away", None)
        new_home = a.pop("_home", None)
        if new_away is not None and new_home is not None:
            scoring = (new_away, new_home) != (away, home)
            away, home = new_away, new_home
        else:
            scoring = False
        a["away"], a["home"], a["scoring"] = away, home, scoring
    return actions


def _pbp_from_live(raw: dict) -> dict:
    actions = []
    for a in ((raw or {}).get("game") or {}).get("actions") or []:
        kind = a.get("actionType") or ""
        actions.append(
            {
                "n": _int(a.get("actionNumber")),
                "period": _int(a.get("period")),
                "clock": fmt_clock(a.get("clock")),
                "teamId": _int(a.get("teamId"), None),
                "tri": a.get("teamTricode") or "",
                "personId": _int(a.get("personId"), None),
                "player": a.get("playerNameI") or "",
                "type": kind,
                "sub": a.get("subType") or "",
                "desc": a.get("description") or "",
                "fg": a.get("isFieldGoal") == 1,
                "made": a.get("shotResult") == "Made",
                "x": _num(a.get("xLegacy")),
                "y": _num(a.get("yLegacy")),
                "dist": _num(a.get("shotDistance")),
                "three": kind == "3pt",
                "_away": _int(a.get("scoreAway"), None),
                "_home": _int(a.get("scoreHome"), None),
            }
        )
    actions = _finish_actions(actions)
    ended = any(a["type"] == "game" and a["sub"] == "end" for a in actions)
    return {"available": True, "actions": actions, "ended": ended, "source": "cdn"}


def _pbp_from_stats(game_id: str) -> dict:
    raw = stats_json("playbyplayv3", {"GameID": game_id, "StartPeriod": 0, "EndPeriod": 0})
    actions = []
    for a in ((raw or {}).get("game") or {}).get("actions") or []:
        kind = a.get("actionType") or ""
        actions.append(
            {
                "n": _int(a.get("actionNumber")),
                "period": _int(a.get("period")),
                "clock": fmt_clock(a.get("clock")),
                "teamId": _int(a.get("teamId"), None) or None,
                "tri": a.get("teamTricode") or "",
                "personId": _int(a.get("personId"), None) or None,
                "player": a.get("playerNameI") or "",
                "type": kind.lower(),
                "sub": a.get("subType") or "",
                "desc": a.get("description") or "",
                "fg": a.get("isFieldGoal") == 1,
                "made": a.get("shotResult") == "Made",
                "x": _num(a.get("xLegacy")),
                "y": _num(a.get("yLegacy")),
                "dist": _num(a.get("shotDistance")),
                "three": a.get("shotValue") == 3,
                "_away": _int(a.get("scoreAway"), None),
                "_home": _int(a.get("scoreHome"), None),
            }
        )
    actions = _finish_actions(actions)
    return {"available": True, "actions": actions, "ended": True, "source": "stats"}


def _pbp_ttl(data: dict) -> float:
    if not data.get("available"):
        return 60
    return 6 * 3600 if data.get("ended") else 8


def game_pbp(game_id: str) -> tuple[dict, dict]:
    def fetch() -> dict:
        header = find_game(game_id)
        if HEALTH.cdn_ok():
            try:
                return _pbp_from_live(cdn_json(f"liveData/playbyplay/playbyplay_{game_id}.json"))
            except NotAvailable:
                if header and header.get("status") == 1:
                    return {"available": False, "actions": [], "ended": False, "source": "cdn"}
            except SourceError as exc:
                HEALTH.record("cdn", exc)
        if header and header.get("status") == 1:
            return {"available": False, "actions": [], "ended": False, "source": "schedule"}
        data = _pbp_from_stats(game_id)
        if header and header.get("status") == 2:
            data["ended"] = False
        return data

    return _cache().get(f"pbp:{game_id}", _pbp_ttl, fetch)


# ---------------------------------------------------------------------------
# Classement
# ---------------------------------------------------------------------------


def _fetch_standings(season: str) -> list[dict]:
    raw = stats_json("leaguestandingsv3", {"LeagueID": "00", "Season": season, "SeasonType": "Regular Season", "SeasonYear": ""})
    rows = []
    for r in result_sets(raw).get("Standings", []):
        tid = _int(r.get("TeamID"))
        meta = teams_meta.team(tid) or {}
        rows.append(
            {
                "teamId": tid,
                "tri": meta.get("tri", ""),
                "city": r.get("TeamCity") or meta.get("city", ""),
                "name": r.get("TeamName") or meta.get("name", ""),
                "conf": r.get("Conference") or meta.get("conf", ""),
                "div": r.get("Division") or meta.get("div", ""),
                "rank": _int(r.get("PlayoffRank")),
                "w": _int(r.get("WINS")),
                "l": _int(r.get("LOSSES")),
                "pct": _num(r.get("WinPCT")) or 0.0,
                "gb": _num(r.get("ConferenceGamesBack")) or 0.0,
                "home": r.get("HOME") or "",
                "road": r.get("ROAD") or "",
                "l10": r.get("L10") or "",
                "streak": (r.get("strCurrentStreak") or "").strip(),
                "confRecord": r.get("ConferenceRecord") or "",
                "divRank": _int(r.get("DivisionRank")),
                "ppg": _num(r.get("PointsPG")),
                "oppg": _num(r.get("OppPointsPG")),
                "diff": _num(r.get("DiffPointsPG")),
                "clinch": (r.get("ClinchIndicator") or "").replace("-", "").strip(),
            }
        )
    rows.sort(key=lambda r: (r["conf"], r["rank"] or 99))
    return rows


def standings(season: str | None = None) -> tuple[dict, dict]:
    cur = current_season()
    season = valid_season(season) or cur
    ttl = 20 * 60 if season == cur else 24 * 3600
    rows, meta = _cache().get(f"standings:{season}", ttl, lambda: _fetch_standings(season))
    shown = season
    fallback = False
    if season == cur and rows and all(r["w"] + r["l"] == 0 for r in rows):
        prev = previous_season()
        try:
            rows, meta = _cache().get(f"standings:{prev}", 24 * 3600, lambda: _fetch_standings(prev))
            shown, fallback = prev, True
        except SourceError:
            pass
    return {"season": shown, "requested": season, "fallback": fallback, "rows": rows}, meta


def teams_overview() -> tuple[dict, dict]:
    records: dict[int, dict] = {}
    meta: dict = {"fetchedAt": time.time(), "stale": False}
    season = None
    fallback = False
    try:
        st, meta = standings()
        season, fallback = st["season"], st["fallback"]
        records = {r["teamId"]: r for r in st["rows"]}
    except SourceError as exc:
        meta = {"fetchedAt": time.time(), "stale": True, "error": str(exc)}
    out = []
    for t in teams_meta.TEAMS:
        r = records.get(t["id"])
        out.append({**t, "record": {"w": r["w"], "l": r["l"], "rank": r["rank"]} if r else None})
    return {"teams": out, "season": season, "fallback": fallback}, meta


# ---------------------------------------------------------------------------
# Playoffs (arbre et séries)
# ---------------------------------------------------------------------------

SERIES_ROUNDS = {
    "0010": (1, "1er tour", "East"),
    "0011": (1, "1er tour", "East"),
    "0012": (1, "1er tour", "East"),
    "0013": (1, "1er tour", "East"),
    "0014": (1, "1er tour", "West"),
    "0015": (1, "1er tour", "West"),
    "0016": (1, "1er tour", "West"),
    "0017": (1, "1er tour", "West"),
    "0020": (2, "Demi-finales de conférence", "East"),
    "0021": (2, "Demi-finales de conférence", "East"),
    "0022": (2, "Demi-finales de conférence", "West"),
    "0023": (2, "Demi-finales de conférence", "West"),
    "0030": (3, "Finales de conférence", "East"),
    "0031": (3, "Finales de conférence", "West"),
    "0040": (4, "Finales NBA", "Finales"),
}

BRACKET_ORDER = {
    "east": {
        "round1": ["0010", "0013", "0012", "0011"],
        "semifinals": ["0020", "0021"],
        "finals": "0030",
    },
    "west": {
        "round1": ["0014", "0017", "0016", "0015"],
        "semifinals": ["0022", "0023"],
        "finals": "0031",
    },
    "finals": "0040",
}


def _build_playoff_bracket(season: str, cp_rows: list[dict], gf_rows: list[dict], seeds: dict[int, int] | None = None) -> dict:
    seeds = seeds or {}
    game_scores: dict[str, dict[int, dict]] = defaultdict(dict)
    for r in gf_rows:
        gid = r.get("GAME_ID")
        tid = _int(r.get("TEAM_ID"))
        if gid and tid:
            game_scores[gid][tid] = {
                "pts": _int(r.get("PTS")),
                "wl": r.get("WL"),
                "date": r.get("GAME_DATE"),
            }

    series_games: dict[str, list[dict]] = defaultdict(list)
    for r in cp_rows:
        sid = r.get("SERIES_ID")
        if sid:
            series_games[sid].append(r)

    series_dict = {}
    champion = None

    for sid, games in series_games.items():
        games.sort(key=lambda g: _int(g.get("GAME_NUM"), 0))
        g1 = games[0]
        t1_id = _int(g1.get("HOME_TEAM_ID"))
        t2_id = _int(g1.get("VISITOR_TEAM_ID"))
        t1_meta = teams_meta.team(t1_id)
        t2_meta = teams_meta.team(t2_id)

        parsed_games = []
        w1, w2 = 0, 0
        for g in games:
            gid = g.get("GAME_ID")
            gnum = _int(g.get("GAME_NUM"), 1)
            h_id = _int(g.get("HOME_TEAM_ID"))
            v_id = _int(g.get("VISITOR_TEAM_ID"))
            scores = game_scores.get(gid, {})
            h_data = scores.get(h_id, {})
            v_data = scores.get(v_id, {})
            h_pts = h_data.get("pts")
            v_pts = v_data.get("pts")
            date_str = h_data.get("date") or v_data.get("date")
            played = h_pts is not None and v_pts is not None

            game_winner = None
            if played:
                if h_pts > v_pts:
                    game_winner = h_id
                elif v_pts > h_pts:
                    game_winner = v_id

            if game_winner == t1_id:
                w1 += 1
            elif game_winner == t2_id:
                w2 += 1

            parsed_games.append(
                {
                    "gameNum": gnum,
                    "gameId": gid,
                    "homeTeamId": h_id,
                    "visitorTeamId": v_id,
                    "homePts": h_pts,
                    "visitorPts": v_pts,
                    "winnerId": game_winner,
                    "date": date_str,
                    "played": played,
                }
            )

        suffix = sid[-4:]
        round_info = SERIES_ROUNDS.get(suffix, (1, "Série", "NBA"))
        round_num, round_name, conf = round_info
        winner_id = t1_id if w1 >= 4 else (t2_id if w2 >= 4 else None)
        if suffix == "0040" and winner_id:
            champion = teams_meta.team(winner_id)

        played_count = sum(1 for g in parsed_games if g["played"])
        t1_tri = t1_meta["tri"] if t1_meta else "?"
        t2_tri = t2_meta["tri"] if t2_meta else "?"
        if winner_id:
            status = "Terminée"
            win_tri = t1_tri if winner_id == t1_id else t2_tri
            summary = f"{win_tri} gagne {max(w1, w2)}-{min(w1, w2)}"
        elif played_count > 0:
            status = "En cours"
            if w1 > w2:
                summary = f"{t1_tri} mène {w1}-{w2}"
            elif w2 > w1:
                summary = f"{t2_tri} mène {w2}-{w1}"
            else:
                summary = f"Égalité {w1}-{w2}"
        else:
            status = "À venir"
            summary = "À venir"

        t1_dict = {
            "id": t1_id,
            "tri": t1_tri,
            "city": t1_meta["city"] if t1_meta else "",
            "name": t1_meta["name"] if t1_meta else "",
            "fullName": t1_meta["fullName"] if t1_meta else "",
            "seed": seeds.get(t1_id),
            "wins": w1,
        }
        t2_dict = {
            "id": t2_id,
            "tri": t2_tri,
            "city": t2_meta["city"] if t2_meta else "",
            "name": t2_meta["name"] if t2_meta else "",
            "fullName": t2_meta["fullName"] if t2_meta else "",
            "seed": seeds.get(t2_id),
            "wins": w2,
        }
        series_dict[suffix] = {
            "id": sid,
            "suffix": suffix,
            "round": round_num,
            "roundName": round_name,
            "conference": conf,
            "topTeam": t1_dict,
            "bottomTeam": t2_dict,
            "winnerId": winner_id,
            "status": status,
            "summary": summary,
            "games": parsed_games,
        }

    return {
        "season": season,
        "available": bool(series_dict),
        "champion": champion,
        "east": {
            "round1": [series_dict.get(s) for s in BRACKET_ORDER["east"]["round1"] if s in series_dict],
            "semifinals": [series_dict.get(s) for s in BRACKET_ORDER["east"]["semifinals"] if s in series_dict],
            "finals": series_dict.get(BRACKET_ORDER["east"]["finals"]),
        },
        "west": {
            "round1": [series_dict.get(s) for s in BRACKET_ORDER["west"]["round1"] if s in series_dict],
            "semifinals": [series_dict.get(s) for s in BRACKET_ORDER["west"]["semifinals"] if s in series_dict],
            "finals": series_dict.get(BRACKET_ORDER["west"]["finals"]),
        },
        "finals": series_dict.get(BRACKET_ORDER["finals"]),
        "series": series_dict,
    }


def _fetch_playoffs(season: str) -> dict:
    cp_raw = stats_json("commonplayoffseries", {"LeagueID": "00", "Season": season, "SeriesID": ""})
    cp_rows = result_sets(cp_raw).get("PlayoffSeries", [])
    if not cp_rows:
        return {
            "season": season,
            "available": False,
            "champion": None,
            "series": {},
            "east": {"round1": [], "semifinals": [], "finals": None},
            "west": {"round1": [], "semifinals": [], "finals": None},
            "finals": None,
        }

    try:
        gf_raw = stats_json("leaguegamefinder", {"LeagueID": "00", "Season": season, "SeasonType": "Playoffs"})
        gf_rows = result_sets(gf_raw).get("LeagueGameFinderResults", [])
    except SourceError:
        gf_rows = []

    seeds = {}
    try:
        st, _ = standings(season)
        for r in st.get("rows", []):
            if r.get("teamId") and r.get("rank"):
                seeds[r["teamId"]] = r["rank"]
    except Exception:
        pass

    return _build_playoff_bracket(season, cp_rows, gf_rows, seeds)


def playoffs(season: str | None = None) -> tuple[dict, dict]:
    cur = current_season()
    requested = valid_season(season) or cur
    target = requested
    fallback = False

    data, meta = _cache().get(f"playoffs:{target}", 3600, lambda: _fetch_playoffs(target))
    if not data.get("available") and target == cur:
        prev = previous_season()
        try:
            prev_data, prev_meta = _cache().get(f"playoffs:{prev}", 24 * 3600, lambda: _fetch_playoffs(prev))
            if prev_data.get("available"):
                data, meta = prev_data, prev_meta
                target = prev
                fallback = True
        except SourceError:
            pass

    start_yr = current_season_start()
    available_seasons = [f"{y}-{str(y + 1)[-2:]}" for y in range(start_yr, start_yr - 6, -1)]

    result = {
        **data,
        "requested": requested,
        "season": data.get("season", target),
        "fallback": fallback,
        "availableSeasons": available_seasons,
    }
    return result, meta


# ---------------------------------------------------------------------------
# Équipes
# ---------------------------------------------------------------------------


def _award_rows(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows or []:
        year = r.get("YEARAWARDED") or r.get("YEAR")
        if year in (None, ""):
            continue
        out.append({"year": _int(year), "opp": r.get("OPPOSITETEAM") or ""})
    return out


def _people(rows: list[dict]) -> list[dict]:
    return [
        {
            "id": _int(r.get("PLAYERID"), None),
            "name": r.get("PLAYER") or "",
            "pos": r.get("POSITION") or "",
            "jersey": (str(r.get("JERSEY")) if r.get("JERSEY") not in (None, "") else ""),
            "seasons": r.get("SEASONSWITHTEAM") or "",
            "year": _int(r.get("YEAR"), None),
        }
        for r in rows or []
    ]


def team_details(team_id: int) -> tuple[dict, dict]:
    def fetch() -> dict:
        rs = result_sets(stats_json("teamdetails", {"TeamID": team_id}))
        bg = (rs.get("TeamBackground") or [{}])[0]
        capacity = _int(re.sub(r"\D", "", str(bg.get("ARENACAPACITY") or "")), None)
        return {
            "background": {
                "arena": bg.get("ARENA") or "",
                "capacity": capacity,
                "owner": bg.get("OWNER") or "",
                "gm": bg.get("GENERALMANAGER") or "",
                "coach": bg.get("HEADCOACH") or "",
                "gLeague": bg.get("DLEAGUEAFFILIATION") or "",
                "founded": _int(bg.get("YEARFOUNDED"), None),
            },
            "titles": _award_rows(rs.get("TeamAwardsChampionships")),
            "confTitles": _award_rows(rs.get("TeamAwardsConf")),
            "divTitles": _award_rows(rs.get("TeamAwardsDiv")),
            "cupTitles": _award_rows(rs.get("TeamAwardsCommCup")),
            "retired": _people(rs.get("TeamRetired")),
            "hof": _people(rs.get("TeamHof")),
            "names": [
                {
                    "city": r.get("CITY") or "",
                    "name": r.get("NICKNAME") or "",
                    "from": _int(r.get("YEARFOUNDED"), None),
                    "to": _int(r.get("YEARACTIVETILL"), None),
                }
                for r in rs.get("TeamHistory") or []
            ],
            "social": [
                {"type": r.get("ACCOUNTTYPE") or "", "url": r.get("WEBSITE_LINK") or ""}
                for r in rs.get("TeamSocialSites") or []
                if r.get("WEBSITE_LINK")
            ],
        }

    data, meta = _cache().get(f"team:details:{team_id}", 24 * 3600, fetch)
    return {"team": teams_meta.team(team_id), **data}, meta


_COACH_TYPES = {
    "Head Coach": "Entraîneur principal",
    "Assistant Coach": "Entraîneur adjoint",
    "Lead Assistant": "Premier adjoint",
    "Trainer": "Préparateur",
    "Assistant Trainer": "Préparateur adjoint",
    "Strength and Conditioning Coach": "Préparateur physique",
    "Player Development Coach": "Développement des joueurs",
}


def _roster(team_id: int, season: str) -> dict:
    rs = result_sets(stats_json("commonteamroster", {"TeamID": team_id, "Season": season, "LeagueID": "00"}))
    players = [
        {
            "id": _int(r.get("PLAYER_ID")),
            "name": r.get("PLAYER") or "",
            "num": r.get("NUM") if r.get("NUM") not in (None, "") else "",
            "pos": r.get("POSITION") or "",
            "height": r.get("HEIGHT") or "",
            "weight": r.get("WEIGHT") or "",
            "birth": _us_date(r.get("BIRTH_DATE")),
            "age": _num(r.get("AGE")),
            "exp": str(r.get("EXP") if r.get("EXP") is not None else ""),
            "school": r.get("SCHOOL") or "",
            "how": r.get("HOW_ACQUIRED") or "",
        }
        for r in rs.get("CommonTeamRoster") or []
    ]
    coaches = [
        {
            "name": r.get("COACH_NAME") or "",
            "type": _COACH_TYPES.get(r.get("COACH_TYPE") or "", r.get("COACH_TYPE") or ""),
            "head": (r.get("COACH_TYPE") or "") == "Head Coach",
        }
        for r in rs.get("Coaches") or []
    ]
    return {"season": season, "players": players, "coaches": coaches}


def team_roster(team_id: int, season: str | None = None) -> tuple[dict, dict]:
    cur = current_season()
    season = valid_season(season) or cur
    data, meta = _cache().get(f"team:roster:{team_id}:{season}", 6 * 3600, lambda: _roster(team_id, season))
    if not data["players"] and season == cur:
        prev = previous_season()
        data, meta = _cache().get(f"team:roster:{team_id}:{prev}", 24 * 3600, lambda: _roster(team_id, prev))
    return data, meta


def _franchise_table() -> tuple[dict, dict]:
    def fetch() -> dict:
        rs = result_sets(stats_json("franchisehistory", {"LeagueID": "00"}))
        return {"active": rs.get("FranchiseHistory") or [], "defunct": rs.get("DefunctTeams") or []}

    return _cache().get("franchisehistory", 24 * 3600, fetch)


def _franchise_row(r: dict) -> dict:
    return {
        "city": r.get("TEAM_CITY") or "",
        "name": r.get("TEAM_NAME") or "",
        "start": _int(r.get("START_YEAR"), None),
        "end": _int(r.get("END_YEAR"), None),
        "years": _int(r.get("YEARS"), None),
        "games": _int(r.get("GAMES"), None),
        "w": _int(r.get("WINS"), None),
        "l": _int(r.get("LOSSES"), None),
        "pct": _num(r.get("WIN_PCT")),
        "playoffs": _int(r.get("PO_APPEARANCES"), None),
        "divTitles": _int(r.get("DIV_TITLES"), None),
        "confTitles": _int(r.get("CONF_TITLES"), None),
        "titles": _int(r.get("LEAGUE_TITLES"), None),
    }


def team_history(team_id: int) -> tuple[dict, dict]:
    def fetch() -> list[dict]:
        rs = result_sets(
            stats_json(
                "teamyearbyyearstats",
                {"TeamID": team_id, "LeagueID": "00", "PerMode": "Totals", "SeasonType": "Regular Season"},
            )
        )
        out = []
        for r in rs.get("TeamStats") or []:
            finals = (r.get("NBA_FINALS_APPEARANCE") or "").upper()
            out.append(
                {
                    "season": r.get("YEAR") or "",
                    "team": f"{r.get('TEAM_CITY', '')} {r.get('TEAM_NAME', '')}".strip(),
                    "gp": _int(r.get("GP")),
                    "w": _int(r.get("WINS")),
                    "l": _int(r.get("LOSSES")),
                    "pct": _num(r.get("WIN_PCT")),
                    "confRank": _int(r.get("CONF_RANK"), None),
                    "divRank": _int(r.get("DIV_RANK"), None),
                    "poW": _int(r.get("PO_WINS"), None),
                    "poL": _int(r.get("PO_LOSSES"), None),
                    "champion": "CHAMPION" in finals,
                    "finals": "FINALS" in finals or "CHAMPION" in finals,
                    "pts": _int(r.get("PTS"), None),
                }
            )
        return out

    seasons, meta = _cache().get(f"team:history:{team_id}", 24 * 3600, fetch)
    franchise = None
    eras: list[dict] = []
    try:
        table, _ = _franchise_table()
        rows = [r for r in table["active"] if _int(r.get("TEAM_ID")) == team_id]
        if rows:
            franchise = _franchise_row(rows[0])
            eras = [_franchise_row(r) for r in rows[1:]]
    except SourceError:
        pass
    return {"seasons": seasons, "franchise": franchise, "eras": eras}, meta


def team_schedule(team_id: int) -> tuple[dict, dict]:
    sched, meta = schedule()
    games = [
        g
        for g in sched["games"]
        if (g.get("home") or {}).get("id") == team_id or (g.get("away") or {}).get("id") == team_id
    ]
    live = _cache().peek("live:scoreboard")
    if live:
        live_by_id = {g["id"]: g for g in live[1].get("games") or []}
        games = [{**g, **{k: v for k, v in live_by_id[g["id"]].items() if k in ("status", "statusText", "period", "clock", "away", "home")}} if g["id"] in live_by_id else g for g in games]
    return {"season": sched["season"], "games": games}, meta


def team_bio(team_id: int) -> tuple[dict | None, dict]:
    meta_team = teams_meta.team(team_id)
    if not meta_team:
        return None, {"fetchedAt": time.time(), "stale": False}
    return _cache().get(f"wiki:team:{team_id}", 7 * 24 * 3600, lambda: wiki.team_extract(meta_team["wiki"]))


# ---------------------------------------------------------------------------
# Joueurs
# ---------------------------------------------------------------------------

INDEX_FIELDS = [
    "id", "first", "last", "slug", "teamId", "tri", "jersey", "pos", "height", "weight",
    "college", "country", "draftYear", "draftRound", "draftNumber", "active", "pts", "reb", "ast", "from", "to",
    "statsTf",
]


def _fetch_player_index() -> dict:
    try:
        raw = stats_json(
            "playerindex",
            {
                "Active": "", "AllStar": "", "College": "", "Country": "", "DraftPick": "", "DraftYear": "",
                "Height": "", "PlayerPosition": "", "Historical": "1", "LeagueID": "00",
                "Season": current_season(), "TeamID": "", "Weight": "",
            },
        )
        rows = []
        for r in result_sets(raw).get("PlayerIndex", []):
            rows.append(
                [
                    _int(r.get("PERSON_ID")),
                    r.get("PLAYER_FIRST_NAME") or "",
                    r.get("PLAYER_LAST_NAME") or "",
                    r.get("PLAYER_SLUG") or "",
                    _int(r.get("TEAM_ID"), None),
                    r.get("TEAM_ABBREVIATION") or "",
                    r.get("JERSEY_NUMBER") or "",
                    r.get("POSITION") or "",
                    r.get("HEIGHT") or "",
                    r.get("WEIGHT") or "",
                    r.get("COLLEGE") or "",
                    r.get("COUNTRY") or "",
                    _int(r.get("DRAFT_YEAR"), None),
                    _int(r.get("DRAFT_ROUND"), None),
                    _int(r.get("DRAFT_NUMBER"), None),
                    1 if _int(r.get("ROSTER_STATUS")) == 1 else 0,
                    _num(r.get("PTS")),
                    _num(r.get("REB")),
                    _num(r.get("AST")),
                    _int(r.get("FROM_YEAR"), None),
                    _int(r.get("TO_YEAR"), None),
                    r.get("STATS_TIMEFRAME") or "",
                ]
            )
        if rows:
            return {"fields": INDEX_FIELDS, "rows": rows, "source": "playerindex"}
    except SourceError:
        pass
    # Secours : liste plus sommaire.
    raw = stats_json("commonallplayers", {"IsOnlyCurrentSeason": 0, "LeagueID": "00", "Season": current_season()})
    rows = []
    for r in result_sets(raw).get("CommonAllPlayers", []):
        full = r.get("DISPLAY_FIRST_LAST") or ""
        first, _, last = full.partition(" ")
        rows.append(
            [
                _int(r.get("PERSON_ID")), first, last or first, r.get("PLAYER_SLUG") or "",
                _int(r.get("TEAM_ID"), None) or None, r.get("TEAM_ABBREVIATION") or "", "", "", "", "",
                "", "", None, None, None, 1 if _int(r.get("ROSTERSTATUS")) == 1 else 0,
                None, None, None, _int(r.get("FROM_YEAR"), None), _int(r.get("TO_YEAR"), None), "",
            ]
        )
    return {"fields": INDEX_FIELDS, "rows": rows, "source": "commonallplayers"}


def player_index() -> tuple[dict, dict]:
    return _cache().get("players:index", 24 * 3600, _fetch_player_index)


def player_info(player_id: int) -> tuple[dict, dict]:
    def fetch() -> dict:
        rs = result_sets(stats_json("commonplayerinfo", {"PlayerID": player_id, "LeagueID": "00"}))
        rows = rs.get("CommonPlayerInfo") or []
        if not rows:
            raise SourceError("Joueur introuvable", status=404, source="stats.nba.com")
        i = rows[0]
        h = (rs.get("PlayerHeadlineStats") or [{}])[0]
        draft_year = i.get("DRAFT_YEAR")
        return {
            "id": _int(i.get("PERSON_ID")),
            "first": i.get("FIRST_NAME") or "",
            "last": i.get("LAST_NAME") or "",
            "name": i.get("DISPLAY_FIRST_LAST") or "",
            "slug": i.get("PLAYER_SLUG") or "",
            "birth": (i.get("BIRTHDATE") or "")[:10],
            "school": i.get("SCHOOL") or "",
            "country": i.get("COUNTRY") or "",
            "height": i.get("HEIGHT") or "",
            "weight": i.get("WEIGHT") or "",
            "exp": _int(i.get("SEASON_EXP"), None),
            "jersey": i.get("JERSEY") or "",
            "pos": i.get("POSITION") or "",
            "active": (i.get("ROSTERSTATUS") or "") == "Active",
            "teamId": _int(i.get("TEAM_ID"), None) or None,
            "teamTri": i.get("TEAM_ABBREVIATION") or "",
            "teamCity": i.get("TEAM_CITY") or "",
            "teamName": i.get("TEAM_NAME") or "",
            "from": _int(i.get("FROM_YEAR"), None),
            "to": _int(i.get("TO_YEAR"), None),
            "draftYear": _int(draft_year, None),
            "undrafted": str(draft_year or "").lower().startswith("undrafted"),
            "draftRound": _int(i.get("DRAFT_ROUND"), None),
            "draftNumber": _int(i.get("DRAFT_NUMBER"), None),
            "greatest75": (i.get("GREATEST_75_FLAG") or "") == "Y",
            "headline": {
                "season": h.get("TimeFrame") or "",
                "pts": _num(h.get("PTS")),
                "reb": _num(h.get("REB")),
                "ast": _num(h.get("AST")),
            }
            if h
            else None,
        }

    return _cache().get(f"player:info:{player_id}", 6 * 3600, fetch)


def _stat_row(r: dict) -> dict:
    return {
        "season": r.get("SEASON_ID") or "",
        "teamId": _int(r.get("TEAM_ID") if "TEAM_ID" in r else r.get("Team_ID"), None),
        "tri": r.get("TEAM_ABBREVIATION") or "",
        "age": _int(r.get("PLAYER_AGE"), None),
        "gp": _int(r.get("GP")),
        "gs": _int(r.get("GS"), None),
        "min": _num(r.get("MIN")),
        "pts": _num(r.get("PTS")),
        "reb": _num(r.get("REB")),
        "oreb": _num(r.get("OREB")),
        "dreb": _num(r.get("DREB")),
        "ast": _num(r.get("AST")),
        "stl": _num(r.get("STL")),
        "blk": _num(r.get("BLK")),
        "tov": _num(r.get("TOV")),
        "pf": _num(r.get("PF")),
        "fgm": _num(r.get("FGM")),
        "fga": _num(r.get("FGA")),
        "fgPct": _num(r.get("FG_PCT")),
        "tpm": _num(r.get("FG3M")),
        "tpa": _num(r.get("FG3A")),
        "tpPct": _num(r.get("FG3_PCT")),
        "ftm": _num(r.get("FTM")),
        "fta": _num(r.get("FTA")),
        "ftPct": _num(r.get("FT_PCT")),
    }


def _highs(rows: list[dict]) -> list[dict]:
    seen: dict[str, dict] = {}
    for r in sorted(rows or [], key=lambda x: _int(x.get("STAT_ORDER"), 99) or 99):
        stat = r.get("STAT") or ""
        if not stat or stat in seen:
            continue
        seen[stat] = {
            "stat": stat,
            "value": _int(r.get("STAT_VALUE"), None),
            "date": (r.get("DATE_EST") or "")[:10] or _us_date(r.get("GAME_DATE")),
            "gameId": r.get("GAME_ID") or "",
            "vsId": _int(r.get("VS_TEAM_ID"), None),
            "vsTri": r.get("VS_TEAM_ABBREVIATION") or "",
            "vsName": f"{r.get('VS_TEAM_CITY', '')} {r.get('VS_TEAM_NAME', '')}".strip(),
        }
    return list(seen.values())


def player_career(player_id: int) -> tuple[dict, dict]:
    def fetch() -> dict:
        rs = result_sets(stats_json("playercareerstats", {"PlayerID": player_id, "PerMode": "Totals", "LeagueID": "00"}))
        career_reg = (rs.get("CareerTotalsRegularSeason") or [None])[0]
        career_po = (rs.get("CareerTotalsPostSeason") or [None])[0]
        return {
            "regular": [_stat_row(r) for r in rs.get("SeasonTotalsRegularSeason") or []],
            "playoffs": [_stat_row(r) for r in rs.get("SeasonTotalsPostSeason") or []],
            "careerRegular": _stat_row(career_reg) if career_reg else None,
            "careerPlayoffs": _stat_row(career_po) if career_po else None,
            "allStarGames": len(rs.get("SeasonTotalsAllStarSeason") or []),
            "careerHighs": _highs(rs.get("CareerHighs")),
            "seasonHighs": _highs(rs.get("SeasonHighs")),
        }

    return _cache().get(f"player:career:{player_id}", 6 * 3600, fetch)


def player_awards(player_id: int) -> tuple[dict, dict]:
    def fetch() -> list[dict]:
        rows = result_sets(stats_json("playerawards", {"PlayerID": player_id})).get("PlayerAwards", [])
        groups: dict[str, dict] = {}
        for r in rows:
            key = (r.get("DESCRIPTION") or "").strip()
            if not key:
                continue
            g = groups.setdefault(key, {"key": key, "type": r.get("TYPE") or "", "items": []})
            g["items"].append(
                {
                    "season": r.get("SEASON") or "",
                    "team": r.get("TEAM") or "",
                    "number": r.get("ALL_NBA_TEAM_NUMBER") or "",
                    "month": r.get("MONTH") or "",
                    "week": r.get("WEEK") or "",
                    "conference": r.get("CONFERENCE") or "",
                }
            )
        out = []
        for g in groups.values():
            g["items"].sort(key=lambda x: x["season"])
            g["count"] = len(g["items"])
            out.append(g)
        return out

    data, meta = _cache().get(f"player:awards:{player_id}", 24 * 3600, fetch)
    return {"awards": data}, meta


def _gamelog(player_id: int, season: str, season_type: str) -> list[dict]:
    raw = stats_json(
        "playergamelog",
        {"PlayerID": player_id, "Season": season, "SeasonType": season_type, "DateFrom": "", "DateTo": "", "LeagueID": "00"},
    )
    games = []
    for r in result_sets(raw).get("PlayerGameLog", []):
        matchup = r.get("MATCHUP") or ""
        parts = matchup.split()
        games.append(
            {
                "gameId": r.get("Game_ID") or "",
                "date": _us_date(r.get("GAME_DATE")),
                "matchup": matchup,
                "home": "vs." in matchup,
                "opp": parts[-1] if parts else "",
                "wl": r.get("WL") or "",
                "min": _num(r.get("MIN")),
                "pts": _int(r.get("PTS")),
                "reb": _int(r.get("REB")),
                "ast": _int(r.get("AST")),
                "stl": _int(r.get("STL")),
                "blk": _int(r.get("BLK")),
                "tov": _int(r.get("TOV")),
                "pf": _int(r.get("PF")),
                "fgm": _int(r.get("FGM")),
                "fga": _int(r.get("FGA")),
                "tpm": _int(r.get("FG3M")),
                "tpa": _int(r.get("FG3A")),
                "ftm": _int(r.get("FTM")),
                "fta": _int(r.get("FTA")),
                "pm": _int(r.get("PLUS_MINUS"), None),
            }
        )
    return games


def player_gamelog(player_id: int) -> tuple[dict, dict]:
    cur, prev = current_season(), previous_season()
    attempts = [(cur, "Regular Season"), (cur, "Pre Season"), (prev, "Playoffs"), (prev, "Regular Season")]
    meta: dict = {"fetchedAt": time.time(), "stale": False}
    for season, season_type in attempts:
        ttl = 20 * 60 if season == cur else 24 * 3600
        games, meta = _cache().get(
            f"player:gamelog:{player_id}:{season}:{season_type}", ttl, lambda s=season, t=season_type: _gamelog(player_id, s, t)
        )
        if games:
            return {"season": season, "type": season_type, "games": games}, meta
    return {"season": cur, "type": "Regular Season", "games": []}, meta


def player_bio(player_id: int) -> tuple[dict | None, dict]:
    def fetch() -> dict | None:
        name = ""
        try:
            info, _ = player_info(player_id)
            name = info.get("name") or ""
        except SourceError:
            pass
        return wiki.player_extract(player_id, name)

    return _cache().get(f"wiki:player:{player_id}", 7 * 24 * 3600, fetch)


# ---------------------------------------------------------------------------
# Leaders statistiques
# ---------------------------------------------------------------------------

LEADER_CATEGORIES = [
    ("pts", "PTS"),
    ("reb", "REB"),
    ("ast", "AST"),
    ("stl", "STL"),
    ("blk", "BLK"),
    ("tpm", "FG3M"),
    ("fgPct", "FG_PCT"),
    ("eff", "EFF"),
]


def _fetch_leaders(season: str) -> list[dict]:
    params = {
        "College": "",
        "Conference": "",
        "Country": "",
        "DateFrom": "",
        "DateTo": "",
        "Division": "",
        "DraftPick": "",
        "DraftYear": "",
        "GameScope": "",
        "GameSegment": "",
        "Height": "",
        "LastNGames": 0,
        "LeagueID": "00",
        "Location": "",
        "MeasureType": "Base",
        "Month": 0,
        "OpponentTeamID": 0,
        "Outcome": "",
        "PaceAdjust": "N",
        "PerMode": "PerGame",
        "Period": 0,
        "PlayerExperience": "",
        "PlayerPosition": "",
        "PlusMinus": "N",
        "Rank": "N",
        "Season": season,
        "SeasonSegment": "",
        "SeasonType": "Regular Season",
        "ShotClockRange": "",
        "StarterBench": "",
        "TeamID": 0,
        "TwoWay": "",
        "VsConference": "",
        "VsDivision": "",
        "Weight": "",
    }
    raw = stats_json("leaguedashplayerstats", params)
    rows = []
    for r in result_sets(raw).get("LeagueDashPlayerStats", []):
        pts = _num(r.get("PTS")) or 0.0
        reb = _num(r.get("REB")) or 0.0
        ast = _num(r.get("AST")) or 0.0
        stl = _num(r.get("STL")) or 0.0
        blk = _num(r.get("BLK")) or 0.0
        fga = _num(r.get("FGA")) or 0.0
        fgm = _num(r.get("FGM")) or 0.0
        fta = _num(r.get("FTA")) or 0.0
        ftm = _num(r.get("FTM")) or 0.0
        tov = _num(r.get("TOV")) or 0.0
        eff = _num(r.get("EFF"))
        if eff is None:
            eff = round((pts + reb + ast + stl + blk) - (fga - fgm) - (fta - ftm) - tov, 1)
        rows.append(
            {
                "id": _int(r.get("PLAYER_ID")),
                "name": r.get("PLAYER_NAME") or r.get("PLAYER") or "",
                "teamId": _int(r.get("TEAM_ID"), None),
                "tri": r.get("TEAM_ABBREVIATION") or r.get("TEAM") or "",
                "gp": _int(r.get("GP")),
                "min": _num(r.get("MIN")),
                "fgm": fgm,
                "pts": _num(r.get("PTS")),
                "reb": _num(r.get("REB")),
                "ast": _num(r.get("AST")),
                "stl": _num(r.get("STL")),
                "blk": _num(r.get("BLK")),
                "tpm": _num(r.get("FG3M")),
                "fgPct": _num(r.get("FG_PCT")),
                "eff": eff,
            }
        )
    return rows


def leaders(season: str | None = None) -> tuple[dict, dict]:
    cur = current_season()
    season = valid_season(season) or cur
    rows, meta = _cache().get(f"leaders:{season}", 3600 if season == cur else 24 * 3600, lambda: _fetch_leaders(season))
    shown, fallback = season, False
    if not rows and season == cur:
        prev = previous_season()
        rows, meta = _cache().get(f"leaders:{prev}", 24 * 3600, lambda: _fetch_leaders(prev))
        shown, fallback = prev, True

    max_gp = max((r.get("gp") or 0) for r in rows) if rows else 0
    min_gp = max(1, int(max_gp * 0.70)) if max_gp > 0 else 0
    min_fgm = max(1, int(max_gp * (300 / 82))) if max_gp > 0 else 0

    boards = {}
    for key, _ in LEADER_CATEGORIES:
        if key == "fgPct":
            candidates = [
                r for r in rows
                if r.get(key) is not None and ((r.get("fgm") or 0) * (r.get("gp") or 0)) >= min_fgm
            ]
            if len(candidates) < 10:
                candidates = [
                    r for r in rows
                    if r.get(key) is not None and (r.get("gp") or 0) >= min_gp
                ]
        else:
            candidates = [
                r for r in rows
                if r.get(key) is not None and (r.get("gp") or 0) >= min_gp
            ]
        if not candidates and rows:
            candidates = [r for r in rows if r.get(key) is not None]

        ranked = sorted(candidates, key=lambda r: r[key], reverse=True)[:10]
        boards[key] = [{k: r[k] for k in ("id", "name", "teamId", "tri", "gp")} | {"value": r[key]} for r in ranked]
    return {"season": shown, "requested": season, "fallback": fallback, "boards": boards}, meta


# ---------------------------------------------------------------------------
# Diagnostic
# ---------------------------------------------------------------------------


def diagnostic() -> dict:
    from .net import wiki_json

    checks = [
        ("live", "Scores en direct (cdn.nba.com)", lambda: cdn_json("liveData/scoreboard/todaysScoreboard_00.json")),
        ("stats", "Statistiques (stats.nba.com)", lambda: stats_json("commonplayerinfo", {"PlayerID": 2544, "LeagueID": "00"})),
        (
            "wiki",
            "Biographies (Wikipédia)",
            lambda: wiki_json("https://fr.wikipedia.org/w/api.php", {"action": "query", "meta": "siteinfo", "format": "json"}),
        ),
    ]
    results = []
    for key, label, fn in checks:
        t0 = time.monotonic()
        try:
            fn()
            results.append({"key": key, "label": label, "ok": True, "ms": int((time.monotonic() - t0) * 1000), "message": "OK"})
        except Exception as exc:  # noqa: BLE001
            results.append({"key": key, "label": label, "ok": False, "ms": int((time.monotonic() - t0) * 1000), "message": str(exc)})
    return {
        "checks": results,
        "season": current_season(),
        "gameDay": game_day_et().isoformat(),
        "cache": _cache().stats(),
        "lastErrors": HEALTH.last_errors,
    }
