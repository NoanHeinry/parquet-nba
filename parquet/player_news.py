"""Actualité d'un joueur : état de santé et faits récents.

Tout vient de sources déjà utilisées par Parquet, aucune nouvelle dépendance :

- le rapport officiel des blessures de la NBA (absent, incertain, probable… et la raison) ;
- les matchs de l'équipe comparés à ceux du joueur (absences, retour au jeu) ;
- ses matchs de la saison : records, gros matchs, triple-doubles, séries en cours ;
- ses records en carrière et ses totaux (caps franchis : 10 000 points…) ;
- les transactions officielles (échange, signature, libération) ;
- ses récompenses récentes (joueur de la semaine, du mois).

Chaque fait a une date ; on garde les plus récents (30 jours au plus, sauf l'état de santé).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from . import extras, nba, net, teams_meta

RECENT_DAYS = 30
MAX_ITEMS = 8

# Seuils au-delà desquels un record de la saison vaut la peine d'être signalé.
STATS = {
    "pts": ("points", 20),
    "reb": ("rebonds", 10),
    "ast": ("passes décisives", 8),
    "tpm": ("tirs à 3 points réussis", 5),
    "blk": ("contres", 4),
    "stl": ("interceptions", 4),
}
HIGH_KEYS = {"PTS": "pts", "REB": "reb", "AST": "ast", "FG3M": "tpm", "BLK": "blk", "STL": "stl"}

# Caps de carrière : tous les 1 000 jusqu'à 10 000, puis tous les 5 000.
MILESTONE_STATS = {"pts": "points", "reb": "rebonds", "ast": "passes décisives"}


def _day(value: str) -> date | None:
    try:
        return date.fromisoformat((value or "")[:10])
    except ValueError:
        return None


def _num_fr(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _vs(g: dict) -> str:
    return f"{'contre' if g.get('home') else 'à'} {g.get('opp') or ''}".strip()


def _line(g: dict) -> str:
    return f"{g['pts']} pts, {g['reb']} reb, {g['ast']} pd"


def _item(kind: str, day: str, title: str, text: str = "", game_id: str = "", tone: str = "") -> dict:
    return {"kind": kind, "date": day, "title": title, "text": text, "gameId": game_id or "", "tone": tone}


def injury_status(player_id: int) -> dict | None:
    """Ligne du joueur dans le dernier rapport officiel des blessures (prochain match)."""
    try:
        data, _ = extras.injury_report()
    except Exception:  # rapport indisponible : on n'affiche simplement pas d'état
        return None
    for g in data.get("games") or []:
        for t in g.get("teams") or []:
            for p in t.get("players") or []:
                if p.get("id") == player_id:
                    return {
                        "status": p.get("status") or "",
                        "statusFr": p.get("statusFr") or p.get("status") or "",
                        "level": p.get("level", 5),
                        "reason": p.get("reasonFr") or p.get("reason") or "",
                        "gameDate": g.get("date") or "",
                        "gameId": g.get("gameId") or "",
                        "matchup": g.get("matchup") or "",
                        "published": data.get("publishedEt") or "",
                    }
    return None


def _team_games(team_id: int | None, kind_prefix: str, today: date) -> list[dict]:
    """Matchs terminés de l'équipe cette saison, du plus récent au plus ancien."""
    if not team_id:
        return []
    sched = nba._schedule_or_none() or {}
    out = []
    for g in sched.get("games") or []:
        if not str(g.get("id", "")).startswith(kind_prefix) or g.get("status") != 3:
            continue
        if team_id not in ((g.get("away") or {}).get("id"), (g.get("home") or {}).get("id")):
            continue
        d = _day(g.get("etDate"))
        if d and d <= today:
            out.append(g)
    out.sort(key=lambda g: g.get("etDate") or "", reverse=True)
    return out


