"""Vérification complète des sources, avec les vraies données.

Les tests automatiques tournent en mode démo : ils ne voient pas un changement de format chez
NBA.com. Cette vérification interroge chaque source utilisée par une page de Parquet, sans
passer par le cache, et contrôle que la réponse a bien la forme attendue (champs présents,
nombre de lignes plausible). Elle se lance depuis la page « État des sources » ou avec
`python run.py --verifier`.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from . import extras, history, nba, net, player_season, season

LEBRON = 2544  # joueur de référence : présent dans toutes les sources depuis 2003


def ref_player() -> int:
    """Joueur de référence (en démo, un joueur fictif qui a une saison complète)."""
    return 1722532 if net.DEMO else LEBRON


def at_least(real: int, demo: int) -> int:
    """Seuil de vraisemblance : les données de démonstration sont plus petites."""
    return demo if net.DEMO else real


class Problem(Exception):
    """La source répond, mais pas comme prévu."""


def need(cond: Any, message: str) -> None:
    if not cond:
        raise Problem(message)


def _scores() -> str:
    data = nba._fetch_live_scoreboard()
    need(isinstance(data.get("games"), list), "liste des matchs absente")
    for g in data["games"][:3]:
        need(g.get("id") and g.get("home") and g.get("away"), "match sans équipes")
    return f"{len(data['games'])} match(s) aujourd'hui"


def _schedule() -> str:
    data = nba._fetch_schedule()
    games = data["games"]
    need(len(games) > 900, f"seulement {len(games)} matchs au calendrier")
    need(sum(1 for g in games if str(g["id"]).startswith("002")) > 900, "matchs de saison régulière introuvables")
    return f"{len(games)} matchs, saison {data['season']}"


def _box() -> str:
    sched = nba._fetch_schedule()
    done = [g for g in sched["games"] if g.get("status") == 3]
    if not done:
        return "aucun match terminé pour l'instant cette saison"
    game = done[-1]
    box = nba._box_from_live(net.cdn_json(f"liveData/boxscore/boxscore_{game['id']}.json"), None)
    teams = box.get("teams") or {}
    players = sum(len(t.get("players") or []) for t in (teams.values() if isinstance(teams, dict) else teams))
    need(players >= 16, f"box score incomplet ({players} joueurs)")
    return f"dernier match terminé : {players} joueurs"


def _standings() -> str:
    cur = nba.current_season()
    rows = nba._fetch_standings(cur)
    need(len(rows) == 30, f"{len(rows)} équipes au lieu de 30")
    need(all(isinstance(r["w"], int) and r["conf"] in ("East", "West") for r in rows), "victoires ou conférence manquantes")
    return f"30 équipes, {sum(r['w'] + r['l'] for r in rows) // 2} matchs joués"


def _dash(measure: str, needed: str) -> Callable[[], str]:
    def check() -> str:
        cur = nba.current_season()
        rows = season._fetch_dash(cur, measure, "")
        label = cur
        if not rows:
            label = nba.previous_season()
            rows = season._fetch_dash(label, measure, "")
        need(len(rows) > at_least(150, 100), f"seulement {len(rows)} joueurs")
        sample = next(iter(rows.values()))
        need(needed in sample, f"colonne {needed} absente")
        return f"{len(rows)} joueurs ({label})"

    return check


def _index() -> str:
    data = nba._fetch_player_index()
    rows = data["rows"]
    pos = {k: i for i, k in enumerate(data["fields"])}
    active = sum(1 for r in rows if r[pos["active"]])
    need(len(rows) > at_least(4000, 1000), f"seulement {len(rows)} joueurs dans l'index")
    need(active > 350, f"seulement {active} joueurs en activité")
    need(data.get("source") == "playerindex", "liste de secours utilisée (playerindex indisponible) : moins de détails")
    return f"{len(rows)} joueurs, dont {active} en activité"


def _player() -> str:
    rs = net.result_sets(net.stats_json("commonplayerinfo", {"PlayerID": ref_player(), "LeagueID": "00"}))
    info = (rs.get("CommonPlayerInfo") or [{}])[0]
    need(info.get("DISPLAY_FIRST_LAST"), "nom du joueur absent")
    return str(info.get("DISPLAY_FIRST_LAST"))


def _career() -> str:
    rs = net.result_sets(net.stats_json("playercareerstats", {"PlayerID": ref_player(), "PerMode": "Totals", "LeagueID": "00"}))
    need("SeasonTotalsRegularSeason" in rs and "CareerTotalsRegularSeason" in rs, "tableaux de carrière absents")
    rows = rs.get("SeasonTotalsRegularSeason") or []
    need(len(rows) >= at_least(20, 0), f"{len(rows)} saisons seulement")
    need(not rows or "PTS" in rows[0], "colonne PTS absente")
    return f"{len(rows)} lignes de saison"


def _gamelog() -> str:
    games = nba._gamelog(ref_player(), nba.previous_season(), "Regular Season")
    need(games, "aucun match")
    need(games[0]["date"] and games[0]["opp"], "date ou adversaire manquant")
    return f"{len(games)} matchs ({nba.previous_season()})"


def _shots() -> str:
    data = player_season._fetch_shots(ref_player(), nba.previous_season(), "Regular Season")
    need(len(data["shots"]) > 200, f"seulement {len(data['shots'])} tirs")
    need(data["league"], "moyennes de la ligue absentes")
    zones = {s[3] for s in data["shots"]}
    need("Restricted Area" in zones, "zones de tir inconnues")
    return f"{len(data['shots'])} tirs ({nba.previous_season()})"


def _draft() -> str:
    picks = nba._fetch_draft_history()["picks"]
    years = {p["year"] for p in picks}
    need(len(picks) > at_least(5000, 1000), f"seulement {len(picks)} choix")
    need(max(years) >= nba.current_season_start() - 1, f"dernière draft : {max(years)}")
    return f"{len(picks)} choix, de {min(years)} à {max(years)}"


def _records() -> str:
    boards = history._fetch_records("Regular Season")
    pts = boards.get("PTS") or []
    need(len(pts) >= 25, f"{len(pts)} meilleurs marqueurs seulement")
    need(pts[0]["value"] and pts[0]["value"] > 30000, "valeur du premier marqueur invraisemblable")
    return f"meilleur marqueur : {pts[0]['name']}"


def _playoffs() -> str:
    data = nba._fetch_playoffs(nba.previous_season())
    series = data.get("series") or data.get("rounds") or data
    need(series, "tableau vide")
    return f"tableau {nba.previous_season()} disponible"


def _injuries() -> str:
    if net.DEMO:
        data, _ = extras.injury_report()
        need(data.get("games") is not None, "rapport illisible")
        return "rapport de démonstration"
    url, pdf = extras._latest_report()
    need(pdf and pdf[:4] == b"%PDF", "le rapport n'est pas un PDF")
    return url.rsplit("/", 1)[-1]


def _moves() -> str:
    data = extras._fetch_moves()
    need(data["items"], "aucune transaction")
    return f"{len(data['items'])} transactions"


def _teams_adv() -> str:
    from . import teamstats

    rows = teamstats._fetch_advanced(nba.current_season()) or teamstats._fetch_advanced(nba.previous_season())
    need(len(rows) == 30, f"{len(rows)} équipes au lieu de 30")
    need(rows[0].get("off") is not None and rows[0].get("pace") is not None, "colonnes OFF_RATING ou PACE absentes")
    return "30 équipes"


def _h2h() -> str:
    from . import teamstats

    games = teamstats._fetch_h2h(1610612738, 1610612747)
    need(len(games) > at_least(100, 20), f"seulement {len(games)} confrontations Celtics-Lakers")
    return f"{len(games)} confrontations Celtics-Lakers"


def _wiki() -> str:
    net.wiki_json("https://fr.wikipedia.org/w/api.php", {"action": "query", "meta": "siteinfo", "format": "json"})
    return "Wikipédia répond"


CHECKS: list[tuple[str, str, str, Callable[[], str]]] = [
    ("scores", "Scores du jour", "Accueil, Matchs", _scores),
    ("schedule", "Calendrier de la saison", "Matchs, Équipes, Course aux playoffs", _schedule),
    ("box", "Box score d'un match", "Page d'un match", _box),
    ("standings", "Classement", "Classement, Course aux playoffs", _standings),
    ("dash", "Statistiques des joueurs", "Leaders, Trophées", _dash("Base", "PTS")),
    ("advanced", "Statistiques avancées", "Trophées", _dash("Advanced", "PIE")),
    ("index", "Index des joueurs", "Recherche, Joueurs, Jeu, Draft", _index),
    ("player", "Fiche joueur", "Fiche joueur", _player),
    ("career", "Carrière", "Fiche joueur", _career),
    ("gamelog", "Matchs d'un joueur", "Fiche joueur", _gamelog),
    ("shots", "Carte des tirs", "Fiche joueur (saison en détail)", _shots),
    ("draft", "Historique des drafts", "Draft", _draft),
    ("records", "Records de tous les temps", "Records", _records),
    ("playoffs", "Tableau des playoffs", "Playoffs", _playoffs),
    ("injuries", "Rapport des blessures", "Infos, matchs", _injuries),
    ("moves", "Transactions", "Infos", _moves),
    ("teams", "Statistiques des équipes", "Équipes (statistiques avancées)", _teams_adv),
    ("h2h", "Confrontations", "Face-à-face", _h2h),
    ("wiki", "Biographies", "Fiches joueur et équipe", _wiki),
]


def _run(check: tuple[str, str, str, Callable[[], str]]) -> dict:
    key, label, pages, fn = check
    t0 = time.monotonic()
    try:
        detail = fn()
        level, message = "ok", detail
    except Problem as exc:
        level, message = "warn", f"Format inattendu : {exc}"
    except net.SourceError as exc:
        level, message = "error", str(exc)
    except Exception as exc:  # noqa: BLE001 - tout ce qui casse doit apparaître dans le rapport
        level, message = "warn", f"Réponse illisible ({type(exc).__name__} : {exc})"
    return {"key": key, "label": label, "pages": pages, "level": level, "message": message, "ms": int((time.monotonic() - t0) * 1000)}


def run_all() -> dict:
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(_run, CHECKS))
    return {
        "demo": net.DEMO,
        "season": nba.current_season(),
        "checks": results,
        "ok": sum(1 for r in results if r["level"] == "ok"),
        "total": len(results),
    }


def report_text(data: dict) -> str:
    icons = {"ok": "OK ", "warn": "!! ", "error": "XX "}
    lines = [f"Vérification des sources de Parquet (saison {data['season']}{', mode démo' if data['demo'] else ''})", ""]
    for r in data["checks"]:
        lines.append(f"{icons[r['level']]} {r['label']:<28} {r['message']}  ({r['ms']} ms)")
    lines += ["", f"{data['ok']} sur {data['total']} sources fonctionnent normalement."]
    return "\n".join(lines)
