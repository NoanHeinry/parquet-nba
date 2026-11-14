"""Histoire de la NBA : records de tous les temps et palmarès des trophées."""

from __future__ import annotations

import math
from collections import Counter

from . import nba, palmares, teams_meta
from .net import SourceError, result_sets, stats_json

# Catégories des records (jeu de résultats d'alltimeleadersgrids, libellé).
RECORD_CATEGORIES = [
    ("PTS", "Points"),
    ("REB", "Rebonds"),
    ("AST", "Passes décisives"),
    ("STL", "Interceptions"),
    ("BLK", "Contres"),
    ("FG3M", "Paniers à 3 points"),
    ("FTM", "Lancers francs réussis"),
    ("GP", "Matchs joués"),
]


def _value_column(row: dict) -> str | None:
    for key in row:
        if key in ("PLAYER_ID", "PLAYER_NAME", "IS_ACTIVE_FLAG") or key.endswith("_RANK"):
            continue
        return key
    return None


def _fetch_records(season_type: str) -> dict:
    raw = stats_json("alltimeleadersgrids", {"LeagueID": "00", "PerMode": "Totals", "SeasonType": season_type, "TopX": 50})
    sets = result_sets(raw)
    out = {}
    for key, _ in RECORD_CATEGORIES:
        rows = sets.get(f"{key}Leaders") or []
        board = []
        for r in rows:
            col = _value_column(r)
            if not col:
                continue
            board.append(
                {
                    "id": nba._int(r.get("PLAYER_ID")),
                    "name": r.get("PLAYER_NAME") or "",
                    "value": nba._num(r.get(col)),
                    "rank": nba._int(r.get(f"{col}_RANK")) or None,
                    "active": str(r.get("IS_ACTIVE_FLAG") or "").upper() in ("Y", "1", "TRUE"),
                }
            )
        board.sort(key=lambda x: (x["rank"] or 999, -(x["value"] or 0)))
        for i, b in enumerate(board, 1):
            b["rank"] = b["rank"] or i
        out[key] = board
    if not any(out.values()):
        raise SourceError("Records indisponibles", source="stats.nba.com")
    return out


def records(season_type: str = "Regular Season") -> tuple[dict, dict]:
    season_type = "Playoffs" if season_type == "Playoffs" else "Regular Season"
    boards, meta = nba._cache().get(f"records:{season_type}", 12 * 3600, lambda: _fetch_records(season_type))
    # Joueurs en activité : écart avec le joueur juste devant et, au rythme de la saison en
    # cours, le nombre de matchs qu'il lui faudrait pour le dépasser.
    pace: dict[int, dict] = {}
    if season_type == "Regular Season":
        from . import season as season_mod

        # Rythme de la saison en cours, ou de la précédente avant le début de la saison.
        for season_label in (nba.current_season(), nba.previous_season()):
            try:
                pace = season_mod.dash(season_label)
            except SourceError:
                pace = {}
            if pace:
                break
    out = []
    for key, label in RECORD_CATEGORIES:
        board = [dict(b) for b in boards.get(key, [])]
        for i, b in enumerate(board):
            if not b["active"] or i == 0:
                continue
            above = board[i - 1]
            gap = (above["value"] or 0) - (b["value"] or 0)
            b["next"] = {"id": above["id"], "name": above["name"], "gap": gap}
            per_game = 1.0 if key == "GP" else nba._num((pace.get(b["id"]) or {}).get(key))
            if per_game and per_game > 0:
                b["perGame"] = per_game
                b["gamesToPass"] = int(math.floor(gap / per_game)) + 1
        out.append({"key": key, "label": label, "leaders": board})
    return {"seasonType": season_type, "boards": out}, meta


# ---------------------------------------------------------------------------
# Palmarès
# ---------------------------------------------------------------------------


def _name_index() -> dict[str, list[tuple[int, int | None, int | None]]]:
    try:
        idx, _ = nba.player_index()
    except SourceError:
        return {}
    pos = {k: i for i, k in enumerate(idx["fields"])}
    by_name: dict[str, list] = {}
    for row in idx["rows"]:
        key = palmares.norm(f"{row[pos['first']]} {row[pos['last']]}")
        by_name.setdefault(key, []).append((row[pos["id"]], row[pos["from"]], row[pos["to"]]))
    return by_name


