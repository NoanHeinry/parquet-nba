"""Équipes en profondeur : statistiques avancées de la ligue, meilleurs cinq d'une équipe et
historique des confrontations entre deux équipes."""

from __future__ import annotations

from collections import defaultdict

from . import nba
from .net import SourceError, result_sets, stats_json

ADVANCED_KEYS = [
    # (clé, colonne NBA, plus c'est haut mieux c'est)
    ("off", "OFF_RATING", True),
    ("def", "DEF_RATING", False),
    ("net", "NET_RATING", True),
    ("pace", "PACE", True),
    ("ts", "TS_PCT", True),
    ("efg", "EFG_PCT", True),
    ("astPct", "AST_PCT", True),
    ("orebPct", "OREB_PCT", True),
    ("drebPct", "DREB_PCT", True),
    ("tov", "TM_TOV_PCT", False),
]


def _team_params(season: str, measure: str, per_mode: str = "PerGame", team_id: int = 0) -> dict:
    return {
        "Conference": "", "DateFrom": "", "DateTo": "", "Division": "", "GameScope": "", "GameSegment": "", "Height": "",
        "LastNGames": 0, "LeagueID": "00", "Location": "", "MeasureType": measure, "Month": 0, "OpponentTeamID": 0,
        "Outcome": "", "PORound": 0, "PaceAdjust": "N", "PerMode": per_mode, "Period": 0, "PlayerExperience": "",
        "PlayerPosition": "", "PlusMinus": "N", "Rank": "N", "Season": season, "SeasonSegment": "",
        "SeasonType": "Regular Season", "ShotClockRange": "", "StarterBench": "", "TeamID": team_id, "TwoWay": "",
        "VsConference": "", "VsDivision": "",
    }


def _fetch_advanced(season: str) -> list[dict]:
    rows = result_sets(stats_json("leaguedashteamstats", _team_params(season, "Advanced"))).get("LeagueDashTeamStats", [])
    out = []
    for r in rows:
        tid = nba._int(r.get("TEAM_ID"))
        if not tid:
            continue
        item = {"teamId": tid, "name": r.get("TEAM_NAME") or "", "gp": nba._int(r.get("GP")) or 0, "w": nba._int(r.get("W")) or 0, "l": nba._int(r.get("L")) or 0}
        for key, col, _ in ADVANCED_KEYS:
            item[key] = nba._num(r.get(col))
        out.append(item)
    return out


def rank(rows: list[dict]) -> list[dict]:
    """Rang de 1 à 30 dans chaque catégorie (1 = le meilleur)."""
    for key, _, higher in ADVANCED_KEYS:
        ordered = sorted((r for r in rows if r.get(key) is not None), key=lambda r: r[key], reverse=higher)
        for i, r in enumerate(ordered, 1):
            r.setdefault("ranks", {})[key] = i
    return rows


def league_advanced(season: str | None = None) -> tuple[dict, dict]:
    cur = nba.current_season()
    wanted = nba.valid_season(season) or cur
    shown, fallback = wanted, False

    def load(s):
        ttl = 3 * 3600 if s == cur else 7 * 24 * 3600
        return nba._cache().get(f"teams:advanced:{s}", ttl, lambda: _fetch_advanced(s))

    rows, meta = load(wanted)
    if not rows and wanted == cur:
        shown, fallback = nba.previous_season(), True
        rows, meta = load(shown)
    rows = rank([dict(r) for r in rows])
    rows.sort(key=lambda r: -(r.get("net") or -99))
    avg = {key: round(sum(r[key] for r in rows if r.get(key) is not None) / max(1, len(rows)), 3) for key, _, _ in ADVANCED_KEYS}
    return {"season": shown, "requested": wanted, "fallback": fallback, "teams": rows, "league": avg}, meta


# ---------------------------------------------------------------------------
# Meilleurs cinq
# ---------------------------------------------------------------------------


def _fetch_lineups(team_id: int, season: str) -> list[dict]:
    params = _team_params(season, "Advanced", "Totals", team_id)
    for k in ("GameScope", "Height", "PlayerExperience", "PlayerPosition", "StarterBench", "TwoWay"):
        params.pop(k, None)
    params["GroupQuantity"] = 5
    rows = result_sets(stats_json("leaguedashlineups", params)).get("Lineups", [])
    out = []
    for r in rows:
        ids = [int(x) for x in str(r.get("GROUP_ID") or "").strip("-").split("-") if x.isdigit()]
        out.append(
            {
                "ids": ids,
                "names": [n.strip() for n in str(r.get("GROUP_NAME") or "").split(" - ")],
                "gp": nba._int(r.get("GP")) or 0,
                "min": nba._num(r.get("MIN")),
                "off": nba._num(r.get("OFF_RATING")),
                "def": nba._num(r.get("DEF_RATING")),
                "net": nba._num(r.get("NET_RATING")),
            }
        )
    return out


