"""Saison en cours : course aux playoffs et course aux trophées.

Rien d'officiel ici : la NBA ne publie ni « nombre magique » ni classement des favoris aux
trophées. Tout est calculé à partir du classement, du calendrier et des statistiques
officielles, avec des règles simples et expliquées dans l'interface.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import mean, pstdev
from typing import Any

from . import nba
from .net import SourceError, result_sets, stats_json

GAMES = 82
PLAYOFF_SEEDS = 6
PLAYIN_SEEDS = 10

# ---------------------------------------------------------------------------
# Course aux playoffs
# ---------------------------------------------------------------------------


def _clinched(team: dict, rows: list[dict], places: int) -> bool:
    """Assuré de finir dans les `places` premiers : au plus places-1 équipes peuvent encore
    l'égaler ou le dépasser (les égalités comptent contre lui, faute de connaître les départages)."""
    others = sum(1 for o in rows if o is not team and o["maxW"] >= team["w"])
    return others <= places - 1


def _eliminated(team: dict, rows: list[dict], places: int) -> bool:
    """Ne peut plus finir dans les `places` premiers : au moins `places` équipes ont déjà plus de
    victoires qu'il ne peut en compter au mieux."""
    return sum(1 for o in rows if o is not team and o["w"] > team["maxW"]) >= places


def _behind(team: dict, ref: dict | None) -> float | None:
    if not ref:
        return None
    return ((ref["w"] - team["w"]) + (team["l"] - ref["l"])) / 2


def race_rows(rows: list[dict], remaining: dict[int, list[int]] | None = None, home_left: dict[int, int] | None = None, total: int = GAMES) -> list[dict]:
    """Calcule pour une conférence (lignes déjà triées par rang) ce qui reste à jouer, ce qui est
    acquis et ce qui manque. `remaining` : adversaires restants par équipe (calendrier)."""
    remaining = remaining or {}
    home_left = home_left or {}
    pct = {r["teamId"]: r.get("pct") or 0.0 for r in rows}
    out: list[dict] = []
    for r in rows:
        gp = r["w"] + r["l"]
        left = max(0, total - gp)
        out.append({**r, "gp": gp, "left": left, "maxW": r["w"] + left, "homeLeft": home_left.get(r["teamId"]), "pace": round(r["w"] / gp * total) if gp else None})
    out.sort(key=lambda r: r.get("rank") or 99)
    by_rank = {r["rank"]: r for r in out if r.get("rank")}
    sixth, seventh, tenth, eleventh = (by_rank.get(k) for k in (PLAYOFF_SEEDS, PLAYOFF_SEEDS + 1, PLAYIN_SEEDS, PLAYIN_SEEDS + 1))
    for r in out:
        top6 = _clinched(r, out, PLAYOFF_SEEDS)
        top10 = _clinched(r, out, PLAYIN_SEEDS)
        out6 = _eliminated(r, out, PLAYOFF_SEEDS)
        out10 = _eliminated(r, out, PLAYIN_SEEDS)
        if top6:
            status = "playoffs"
        elif top10:
            status = "playin"
        elif out10:
            status = "out"
        elif out6:
            status = "playin-max"
        else:
            status = "race"
        r["status"] = status
        rank = r.get("rank") or 99
        # Nombre magique : victoires de l'équipe + défaites du premier poursuivant nécessaires
        # pour être sûr de le devancer (égalité comptée comme perdue, d'où le +1).
        r["magic6"] = max(0, total + 1 - r["w"] - seventh["l"]) if rank <= PLAYOFF_SEEDS and seventh and not top6 else None
        r["magic10"] = max(0, total + 1 - r["w"] - eleventh["l"]) if PLAYOFF_SEEDS < rank <= PLAYIN_SEEDS and eleventh and not top10 else None
        # Nombre d'élimination : victoires de la 6e (ou 10e) équipe + défaites de celle-ci.
        r["elim6"] = max(0, total + 1 - sixth["w"] - r["l"]) if rank > PLAYOFF_SEEDS and sixth and not out6 else None
        r["elim10"] = max(0, total + 1 - tenth["w"] - r["l"]) if rank > PLAYIN_SEEDS and tenth and not out10 else None
        r["gb6"] = _behind(r, sixth) if rank > PLAYOFF_SEEDS else None
        r["gb10"] = _behind(r, tenth) if rank > PLAYIN_SEEDS else None
        opps = remaining.get(r["teamId"], [])
        known = [pct[o] for o in opps if o in pct]
        r["sos"] = round(mean(known), 3) if known else None
        r["oppLeft"] = len(opps)
    return out