def absence_items(games: list[dict], team_games: list[dict]) -> list[dict]:
    """Absences en cours et retour au jeu, d'après les matchs de l'équipe."""
    if not team_games:
        return []
    played = {g["gameId"] for g in games}
    missed_now = 0
    for g in team_games:
        if g["id"] in played:
            break
        missed_now += 1
    items = []
    if missed_now:
        since = team_games[missed_now - 1]["etDate"]
        what = "du dernier match" if missed_now == 1 else f"des {missed_now} derniers matchs"
        items.append(_item("absence", team_games[0]["etDate"], f"Absent lors {what} de son équipe", f"Pas de match joué depuis le {since[8:10]}/{since[5:7]}.", tone="warn"))
        return items
    # Retour au jeu : il a joué le dernier match après en avoir manqué au moins deux.
    missed_before = 0
    for g in team_games[1:]:
        if g["id"] in played:
            break
        missed_before += 1
    if missed_before >= 2 and games:
        last = games[0]
        items.append(_item("return", last["date"], f"De retour après {missed_before} matchs d'absence", f"{_line(last)} {_vs(last)}.", last["gameId"], tone="good"))
    return items


def game_items(games: list[dict], season_highs_ok: bool, since: date) -> list[dict]:
    """Records de la saison, gros matchs, triple-doubles et séries en cours (matchs de la saison)."""
    items: list[dict] = []
    if not games:
        return items
    recent = [g for g in games if (_day(g["date"]) or date.min) >= since]
    flagged: set[str] = set()
    # Records de la saison battus récemment (pas sur les 3 premiers matchs : tout serait un record).
    if season_highs_ok and len(games) >= 5:
        for key, (label, floor) in STATS.items():
            best = max(games, key=lambda g: (g.get(key) or 0, g["date"]))
            value = best.get(key) or 0
            if value >= floor and best in recent:
                flagged.add(best["gameId"])
                items.append(_item("season-high", best["date"], f"Record de la saison : {value} {label}", f"{_line(best)} {_vs(best)}.", best["gameId"], "good"))
    for g in recent:
        cats = sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if (g.get(k) or 0) >= 10)
        if cats >= 3:
            items.append(_item("triple-double", g["date"], "Triple-double", f"{_line(g)} {_vs(g)}.", g["gameId"], "good"))
        elif (g.get("pts") or 0) >= 40 and g["gameId"] not in flagged:
            items.append(_item("big-game", g["date"], f"{g['pts']} points", f"{_line(g)} {_vs(g)}.", g["gameId"], "good"))
    # Séries en cours (du dernier match en remontant).
    def streak(test) -> int:
        n = 0
        for g in games:
            if not test(g):
                break
            n += 1
        return n

    for floor, minimum in ((30, 3), (20, 6)):
        n = streak(lambda g, f=floor: (g.get("pts") or 0) >= f)
        if n >= minimum:
            items.append(_item("streak", games[0]["date"], f"{n} matchs de suite à {floor} points ou plus", "Série en cours.", games[0]["gameId"], "good"))
            break
    dd = streak(lambda g: sum(1 for k in ("pts", "reb", "ast", "stl", "blk") if (g.get(k) or 0) >= 10) >= 2)
    if dd >= 4:
        items.append(_item("streak", games[0]["date"], f"{dd} doubles-doubles de suite", "Série en cours.", games[0]["gameId"], "good"))
    return items


def career_high_items(highs: list[dict], since: date) -> list[dict]:
    items = []
    for h in highs or []:
        key = HIGH_KEYS.get(h.get("stat") or "")
        d = _day(h.get("date"))
        if not key or not d or d < since or h.get("value") is None:
            continue
        label, floor = STATS[key]
        if h["value"] < floor:
            continue
        vs = f" contre {h['vsTri']}" if h.get("vsTri") else ""
        items.append(_item("career-high", h["date"], f"Record en carrière : {h['value']} {label}", f"Meilleur total de sa carrière{vs}.", h.get("gameId") or "", "good"))
    return items


def _milestones(total: float) -> list[int]:
    marks = list(range(1000, 10001, 1000)) + list(range(15000, 50001, 5000))
    return [m for m in marks if m <= total]


def milestone_items(career_total: dict | None, games: list[dict], since: date) -> list[dict]:
    """Caps de carrière franchis lors des matchs récents (10 000 points…)."""
    if not career_total or not games:
        return []
    items = []
    chrono = sorted((g for g in games if (_day(g["date"]) or date.min) >= since), key=lambda g: g["date"], reverse=True)
    for key, label in MILESTONE_STATS.items():
        total = career_total.get(key) or 0
        # On remonte les matchs récents : avant chacun, le total était plus petit.
        after = total
        for g in chrono:
            before = after - (g.get(key) or 0)
            crossed = [m for m in _milestones(after) if m > before]
            if crossed:
                items.append(_item("milestone", g["date"], f"{_num_fr(crossed[-1])} {label} en carrière", f"Cap franchi {_vs(g)} ({_line(g)}).", g["gameId"], "good"))
                break
            after = before
    return items