def _player_id(by_name: dict, name: str, start_year: int) -> int | None:
    key = palmares.norm(name)
    key = palmares.PLAYER_ALIASES.get(key, key)
    cands = by_name.get(key, [])
    if len(cands) == 1:
        return cands[0][0]
    fitting = [c for c in cands if (c[1] or 0) <= start_year <= (c[2] or 9999)]
    return fitting[0][0] if len(fitting) == 1 else None


def _team_id(name: str, end_year: int) -> int | None:
    tri = palmares.team_tri(name, end_year)
    t = teams_meta.TEAMS_BY_TRI.get(tri) if tri else None
    return t["id"] if t else None


def palmares_data() -> tuple[dict, dict]:
    data = palmares.raw()
    by_name = _name_index()
    for award in data["awards"]:
        counts: Counter = Counter()
        for w in award["winners"]:
            start = int(w["season"][:4])
            w["id"] = _player_id(by_name, w["name"], start)
            w["teamId"] = _team_id(w["team"], start + 1)
            counts[w["name"]] += 1
        ids = {w["name"]: w["id"] for w in award["winners"]}
        award["most"] = [{"name": n, "id": ids.get(n), "count": c} for n, c in counts.most_common() if c > 1][:6]
    titles: Counter = Counter()
    for fin in data["finals"]:
        fin["championId"] = _team_id(fin["champion"], fin["year"])
        fin["runnerUpId"] = _team_id(fin["runnerUp"], fin["year"])
        titles[fin["championId"] or fin["champion"]] += 1
    data["titles"] = [
        {"teamId": k if isinstance(k, int) else None, "name": (teams_meta.TEAMS_BY_ID[k]["city"] + " " + teams_meta.TEAMS_BY_ID[k]["name"]) if isinstance(k, int) else k, "count": c}
        for k, c in titles.most_common()
    ]
    data["lastSeason"] = data["awards"][0]["winners"][0]["season"]
    return data, {"fetchedAt": None, "stale": False}


# ---------------------------------------------------------------------------
# Records en un match et sur une saison
# ---------------------------------------------------------------------------

# Catégories (colonne du journal des matchs de NBA.com, libellé, unité courte).
SPLIT_CATEGORIES = [
    ("PTS", "Points", "pts"),
    ("REB", "Rebonds", "reb"),
    ("AST", "Passes décisives", "pd"),
    ("STL", "Interceptions", "int"),
    ("BLK", "Contres", "ct"),
    ("FG3M", "Paniers à 3 points", "3 pts"),
]
TOP = 10


def _ranked(rows: list[dict]) -> list[dict]:
    """Rang avec ex aequo (même valeur, même rang)."""
    rows.sort(key=lambda r: -(r["value"] or 0))
    for i, r in enumerate(rows):
        r["rank"] = rows[i - 1]["rank"] if i and rows[i - 1]["value"] == r["value"] else i + 1
    return rows


def _season_game_log() -> tuple[list[dict], str, dict]:
    """Toutes les lignes joueur-match de la saison régulière en cours (ou de la précédente avant
    son début)."""
    last_meta: dict = {}
    for season_label in (nba.current_season(), nba.previous_season()):
        ttl = 1800 if season_label == nba.current_season() else 24 * 3600

        def fetch(s=season_label):
            raw = stats_json(
                "leaguegamelog",
                {"Counter": 0, "Direction": "DESC", "LeagueID": "00", "PlayerOrTeam": "P", "Season": s, "SeasonType": "Regular Season", "Sorter": "DATE"},
            )
            keep = ("PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GAME_ID", "GAME_DATE", "MATCHUP", "WL", "PTS", "REB", "AST", "STL", "BLK", "FG3M")
            return [{k: r.get(k) for k in keep} for r in result_sets(raw).get("LeagueGameLog", [])]

        rows, last_meta = nba._cache().get(f"leaguegamelog:{season_label}", ttl, fetch)
        if rows:
            return rows, season_label, last_meta
    return [], nba.current_season(), last_meta


def _resolver():
    from . import records_data

    by_name = _name_index()

    def resolve(name: str, year: int) -> int | None:
        key = palmares.norm(name)
        key = records_data.NAME_ALIASES.get(key, key)
        return _player_id(by_name, key, year)

    return resolve


def _matchup_opp(matchup: str) -> tuple[str, bool]:
    """« MIA vs. WAS » → ("WAS", à domicile) ; « MIA @ WAS » → ("WAS", à l'extérieur)."""
    parts = (matchup or "").replace("vs.", "@").split("@")
    return (parts[1].strip() if len(parts) > 1 else ""), "vs." in (matchup or "")