def team_profile(team_id: int) -> tuple[dict, dict]:
    league, meta = league_advanced()
    season = league["season"]
    me = next((t for t in league["teams"] if t["teamId"] == team_id), None)
    lineups: list[dict] = []
    error = None
    try:
        ttl = 3 * 3600 if season == nba.current_season() else 7 * 24 * 3600
        raw, _ = nba._cache().get(f"teams:lineups:{team_id}:{season}", ttl, lambda: _fetch_lineups(team_id, season))
        played = [x for x in raw if (x["min"] or 0) > 0]
        played.sort(key=lambda x: -(x["min"] or 0))
        lineups = played[:6]
    except SourceError as exc:
        error = str(exc)
    return {"season": season, "fallback": league["fallback"], "team": me, "league": league["league"], "lineups": lineups, "lineupsError": error}, meta


# ---------------------------------------------------------------------------
# Face-à-face
# ---------------------------------------------------------------------------


def _fetch_h2h(a: int, b: int) -> list[dict]:
    params = {"PlayerOrTeam": "T", "TeamID": a, "VsTeamID": b, "LeagueID": "00"}
    rows = result_sets(stats_json("leaguegamefinder", params)).get("LeagueGameFinderResults", [])
    games = []
    for r in rows:
        kind = str(r.get("SEASON_ID") or "")[:1]
        if kind not in ("2", "4"):
            continue  # présaison, matchs des étoiles…
        pts = nba._int(r.get("PTS"))
        pm = nba._num(r.get("PLUS_MINUS"))
        matchup = str(r.get("MATCHUP") or "")
        games.append(
            {
                "id": str(r.get("GAME_ID") or ""),
                "date": str(r.get("GAME_DATE") or "")[:10],
                "season": nba.season_label(int(str(r.get("SEASON_ID"))[1:5])) if len(str(r.get("SEASON_ID") or "")) >= 5 else "",
                "playoffs": kind == "4",
                "home": " vs. " in matchup,
                "win": r.get("WL") == "W",
                "pts": pts,
                "opp": int(pts - pm) if pts is not None and pm is not None else None,
            }
        )
    games.sort(key=lambda g: g["date"], reverse=True)
    return games


def summarize_h2h(games: list[dict]) -> dict:
    """Bilan du point de vue de la première équipe."""

    def record(gs):
        w = sum(1 for g in gs if g["win"])
        return {"w": w, "l": len(gs) - w}

    reg = [g for g in games if not g["playoffs"]]
    po = [g for g in games if g["playoffs"]]
    streak = 0
    if games:
        first = games[0]["win"]
        for g in games:
            if g["win"] != first:
                break
            streak += 1
        streak = streak if first else -streak
    series = []
    by_season = defaultdict(list)
    for g in po:
        by_season[g["season"]].append(g)
    for season, gs in sorted(by_season.items(), reverse=True):
        r = record(gs)
        series.append({"season": season, **r, "won": r["w"] > r["l"]})
    seasons = []
    by_reg = defaultdict(list)
    for g in reg:
        by_reg[g["season"]].append(g)
    for season, gs in sorted(by_reg.items(), reverse=True):
        seasons.append({"season": season, **record(gs)})
    margins = [g for g in games if g["pts"] is not None and g["opp"] is not None]
    best = max(margins, key=lambda g: g["pts"] - g["opp"], default=None)
    worst = min(margins, key=lambda g: g["pts"] - g["opp"], default=None)
    pts = [g["pts"] for g in margins]
    opp = [g["opp"] for g in margins]
    return {
        "total": len(games),
        "regular": record(reg),
        "playoffs": record(po),
        "streak": streak,
        "avg": {"pts": round(sum(pts) / len(pts), 1), "opp": round(sum(opp) / len(opp), 1)} if pts else None,
        "best": best if best and best["pts"] > best["opp"] else None,
        "worst": worst if worst and worst["pts"] < worst["opp"] else None,
        "series": series,
        "seasons": seasons[:12],
        "recent": games[:12],
        "since": games[-1]["season"] if games else None,
    }


def head_to_head(a: int, b: int) -> tuple[dict, dict]:
    games, meta = nba._cache().get(f"teams:h2h:{a}:{b}", 6 * 3600, lambda: _fetch_h2h(a, b))
    data = summarize_h2h(games)
    # Prochains matchs entre les deux cette saison.
    upcoming = []
    sched = nba._schedule_or_none()
    if sched:
        for g in sched["games"]:
            ids = {(g.get("home") or {}).get("id"), (g.get("away") or {}).get("id")}
            if ids == {a, b} and g.get("status") != 3:
                upcoming.append({"id": g["id"], "date": g.get("etDate"), "start": g.get("start"), "home": (g.get("home") or {}).get("id") == a})
    data.update({"a": a, "b": b, "upcoming": upcoming[:4]})
    return data, meta