# Transaction vue du joueur (le texte officiel est écrit du point de vue de l'équipe).
MOVE_FR = {
    "Trade": ("Échange", "Rejoint les {team}"),
    "Signing": ("Signature", "Signe avec les {team}"),
    "AwardOnWaivers": ("Récupéré", "Récupéré par les {team} (waivers)"),
    "Waive": ("Libéré", "Libéré par les {team}"),
    "ContractConverted": ("Nouveau contrat", "Contrat modifié avec les {team}"),
}


def transaction_items(player_id: int) -> list[dict]:
    try:
        data, _ = extras.transactions(player_id=player_id, days=RECENT_DAYS * 3, limit=5)
    except Exception:
        return []
    items = []
    for x in data.get("items") or []:
        t = teams_meta.team(x.get("teamId"))
        title, text = MOVE_FR.get(x.get("type"), (x.get("typeFr") or "Transaction", ""))
        text = text.format(team=t["name"]) if t and text else x.get("text") or x.get("original") or ""
        items.append(_item("transaction", x["date"], title, text, tone="warn" if x.get("type") == "Waive" else "info"))
    return items


def _award_day(item: dict) -> date | None:
    """Date d'une récompense hebdomadaire ou mensuelle (formats variables selon les saisons)."""
    for raw in (item.get("week"), item.get("month")):
        raw = str(raw or "").strip()
        for text, fmt in ((raw[:10], "%Y-%m-%d"), (raw[:8], "%Y%m%d"), (raw.split(" ")[0], "%m/%d/%Y")):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
    return None


def award_items(player_id: int, since: date) -> list[dict]:
    try:
        data, _ = nba.player_awards(player_id)
    except Exception:
        return []
    names = {"Player of the Week": "Joueur de la semaine", "Player of the Month": "Joueur du mois", "Rookie of the Month": "Rookie du mois"}
    items = []
    for g in data.get("awards") or []:
        key = g.get("key") or ""
        fr = next((v for k, v in names.items() if k.lower() in key.lower()), None)
        if not fr:
            continue
        for it in g.get("items") or []:
            d = _award_day(it)
            if d and d >= since:
                conf = it.get("conference") or ""
                items.append(_item("award", d.isoformat(), fr, f"Conférence {'Est' if conf.lower().startswith('east') else 'Ouest'}." if conf else "", tone="good"))
    return items


def player_news(player_id: int) -> tuple[dict, dict]:
    info, meta = nba.player_info(player_id)
    today = nba.game_day_et()
    since = today - timedelta(days=RECENT_DAYS)
    items: list[dict] = []
    status = injury_status(player_id) if info.get("active") else None
    games: list[dict] = []
    if info.get("active"):
        try:
            log, _ = nba.player_gamelog(player_id)
            games = sorted(log.get("games") or [], key=lambda g: g["date"], reverse=True)
            prefix = "001" if "Pre" in (log.get("type") or "") else "002"
        except Exception:
            prefix = "002"
        if net.DEMO and games:
            # Démo : les matchs fictifs s'arrêtent à la présaison, « récent » se compte depuis le dernier.
            today = _day(games[0]["date"]) or today
            since = today - timedelta(days=RECENT_DAYS)
        items += absence_items(games, _team_games(info.get("teamId"), prefix, today))
        items += game_items(games, True, since)
    try:
        career, _ = nba.player_career(player_id)
        items += career_high_items(career.get("careerHighs") or [], since)
        if info.get("active"):
            items += milestone_items(career.get("careerRegular"), games, since)
    except Exception:
        pass
    items += transaction_items(player_id)
    items += award_items(player_id, since)
    # Un record en carrière remplace le record de la saison et le « gros match » du même jour.
    career_games = {(i["gameId"], i["title"].split(":")[-1].strip()) for i in items if i["kind"] == "career-high"}
    items = [i for i in items if not (i["kind"] in ("season-high", "big-game") and any(g == i["gameId"] and t in i["title"] for g, t in career_games))]
    items.sort(key=lambda i: (i["date"], i["kind"] != "absence"), reverse=True)
    return {"status": status, "items": items[:MAX_ITEMS]}, meta