def _day_iso(raw: str) -> str:
    from datetime import datetime

    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%b %d, %Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw[:19] if "T" in raw else raw, fmt).date().isoformat()
        except ValueError:
            continue
    return raw[:10]


def records_game() -> tuple[dict, dict]:
    """Records en un match : de tous les temps (livre des records) et de la saison en cours."""
    from . import records_data

    rows, season_label, meta = _season_game_log()
    resolve = _resolver()
    boards = []
    for key, label, unit in SPLIT_CATEGORIES:
        all_time = _ranked(
            [
                {"value": v, "name": n, "id": resolve(n, int(d[:4])), "team": t, "opp": o, "date": d}
                for v, n, t, o, d in records_data.GAME.get(key, [])
            ]
        )
        current = []
        for r in sorted(rows, key=lambda r: -(nba._num(r.get(key)) or 0))[: TOP * 3]:
            value = nba._int(r.get(key))
            if not value:
                continue
            opp, home = _matchup_opp(r.get("MATCHUP"))
            current.append(
                {
                    "value": value,
                    "name": r.get("PLAYER_NAME") or "",
                    "id": nba._int(r.get("PLAYER_ID")),
                    "teamId": nba._int(r.get("TEAM_ID")),
                    "tri": r.get("TEAM_ABBREVIATION") or "",
                    "opp": opp,
                    "home": home,
                    "date": _day_iso(r.get("GAME_DATE")),
                    "gameId": r.get("GAME_ID") or "",
                    "win": r.get("WL") == "W",
                }
            )
        current = _ranked(current)[:TOP]
        floor = all_time[min(TOP, len(all_time)) - 1]["value"] if all_time else None
        for c in current:
            # Performance de la saison qui entre dans le top 10 de l'histoire.
            c["historic"] = floor is not None and c["value"] >= floor
            c["historicRank"] = 1 + sum(1 for a in all_time if a["value"] > c["value"]) if c["historic"] else None
        boards.append({"key": key, "label": label, "unit": unit, "allTime": all_time, "current": current})
    return {"season": season_label, "live": season_label == nba.current_season(), "boards": boards}, meta


def records_season() -> tuple[dict, dict]:
    """Records sur une saison : de tous les temps et meilleurs de la saison en cours (moyennes par
    match, sauf les paniers à 3 points en total)."""
    from . import records_data

    rows, season_label, meta = _season_game_log()
    resolve = _resolver()
    per: dict[int, dict] = {}
    for r in rows:
        pid = nba._int(r.get("PLAYER_ID"))
        if not pid:
            continue
        p = per.setdefault(pid, {"id": pid, "name": r.get("PLAYER_NAME") or "", "teamId": nba._int(r.get("TEAM_ID")), "tri": r.get("TEAM_ABBREVIATION") or "", "gp": 0, **{k: 0 for k, *_ in SPLIT_CATEGORIES}})
        p["gp"] += 1
        for k, *_ in SPLIT_CATEGORIES:
            p[k] += nba._int(r.get(k)) or 0
    # Pour une moyenne, il faut avoir joué au moins 70 % des matchs de son équipe à ce jour
    # (matchs de l'équipe = ceux du coéquipier qui en a joué le plus).
    team_games: dict[int, int] = {}
    for p in per.values():
        team_games[p["teamId"]] = max(team_games.get(p["teamId"], 0), p["gp"])
    boards = []
    for key, label, unit in SPLIT_CATEGORIES:
        total = key == "FG3M"
        all_time = _ranked([{"value": v, "name": n, "id": resolve(n, int(s[:4])), "season": s} for v, n, s in records_data.SEASON.get(key, [])])
        current = []
        for p in per.values():
            needed = max(1, math.ceil(0.7 * team_games.get(p["teamId"], 0)))
            if not total and p["gp"] < needed:
                continue
            value = p[key] if total else round(p[key] / p["gp"], 2)
            if value:
                current.append({"value": value, "name": p["name"], "id": p["id"], "teamId": p["teamId"], "tri": p["tri"], "gp": p["gp"], "season": season_label})
        current = _ranked(current)[:TOP]
        floor = all_time[min(TOP, len(all_time)) - 1]["value"] if all_time else None
        for c in current:
            # Une saison en cours n'est pas finie : pour les moyennes seulement, « au rythme actuel ».
            c["historic"] = floor is not None and c["value"] >= floor
        boards.append({"key": key, "label": label, "unit": unit, "perGame": not total, "allTime": all_time, "current": current})
    return {"season": season_label, "live": season_label == nba.current_season(), "boards": boards}, meta