def _all_pct(rows: list[dict]) -> dict[int, float]:
    return {r["teamId"]: r.get("pct") or 0.0 for r in rows}


def playoff_race() -> tuple[dict, dict]:
    st, meta = nba.standings()
    rows = st["rows"]
    remaining: dict[int, list[int]] = defaultdict(list)
    home_left: Counter = Counter()
    sched_ok = False
    if not st["fallback"]:
        sched = nba._schedule_or_none()
        if sched:
            sched_ok = True
            for g in sched["games"]:
                if not str(g.get("id", "")).startswith("002") or g.get("status") == 3:
                    continue
                home = (g.get("home") or {}).get("id")
                away = (g.get("away") or {}).get("id")
                if not home or not away:
                    continue
                remaining[home].append(away)
                remaining[away].append(home)
                home_left[home] += 1
    pct_all = _all_pct(rows)
    confs = {}
    for conf in ("East", "West"):
        conf_rows = [r for r in rows if r["conf"] == conf]
        computed = race_rows(conf_rows, remaining, home_left)
        # Difficulté du calendrier restant : bilan moyen des adversaires (toute la ligue).
        for r in computed:
            opps = remaining.get(r["teamId"], [])
            r["sos"] = round(mean(pct_all.get(o, 0.0) for o in opps), 3) if opps else None
        confs[conf] = computed
    ranked = sorted((r for c in confs.values() for r in c if r["sos"] is not None), key=lambda r: -r["sos"])
    for i, r in enumerate(ranked, 1):
        r["sosRank"] = i
    left_total = sum(r["left"] for c in confs.values() for r in c) // 2
    return {
        "season": st["season"],
        "requested": st["requested"],
        "fallback": st["fallback"],
        "total": GAMES,
        "gamesLeft": left_total,
        "schedule": sched_ok,
        "conferences": confs,
    }, meta


# ---------------------------------------------------------------------------
# Course aux trophées
# ---------------------------------------------------------------------------


def _dash_params(season: str, measure: str = "Base", starter_bench: str = "") -> dict:
    return {
        "College": "", "Conference": "", "Country": "", "DateFrom": "", "DateTo": "", "Division": "", "DraftPick": "",
        "DraftYear": "", "GameScope": "", "GameSegment": "", "Height": "", "LastNGames": 0, "LeagueID": "00",
        "Location": "", "MeasureType": measure, "Month": 0, "OpponentTeamID": 0, "Outcome": "", "PaceAdjust": "N",
        "PerMode": "PerGame", "Period": 0, "PlayerExperience": "", "PlayerPosition": "", "PlusMinus": "N", "Rank": "N",
        "Season": season, "SeasonSegment": "", "SeasonType": "Regular Season", "ShotClockRange": "",
        "StarterBench": starter_bench, "TeamID": 0, "TwoWay": "", "VsConference": "", "VsDivision": "", "Weight": "",
    }


def _num(v: Any) -> float | None:
    try:
        return None if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        return None


def _fetch_dash(season: str, measure: str, bench: str) -> dict:
    raw = stats_json("leaguedashplayerstats", _dash_params(season, measure, bench))
    out = {}
    for r in result_sets(raw).get("LeagueDashPlayerStats", []):
        pid = nba._int(r.get("PLAYER_ID"))
        if pid:
            out[str(pid)] = {k: r.get(k) for k in r}
    return out


def dash_meta(season: str, measure: str = "Base", bench: str = "") -> tuple[dict[int, dict], dict]:
    ttl = 3 * 3600 if season == nba.current_season() else 24 * 3600
    data, meta = nba._cache().get(f"dash:{season}:{measure}:{bench}", ttl, lambda: _fetch_dash(season, measure, bench))
    return {int(k): v for k, v in data.items()}, meta


