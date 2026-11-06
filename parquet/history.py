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
