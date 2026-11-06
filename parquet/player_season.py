"""Saison d'un joueur en détail : carte de tous ses tirs (comparée à la moyenne de la ligue,
zone par zone) et ses statistiques selon le contexte (domicile, résultat, repos, mois,
adversaire, forme récente), calculées à partir de ses matchs."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from . import nba
from .net import SourceError, result_sets, stats_json

ZONES = {
    "Restricted Area": "Sous le cercle",
    "In The Paint (Non-RA)": "Raquette",
    "Mid-Range": "Mi-distance",
    "Left Corner 3": "Corner gauche à 3 pts",
    "Right Corner 3": "Corner droit à 3 pts",
    "Above the Break 3": "3 pts dans l'axe",
    "Backcourt": "Depuis sa moitié de terrain",
}
ZONE_ORDER = list(ZONES)

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def _shot_params(player_id: int, season: str, season_type: str) -> dict:
    return {
        "ContextMeasure": "FGA", "LeagueID": "00", "PlayerID": player_id, "TeamID": 0, "Season": season, "SeasonType": season_type,
        "AheadBehind": "", "ClutchTime": "", "ContextFilter": "", "DateFrom": "", "DateTo": "", "EndPeriod": "", "EndRange": "",
        "GameEventID": "", "GameID": "", "GameSegment": "", "LastNGames": 0, "Location": "", "Month": 0, "OpponentTeamID": 0,
        "Outcome": "", "Period": 0, "PlayerPosition": "", "PointDiff": "", "Position": "", "RangeType": "", "RookieYear": "",
        "SeasonSegment": "", "StartPeriod": "", "StartRange": "", "VsConference": "", "VsDivision": "",
    }


def _fetch_shots(player_id: int, season: str, season_type: str) -> dict:
    sets = result_sets(stats_json("shotchartdetail", _shot_params(player_id, season, season_type)))
    shots = []
    for r in sets.get("Shot_Chart_Detail", []):
        x, y = nba._num(r.get("LOC_X")), nba._num(r.get("LOC_Y"))
        if x is None or y is None:
            continue
        shots.append(
            [
                int(x),
                int(y),
                1 if nba._int(r.get("SHOT_MADE_FLAG")) == 1 else 0,
                r.get("SHOT_ZONE_BASIC") or "",
                r.get("SHOT_ZONE_AREA") or "",
                r.get("SHOT_ZONE_RANGE") or "",
                nba._int(r.get("SHOT_DISTANCE")),
                r.get("ACTION_TYPE") or "",
                _ymd(r.get("GAME_DATE")),
            ]
        )
    league = []
    for r in sets.get("LeagueAverages", []):
        league.append([r.get("SHOT_ZONE_BASIC") or "", r.get("SHOT_ZONE_AREA") or "", r.get("SHOT_ZONE_RANGE") or "", nba._int(r.get("FGA")), nba._int(r.get("FGM"))])
    return {"shots": shots, "league": league}


def _ymd(value: Any) -> str:
    """Date au format AAAAMMJJ (cartes des tirs) -> AAAA-MM-JJ."""
    text = str(value or "")
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}" if len(text) == 8 and text.isdigit() else text


def _zones(shots: list[list], league: list[list]) -> list[dict]:
    lg = defaultdict(lambda: [0, 0])
    for basic, _area, _rng, fga, fgm in league:
        lg[basic][0] += fga or 0
        lg[basic][1] += fgm or 0
    mine = defaultdict(lambda: [0, 0])
    for s in shots:
        mine[s[3]][0] += 1
        mine[s[3]][1] += s[2]
    total = sum(v[0] for v in mine.values()) or 1
    out = []
    for key in ZONE_ORDER + [k for k in mine if k not in ZONES]:
        fga, fgm = mine.get(key, [0, 0])
        lfga, lfgm = lg.get(key, [0, 0])
        if not fga and key == "Backcourt":
            continue
        out.append(
            {
                "key": key,
                "label": ZONES.get(key, key),
                "fga": fga,
                "fgm": fgm,
                "pct": round(fgm / fga, 3) if fga else None,
                "share": round(fga / total, 3),
                "league": round(lfgm / lfga, 3) if lfga else None,
            }
        )
    return out


def _line(games: list[dict]) -> dict:
    n = len(games)
    if not n:
        return {"gp": 0}

    def tot(k):
        return sum((g.get(k) or 0) for g in games)

    fga, fta, pts = tot("fga"), tot("fta"), tot("pts")
    mins = [g["min"] for g in games if g.get("min") is not None]
    pms = [g["pm"] for g in games if g.get("pm") is not None]
    return {
        "gp": n,
        "w": sum(1 for g in games if g.get("wl") == "W"),
        "min": round(sum(mins) / len(mins), 1) if mins else None,
        "pts": round(pts / n, 1),
        "reb": round(tot("reb") / n, 1),
        "ast": round(tot("ast") / n, 1),
        "fgPct": round(tot("fgm") / fga, 3) if fga else None,
        "tpPct": round(tot("tpm") / tot("tpa"), 3) if tot("tpa") else None,
        "ts": round(pts / (2 * (fga + 0.44 * fta)), 3) if (fga + fta) else None,
        "pm": round(sum(pms) / len(pms), 1) if pms else None,
    }


def splits(games: list[dict]) -> list[dict]:
    """Groupes de lignes : chaque ligne = un contexte et les moyennes du joueur dans ce contexte."""
    games = sorted((g for g in games if g.get("date")), key=lambda g: g["date"])
    if not games:
        return []
    groups = []
    groups.append({"key": "form", "label": "Forme", "rows": [
        {"label": "Toute la saison", **_line(games)},
        {"label": "10 derniers matchs", **_line(games[-10:])},
        {"label": "5 derniers matchs", **_line(games[-5:])},
    ]})
    groups.append({"key": "place", "label": "Lieu", "rows": [
        {"label": "À domicile", **_line([g for g in games if g.get("home")])},
        {"label": "À l'extérieur", **_line([g for g in games if not g.get("home")])},
    ]})
    groups.append({"key": "result", "label": "Résultat", "rows": [
        {"label": "Victoires", **_line([g for g in games if g.get("wl") == "W"])},
        {"label": "Défaites", **_line([g for g in games if g.get("wl") == "L"])},
    ]})
    # Repos : jours pleins depuis le match précédent (0 = deux soirs de suite).
    rest = defaultdict(list)
    prev = None
    for g in games:
        d = date.fromisoformat(g["date"])
        if prev is not None:
            gap = (d - prev).days - 1
            rest["Deux soirs de suite" if gap <= 0 else "1 jour de repos" if gap == 1 else "2 jours ou plus"].append(g)
        prev = d
    groups.append({"key": "rest", "label": "Repos", "rows": [{"label": k, **_line(rest[k])} for k in ("Deux soirs de suite", "1 jour de repos", "2 jours ou plus") if rest[k]]})
    months = defaultdict(list)
    for g in games:
        months[g["date"][:7]].append(g)
    groups.append({"key": "month", "label": "Par mois", "rows": [
        {"label": f"{MONTHS[int(k[5:7]) - 1].capitalize()} {k[:4]}", **_line(v)} for k, v in sorted(months.items())
    ]})
    opps = defaultdict(list)
    for g in games:
        opps[g.get("opp") or "?"].append(g)
    opp_rows = [{"label": k, "tri": k, **_line(v)} for k, v in opps.items()]
    opp_rows.sort(key=lambda r: (-(r["pts"] or 0), r["label"]))
    groups.append({"key": "opp", "label": "Par adversaire", "rows": opp_rows})
    return [g for g in groups if g["rows"]]


def season_detail(player_id: int, season: str | None = None) -> tuple[dict, dict]:
    cur = nba.current_season()
    wanted = nba.valid_season(season)
    candidates = [wanted] if wanted else [cur, nba.previous_season()]
    chosen, games, meta = candidates[0], [], {"fetchedAt": None, "stale": False}
    for s in candidates:
        ttl = 20 * 60 if s == cur else 24 * 3600
        try:
            games, meta = nba._cache().get(f"player:gamelog:{player_id}:{s}:Regular Season", ttl, lambda s=s: nba._gamelog(player_id, s, "Regular Season"))
        except SourceError:
            games = []
        chosen = s
        if games:
            break
    shots: dict = {"shots": [], "league": []}
    shots_error = None
    try:
        ttl = 3 * 3600 if chosen == cur else 7 * 24 * 3600
        shots, _ = nba._cache().get(f"player:shots:{player_id}:{chosen}", ttl, lambda: _fetch_shots(player_id, chosen, "Regular Season"))
    except SourceError as exc:
        shots_error = str(exc)
    return {
        "season": chosen,
        "games": len(games),
        "splits": splits(games),
        "shots": shots["shots"],
        "league": shots["league"],
        "zones": _zones(shots["shots"], shots["league"]),
        "shotsError": shots_error,
    }, meta