def dash(season: str, measure: str = "Base", bench: str = "") -> dict[int, dict]:
    return dash_meta(season, measure, bench)[0]


def _safe(fn, default):
    try:
        return fn()
    except SourceError:
        return default


def _z(values: list[float]) -> list[float]:
    if len(values) < 2:
        return [0.0 for _ in values]
    m, s = mean(values), pstdev(values)
    return [0.0 if not s else (v - m) / s for v in values]


def _rank(cands: list[dict], weights: dict[str, float], limit: int = 8) -> list[dict]:
    """Score = somme pondérée des écarts à la moyenne des candidats (z-scores)."""
    if not cands:
        return []
    keys = list(weights)
    zs = {k: _z([c[k] if c.get(k) is not None else 0.0 for c in cands]) for k in keys}
    for i, c in enumerate(cands):
        c["score"] = sum(weights[k] * zs[k][i] for k in keys)
    cands.sort(key=lambda c: -c["score"])
    top = cands[:limit]
    # Part de l'indice du premier (barre affichée) : 100 pour le favori.
    hi = top[0]["score"]
    for c in top:
        c["share"] = round(100 * max(0.0, c["score"]) / hi, 1) if hi > 0 else 100.0
        c["score"] = round(c["score"], 3)
    return top


def _row(pid: int, b: dict) -> dict:
    gp = nba._int(b.get("GP")) or 0
    return {
        "id": pid,
        "name": b.get("PLAYER_NAME") or "",
        "teamId": nba._int(b.get("TEAM_ID"), None),
        "tri": b.get("TEAM_ABBREVIATION") or "",
        "gp": gp,
        "min": _num(b.get("MIN")),
        "pts": _num(b.get("PTS")),
        "reb": _num(b.get("REB")),
        "ast": _num(b.get("AST")),
        "stl": _num(b.get("STL")),
        "blk": _num(b.get("BLK")),
        "dreb": _num(b.get("DREB")),
        "fgPct": _num(b.get("FG_PCT")),
    }


AWARDS = [
    ("mvp", "MVP", "Meilleur joueur de la saison"),
    ("roy", "Rookie de l'année", "Meilleur joueur de première saison"),
    ("dpoy", "Défenseur de l'année", "Meilleur défenseur"),
    ("smoy", "Sixième homme", "Meilleur remplaçant"),
    ("mip", "Meilleure progression", "Plus gros progrès par rapport à la saison passée"),
]


def build_awards(base: dict[int, dict], adv: dict[int, dict], bench: dict[int, dict], prev: dict[int, dict], team_pct: dict[int, float], rookies: set[int]) -> dict:
    """Classements maison des favoris. Les candidats doivent avoir assez joué : 70 % des matchs
    joués par les plus assidus (65 matchs sur 82 en fin de saison pour la NBA)."""
    max_gp = max((nba._int(b.get("GP")) or 0 for b in base.values()), default=0)
    regular = max(1, round(max_gp * 0.7))
    rows = {pid: _row(pid, b) for pid, b in base.items()}
    for pid, r in rows.items():
        a = adv.get(pid) or {}
        r["pie"] = _num(a.get("PIE"))
        r["ts"] = _num(a.get("TS_PCT"))
        r["defRtg"] = _num(a.get("DEF_RATING"))
        r["netRtg"] = _num(a.get("NET_RATING"))
        r["teamPct"] = team_pct.get(r["teamId"])
        r["stocks"] = (r["stl"] or 0) + (r["blk"] or 0)
        r["negDef"] = -r["defRtg"] if r["defRtg"] is not None else None
        r["rebAst"] = (r["reb"] or 0) + (r["ast"] or 0)
        r["defReb"] = r["dreb"] if r["dreb"] is not None else r["reb"]

    def pick(cond):
        return [dict(r) for r in rows.values() if cond(r)]

    out: dict[str, list[dict]] = {}
    out["mvp"] = _rank(
        pick(lambda r: r["gp"] >= regular and (r["min"] or 0) >= 28),
        {"pie": 0.3, "pts": 0.25, "rebAst": 0.1, "ts": 0.1, "teamPct": 0.25} if adv else {"pts": 0.45, "rebAst": 0.25, "teamPct": 0.3},
    )
    out["roy"] = _rank(
        pick(lambda r: r["id"] in rookies and r["gp"] >= max(1, round(max_gp * 0.5))),
        {"pts": 0.4, "reb": 0.15, "ast": 0.15, "pie": 0.2, "min": 0.1} if adv else {"pts": 0.5, "reb": 0.2, "ast": 0.2, "min": 0.1},
    )
    out["dpoy"] = _rank(
        pick(lambda r: r["gp"] >= regular and (r["min"] or 0) >= 26),
        {"negDef": 0.4, "stocks": 0.35, "defReb": 0.25} if adv else {"stocks": 0.6, "defReb": 0.4},
    )
    smoy = []
    for pid, b in bench.items():
        r = rows.get(pid)
        bgp = nba._int(b.get("GP")) or 0
        if not r or r["gp"] < regular or bgp * 2 <= r["gp"]:
            continue
        c = dict(r)
        c.update({"benchGp": bgp, "pts": _num(b.get("PTS")), "reb": _num(b.get("REB")), "ast": _num(b.get("AST")), "min": _num(b.get("MIN"))})
        c["rebAst"] = (c["reb"] or 0) + (c["ast"] or 0)
        smoy.append(c)
    out["smoy"] = _rank(smoy, {"pts": 0.55, "rebAst": 0.2, "pie": 0.15, "fgPct": 0.1} if adv else {"pts": 0.65, "rebAst": 0.25, "fgPct": 0.1})
    mip = []
    for pid, r in rows.items():
        p = prev.get(pid)
        if not p or r["gp"] < regular or (nba._int(p.get("GP")) or 0) < 25 or pid in rookies:
            continue
        c = dict(r)
        c["prevPts"] = _num(p.get("PTS"))
        c["prevReb"] = _num(p.get("REB"))
        c["prevAst"] = _num(p.get("AST"))
        c["prevMin"] = _num(p.get("MIN"))
        c["dPts"] = round((r["pts"] or 0) - (c["prevPts"] or 0), 1)
        c["dRebAst"] = round(c["rebAst"] - (c["prevReb"] or 0) - (c["prevAst"] or 0), 1)
        c["dMin"] = round((r["min"] or 0) - (c["prevMin"] or 0), 1)
        if c["dPts"] <= 0:
            continue
        mip.append(c)
    out["mip"] = _rank(mip, {"dPts": 0.6, "dRebAst": 0.25, "dMin": 0.15})
    return out


def awards_race(season: str | None = None) -> tuple[dict, dict]:
    cur = nba.current_season()
    season = nba.valid_season(season) or cur
    shown, fallback = season, False
    base, meta = _safe(lambda: dash_meta(season), ({}, {}))
    if not base and season == cur:
        shown, fallback = nba.previous_season(), True
        base, meta = dash_meta(shown)
    if not base:
        raise SourceError("Statistiques de la saison indisponibles", source="stats.nba.com")
    start = int(shown[:4])
    prev_season = nba.season_label(start - 1)
    adv = _safe(lambda: dash(shown, "Advanced"), {})
    bench = _safe(lambda: dash(shown, "Base", "Bench"), {})
    prev = _safe(lambda: dash(prev_season), {})
    team_pct: dict[int, float] = {}
    st = _safe(lambda: nba.standings(shown)[0], None)
    if st:
        team_pct = {r["teamId"]: r.get("pct") or 0.0 for r in st["rows"]}
    rookies: set[int] = set()
    idx = _safe(lambda: nba.player_index()[0], None)
    if idx:
        pos = {k: i for i, k in enumerate(idx["fields"])}
        rookies = {row[pos["id"]] for row in idx["rows"] if row[pos["from"]] == start}
    awards = build_awards(base, adv, bench, prev, team_pct, rookies)
    max_gp = max((nba._int(b.get("GP")) or 0 for b in base.values()), default=0)
    return {
        "season": shown,
        "requested": season,
        "fallback": fallback,
        "gamesPlayed": max_gp,
        "advanced": bool(adv),
        "awards": [{"key": k, "label": label, "sub": sub, "players": awards.get(k, [])} for k, label, sub in AWARDS],
    }, meta
