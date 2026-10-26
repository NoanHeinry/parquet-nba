"""Mode démonstration : des données NBA fictives, générées localement.

Lancé avec `python run.py --demo`, Parquet n'interroge ni NBA.com ni Wikipédia : toutes les
réponses viennent de ce module, avec exactement la même structure que les vraies sources.
Les équipes sont les vraies franchises, mais les joueurs, les scores et les statistiques sont
inventés (générateur pseudo-aléatoire à graine fixe : les données sont identiques à chaque lancement).

Ce mode sert à découvrir l'application hors ligne, aux tests d'interface automatisés et aux
captures d'écran de la documentation.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import date, datetime, timedelta

from . import net, teams_meta
from .net import NotAvailable, SourceError

TEAMS = teams_meta.TEAMS
TODAY = "2026-10-14"
STAR, STAR2 = 1790001, 1790002


def rng(*keys) -> random.Random:
    seed = int(hashlib.md5("|".join(map(str, keys)).encode()).hexdigest()[:12], 16)
    return random.Random(seed)


FIRST = ["Alix", "Bastien", "Cyril", "Dorian", "Elouan", "Fabio", "Gaspard", "Hugo", "Ilan", "Jordan", "Kylian", "Léon", "Malo", "Nolan", "Oscar", "Pablo", "Quentin", "Rayan", "Sacha", "Timéo", "Ugo", "Valentin", "Wesley", "Yanis", "Zacharie", "Marius", "Elias", "Noah", "Axel", "Enzo"]
LAST = ["Arnaud", "Bertin", "Carrel", "Delmas", "Esnault", "Fabre", "Garnier", "Hamon", "Imbert", "Jolivet", "Kervella", "Lacombe", "Marchal", "Navarro", "Olivier", "Perrin", "Quéré", "Rivière", "Sabatier", "Tessier", "Urbain", "Vasseur", "Weiss", "Ybert", "Zeller", "Morvan", "Lebrun", "Castel", "Duval", "Ferrand"]
COLLEGES = ["Duke", "Kentucky", "Gonzaga", "Kansas", "UCLA", "North Carolina", "Arizona", "Villanova", "Baylor", "", "", "Michigan State"]
COUNTRIES = ["USA"] * 12 + ["France", "France", "Canada", "Serbia", "Slovenia", "Australia", "Germany", "Cameroon", "Greece", "Turkey"]
POS = ["G", "G", "F", "F", "C", "G-F", "F-C"]


def player_id_for(team_id: int, slot: int) -> int:
    return 1700000 + (team_id % 1000) * 30 + slot


ROSTERS: dict[int, list[dict]] = {}
PLAYERS: dict[int, dict] = {}


def _make_rosters() -> None:
    for t in TEAMS:
        r = rng("roster", t["id"])
        roster = []
        used_numbers = set()
        for slot in range(15):
            pid = player_id_for(t["id"], slot)
            num = r.choice([n for n in range(0, 55) if n not in used_numbers])
            used_numbers.add(num)
            age = r.randint(19, 36)
            from_year = 2026 - max(0, age - r.randint(19, 22))
            p = {
                "id": pid,
                "first": r.choice(FIRST),
                "last": r.choice(LAST),
                "teamId": t["id"],
                "tri": t["tri"],
                "num": str(num),
                "pos": r.choice(POS),
                "height": f"{r.randint(6, 7)}-{r.randint(0, 11)}",
                "weight": str(r.randint(180, 270)),
                "age": age,
                "birth": f"{2026 - age}-{r.randint(1, 12):02d}-{r.randint(1, 28):02d}",
                "school": r.choice(COLLEGES),
                "country": r.choice(COUNTRIES),
                "from": from_year,
                "exp": max(0, 2026 - from_year),
                "pts": round(r.uniform(2, 31), 1) if slot < 10 else round(r.uniform(0, 6), 1),
                "reb": round(r.uniform(1, 12), 1),
                "ast": round(r.uniform(0.5, 9), 1),
            }
            p["name"] = f"{p['first']} {p['last']}"
            roster.append(p)
            PLAYERS[pid] = p
        roster.sort(key=lambda x: -x["pts"])
        ROSTERS[t["id"]] = roster
    # Joueurs réels pour la page joueur « vitrine ».
    lebron = {"id": 1790001, "first": "Marcel", "last": "Duval", "name": "Marcel Duval", "teamId": 1610612755, "tri": "PHI", "num": "23",
              "pos": "F", "height": "6-9", "weight": "250", "age": 41, "birth": "1984-12-30", "school": "Lycée Gustave-Eiffel",
              "country": "USA", "from": 2003, "exp": 23, "pts": 20.9, "reb": 7.2, "ast": 6.1}
    wemby = {"id": 1790002, "first": "Elouan", "last": "Kervella", "name": "Elouan Kervella", "teamId": 1610612759, "tri": "SAS", "num": "1",
             "pos": "C", "height": "7-4", "weight": "235", "age": 22, "birth": "2004-01-04", "school": "Metropolitans 92 (France)",
             "country": "France", "from": 2023, "exp": 3, "pts": 26.2, "reb": 11.8, "ast": 3.9}
    for star in (lebron, wemby):
        PLAYERS[star["id"]] = star
        roster = ROSTERS[star["teamId"]]
        roster[0] = star


_make_rosters()

# ---------------------------------------------------------------- calendrier


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


GAMES: list[dict] = []
GAMES_BY_ID: dict[str, dict] = {}

LIVE_DAY = [
    # id, away, home, status, period, clock, away score, home score, start UTC
    ("0012600050", "MIA", "BKN", 3, 4, "", 104, 99, "2026-10-14T23:00:00Z"),
    ("0012600051", "DEN", "PHX", 2, 3, "PT05M23.00S", 78, 74, "2026-10-14T23:30:00Z"),
    ("0012600052", "DAL", "HOU", 2, 4, "PT00M48.20S", 101, 99, "2026-10-15T00:00:00Z"),
    ("0012600053", "CHI", "MIL", 1, 0, "", 0, 0, "2026-10-15T00:00:00Z"),
    ("0012600054", "SAS", "PHI", 1, 0, "", 0, 0, "2026-10-15T02:30:00Z"),
]


def _team_side(tri: str, score: int, r: random.Random, record=(0, 0)) -> dict:
    t = teams_meta.TEAMS_BY_TRI[tri]
    return {"teamId": t["id"], "teamName": t["name"], "teamCity": t["city"], "teamTricode": tri, "teamSlug": t["name"].lower(),
            "wins": record[0], "losses": record[1], "score": score, "seed": 0}


def _split_periods(total: int, periods: int, r: random.Random) -> list[int]:
    if periods == 0:
        return []
    weights = [r.uniform(0.8, 1.2) for _ in range(periods)]
    if periods > 4:
        weights = weights[:4] + [w * 0.42 for w in weights[4:]]
    s = sum(weights)
    vals = [int(total * w / s) for w in weights]
    vals[-1] += total - sum(vals)
    return vals


def _build_schedule() -> None:
    r = rng("schedule")
    records = {t["tri"]: [0, 0] for t in TEAMS}
    pre_records = {t["tri"]: [0, 0] for t in TEAMS}
    counter = {"pre": 1, "reg": 1}
    d = date(2026, 10, 3)
    end = date(2027, 4, 11)
    tris = [t["tri"] for t in TEAMS]
    reg_count = {tri: 0 for tri in tris}
    while d <= end:
        day = d.isoformat()
        if day == TODAY:
            for gid, a, hm, st, per, clock, sa, sh, start in LIVE_DAY:
                g = {"gameId": gid, "gameStatus": st, "gameStatusText": "Final" if st == 3 else ("Q%d 5:23" % per if st == 2 else "7:00 pm ET"),
                     "period": per, "gameClock": clock, "gameLabel": "Preseason", "etDate": day, "start": start,
                     "away": a, "home": hm, "sa": sa, "sh": sh}
                GAMES.append(g)
            d += timedelta(days=1)
            continue
        if d < date(2026, 10, 18):
            n = r.randint(2, 6)
            kind = "pre"
        elif d < date(2026, 10, 20):
            d += timedelta(days=1)
            continue
        else:
            n = r.randint(4, 12)
            kind = "reg"
        avail = [x for x in tris if kind == "pre" or reg_count[x] < 82]
        r.shuffle(avail)
        for k in range(min(n, len(avail) // 2)):
            a, hm = avail[2 * k], avail[2 * k + 1]
            if kind == "reg":
                reg_count[a] += 1
                reg_count[hm] += 1
            prefix = "001" if kind == "pre" else "002"
            gid = f"{prefix}26{counter[kind]:05d}"
            counter[kind] += 1
            hour = r.choice([23, 23, 0, 0, 1, 2, 2])
            start_day = d if hour >= 23 else d + timedelta(days=1)
            start = f"{start_day.isoformat()}T{hour:02d}:{r.choice(['00', '30'])}:00Z"
            past = day < TODAY
            sa = r.randint(92, 128) if past else 0
            sh = r.randint(92, 128) if past else 0
            if past and sa == sh:
                sh += 3
            label = "Preseason" if kind == "pre" else ""
            if kind == "reg" and day == "2027-01-22":
                label = "NBA Paris Game"
            if kind == "reg" and "2026-11-01" <= day <= "2026-11-28" and r.random() < 0.4:
                label = "Emirates NBA Cup"
            g = {"gameId": gid, "gameStatus": 3 if past else 1, "gameStatusText": "Final" if past else "7:30 pm ET",
                 "period": 4 if past else 0, "gameClock": "", "gameLabel": label, "etDate": day, "start": start,
                 "away": a, "home": hm, "sa": sa, "sh": sh}
            GAMES.append(g)
        d += timedelta(days=1)
    for g in GAMES:
        GAMES_BY_ID[g["gameId"]] = g


_build_schedule()


def _game_json(g: dict, schedule_style: bool) -> dict:
    r = rng("game", g["gameId"])
    started = g["gameStatus"] >= 2
    periods = max(4, g["period"]) if g["gameStatus"] == 3 else g["period"]
    away = _team_side(g["away"], g["sa"], r, (r.randint(0, 3), r.randint(0, 3)))
    home = _team_side(g["home"], g["sh"], r, (r.randint(0, 3), r.randint(0, 3)))
    if not schedule_style:
        for side, total in ((away, g["sa"]), (home, g["sh"])):
            side["periods"] = [{"period": i + 1, "periodType": "REGULAR" if i < 4 else "OVERTIME", "score": v}
                               for i, v in enumerate(_split_periods(total, periods, r))] if started else []
            side["timeoutsRemaining"] = 3
            side["inBonus"] = None
    out = {
        "gameId": g["gameId"], "gameCode": f"{g['etDate'].replace('-', '')}/{g['away']}{g['home']}",
        "gameStatus": g["gameStatus"], "gameStatusText": g["gameStatusText"], "period": g["period"], "gameClock": g["gameClock"],
        "gameLabel": g["gameLabel"], "gameSubLabel": "", "seriesText": "", "ifNecessary": False, "isNeutral": g["gameLabel"] == "NBA Paris Game",
        "homeTeam": home, "awayTeam": away,
    }
    if schedule_style:
        out.update({
            "gameDateTimeUTC": g["start"], "gameTimeUTC": "1900-01-01T" + g["start"][11:],
            "arenaName": "Accor Arena" if g["gameLabel"] == "NBA Paris Game" else f"{teams_meta.TEAMS_BY_TRI[g['home']]['city']} Arena",
            "arenaCity": "Paris" if g["gameLabel"] == "NBA Paris Game" else teams_meta.TEAMS_BY_TRI[g["home"]]["city"],
            "arenaState": "",
            "postponedStatus": "N",
            "broadcasters": {"nationalBroadcasters": [{"broadcasterDisplay": r.choice(["NBA TV", "ESPN", "NBC", "Prime Video"])}] if r.random() < 0.5 else []},
            "pointsLeaders": [{"personId": ROSTERS[home["teamId"]][0]["id"], "firstName": ROSTERS[home["teamId"]][0]["first"],
                               "lastName": ROSTERS[home["teamId"]][0]["last"], "teamId": home["teamId"], "teamTricode": g["home"],
                               "points": r.randint(18, 41)}] if g["gameStatus"] == 3 else [],
        })
    else:
        out["gameTimeUTC"] = g["start"]
        out["gameEt"] = g["start"]
        if started:
            def leader(tid, tri):
                p = ROSTERS[tid][0]
                return {"personId": p["id"], "name": p["name"], "jerseyNum": p["num"], "position": p["pos"], "teamTricode": tri,
                        "points": r.randint(14, 38), "rebounds": r.randint(2, 14), "assists": r.randint(1, 11)}
            out["gameLeaders"] = {"homeLeaders": leader(home["teamId"], g["home"]), "awayLeaders": leader(away["teamId"], g["away"])}
        else:
            out["gameLeaders"] = {"homeLeaders": {"personId": 0}, "awayLeaders": {"personId": 0}}
    return out


def todays_scoreboard() -> dict:
    games = [GAMES_BY_ID[x[0]] for x in LIVE_DAY]
    return {"meta": {}, "scoreboard": {"gameDate": TODAY, "leagueId": "00", "games": [_game_json(g, False) for g in games]}}


def schedule() -> dict:
    by_date: dict[str, list] = {}
    for g in GAMES:
        by_date.setdefault(g["etDate"], []).append(_game_json(g, True))
    dates = []
    for day in sorted(by_date):
        y, m, d = day.split("-")
        dates.append({"gameDate": f"{m}/{d}/{y} 00:00:00", "games": by_date[day]})
    return {"meta": {}, "leagueSchedule": {"seasonYear": "2026-27", "leagueId": "00", "gameDates": dates, "weeks": []}}


def scoreboard_v3(day: str) -> dict:
    games = [g for g in GAMES if g["etDate"] == day]
    return {"meta": {}, "scoreboard": {"gameDate": day, "games": [_game_json(g, False) for g in games]}}


# ---------------------------------------------------------------- box score / play-by-play


def _distribute(total: int, n: int, r: random.Random, weights=None) -> list[int]:
    weights = weights or [r.uniform(0.2, 1.5) for _ in range(n)]
    s = sum(weights)
    vals = [int(total * w / s) for w in weights]
    for _ in range(total - sum(vals)):
        vals[r.randrange(n)] += 1
    return vals


def boxscore(game_id: str) -> dict:
    g = GAMES_BY_ID.get(game_id)
    if not g or g["gameStatus"] == 1:
        raise NotAvailable("cdn.nba.com : ressource pas encore disponible", status=403, source="cdn.nba.com")
    base = _game_json(g, False)
    r = rng("box", game_id)
    for key, total in (("awayTeam", g["sa"]), ("homeTeam", g["sh"])):
        side = base[key]
        roster = ROSTERS[side["teamId"]]
        players = []
        played = roster[:12]
        pts = _distribute(total, 12, r, [3 if i < 5 else 1 for i in range(12)])
        mins = _distribute(240 * 60 if g["gameStatus"] == 3 else int(240 * 60 * 0.7), 12, r, [3.2 if i < 5 else 1.4 for i in range(12)])
        team_stats = {k: 0 for k in ["fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "threePointersAttempted", "freeThrowsMade",
                                     "freeThrowsAttempted", "reboundsOffensive", "reboundsDefensive", "reboundsTotal", "assists", "steals",
                                     "blocks", "turnovers", "foulsPersonal", "points"]}
        for i, p in enumerate(roster):
            if i < 12:
                pt = pts[i]
                tpm = min(pt // 3, r.randint(0, 4))
                ftm = min(pt - 3 * tpm, r.randint(0, 6))
                twom = (pt - 3 * tpm - ftm) // 2
                ftm = pt - 3 * tpm - 2 * twom
                fgm = twom + tpm
                stats = {
                    "points": pt, "fieldGoalsMade": fgm, "fieldGoalsAttempted": fgm + r.randint(1, 9),
                    "threePointersMade": tpm, "threePointersAttempted": tpm + r.randint(0, 5),
                    "freeThrowsMade": ftm, "freeThrowsAttempted": ftm + r.randint(0, 2),
                    "reboundsOffensive": r.randint(0, 4), "reboundsDefensive": r.randint(0, 9), "assists": r.randint(0, 10),
                    "steals": r.randint(0, 3), "blocks": r.randint(0, 3), "turnovers": r.randint(0, 4), "foulsPersonal": r.randint(0, 5),
                    "plusMinusPoints": float(r.randint(-15, 15)), "minutes": f"PT{mins[i] // 60:02d}M{mins[i] % 60:02d}.00S",
                }
                stats["reboundsTotal"] = stats["reboundsOffensive"] + stats["reboundsDefensive"]
                for k in team_stats:
                    team_stats[k] += stats[k]
                players.append({"status": "ACTIVE", "order": i + 1, "personId": p["id"], "jerseyNum": p["num"], "position": p["pos"] if i < 5 else "",
                                "starter": "1" if i < 5 else "0", "oncourt": "1" if (g["gameStatus"] == 2 and i in (0, 1, 2, 5, 7)) else "0",
                                "played": "1", "statistics": stats, "name": p["name"], "nameI": f"{p['first'][0]}. {p['last']}",
                                "firstName": p["first"], "familyName": p["last"]})
            else:
                players.append({"status": "INACTIVE" if i == 14 else "ACTIVE", "notPlayingReason": "INACTIVE_INJURY" if i == 14 else "DNP_COACH",
                                "order": i + 1, "personId": p["id"], "jerseyNum": p["num"], "starter": "0", "oncourt": "0", "played": "0",
                                "statistics": {"points": 0, "minutes": ""}, "name": p["name"], "nameI": f"{p['first'][0]}. {p['last']}",
                                "firstName": p["first"], "familyName": p["last"]})
        fga, fgm = team_stats["fieldGoalsAttempted"], team_stats["fieldGoalsMade"]
        team_stats.update({
            "fieldGoalsPercentage": fgm / fga if fga else 0,
            "threePointersPercentage": team_stats["threePointersMade"] / max(1, team_stats["threePointersAttempted"]),
            "freeThrowsPercentage": team_stats["freeThrowsMade"] / max(1, team_stats["freeThrowsAttempted"]),
            "pointsInThePaint": r.randint(30, 60), "pointsFastBreak": r.randint(4, 24), "pointsSecondChance": r.randint(4, 20),
            "pointsFromTurnovers": r.randint(8, 25), "benchPoints": sum(pts[5:]), "biggestLead": r.randint(2, 22),
            "leadChanges": 7, "timesTied": 5, "turnoversTotal": team_stats["turnovers"] + 1,
        })
        side["players"] = players
        side["statistics"] = team_stats
    base.update({"arena": {"arenaName": f"{teams_meta.TEAMS_BY_TRI[g['home']]['city']} Arena", "arenaCity": teams_meta.TEAMS_BY_TRI[g["home"]]["city"], "arenaState": ""},
                 "attendance": 18211, "sellout": "1", "duration": 128 if g["gameStatus"] == 3 else 0,
                 "officials": [{"name": "Scott Foster"}, {"name": "Marc Davis"}, {"name": "Lauren Holtkamp"}]})
    return {"meta": {}, "game": base}


def playbyplay(game_id: str) -> dict:
    g = GAMES_BY_ID.get(game_id)
    if not g or g["gameStatus"] == 1:
        raise NotAvailable("cdn.nba.com : ressource pas encore disponible", status=403, source="cdn.nba.com")
    r = rng("pbp", game_id)
    away_id = teams_meta.TEAMS_BY_TRI[g["away"]]["id"]
    home_id = teams_meta.TEAMS_BY_TRI[g["home"]]["id"]
    targets = {"away": g["sa"], "home": g["sh"]}
    score = {"away": 0, "home": 0}
    actions = []
    n = 1
    periods = max(4, g["period"]) if g["gameStatus"] == 3 else g["period"]
    per_period = [_split_periods(targets["away"], periods, r), _split_periods(targets["home"], periods, r)]

    def add(period, clock_s, side, kind, sub, desc, **extra):
        nonlocal n
        tid = away_id if side == "away" else home_id if side == "home" else None
        tri = g["away"] if side == "away" else g["home"] if side == "home" else ""
        m, s_ = divmod(clock_s, 60)
        a = {"actionNumber": n, "clock": f"PT{int(m):02d}M{s_:05.2f}S", "period": period, "teamId": tid, "teamTricode": tri,
             "actionType": kind, "subType": sub, "description": desc, "scoreAway": str(score["away"]), "scoreHome": str(score["home"]),
             "isFieldGoal": 0, "personId": extra.pop("personId", 0)}
        a.update(extra)
        actions.append(a)
        n += 1

    for p in range(1, periods + 1):
        length = 720 if p <= 4 else 300
        add(p, length, None, "period", "start", f"Period Start")
        goal = {"away": per_period[0][p - 1], "home": per_period[1][p - 1]}
        got = {"away": 0, "home": 0}
        t = length
        while got["away"] < goal["away"] or got["home"] < goal["home"]:
            side = r.choice([s for s in ("away", "home") if got[s] < goal[s]])
            tid = away_id if side == "away" else home_id
            p_ = r.choice(ROSTERS[tid][:9])
            t = max(1, t - r.randint(6, 26))
            remaining = goal[side] - got[side]
            if remaining >= 3 and r.random() < 0.33:
                pts, kind = 3, "3pt"
            elif remaining >= 2:
                pts, kind = 2, "2pt"
            else:
                pts, kind = 1, "freethrow"
            if kind == "freethrow":
                got[side] += 1
                score[side] += 1
                add(p, t, side, "freethrow", "1 of 1", f"{p_['first'][0]}. {p_['last']} Free Throw 1 of 1", personId=p_["id"], playerNameI=f"{p_['first'][0]}. {p_['last']}")
                continue
            # un tir manqué avant le panier
            if r.random() < 0.8:
                ang = r.uniform(0.15, math.pi - 0.15)
                rad = r.uniform(245, 270) if kind == "3pt" else r.uniform(5, 210)
                add(p, t + 3, side, kind, "Jump Shot", f"MISS {p_['first'][0]}. {p_['last']} {int(rad / 10)}' Jump Shot", personId=p_["id"],
                    isFieldGoal=1, shotResult="Missed", xLegacy=rad * math.cos(ang), yLegacy=rad * math.sin(ang), shotDistance=rad / 10,
                    playerNameI=f"{p_['first'][0]}. {p_['last']}")
                add(p, t + 2, side, "rebound", "offensive", f"{p_['last']} REBOUND", personId=p_["id"])
            got[side] += pts
            score[side] += pts
            ang = r.uniform(0.15, math.pi - 0.15)
            rad = r.uniform(240, 265) if kind == "3pt" else r.uniform(2, 180)
            add(p, t, side, kind, "Jump Shot", f"{p_['first'][0]}. {p_['last']} {int(rad / 10)}' {'3PT ' if kind == '3pt' else ''}Jump Shot ({r.randint(2, 30)} PTS)",
                personId=p_["id"], isFieldGoal=1, shotResult="Made", xLegacy=rad * math.cos(ang), yLegacy=rad * math.sin(ang),
                shotDistance=rad / 10, playerNameI=f"{p_['first'][0]}. {p_['last']}")
            if r.random() < 0.1:
                add(p, t, side, "substitution", "out", "SUB: in for out", personId=p_["id"])
            if r.random() < 0.05:
                add(p, t, side, "timeout", "full", f"{g[side]} Timeout: Regular")
        if p < periods or g["gameStatus"] == 3:
            add(p, 0, None, "period", "end", "Period End")
    if g["gameStatus"] == 3:
        add(periods, 0, None, "game", "end", "Game End")
    return {"meta": {}, "game": {"gameId": game_id, "actions": actions}}


# ---------------------------------------------------------------- stats.nba.com


def rs(name, headers, rows):
    return {"name": name, "headers": headers, "rowSet": rows}


def wrap(*sets):
    return {"resource": "x", "parameters": {}, "resultSets": list(sets)}


CPI_HEADERS = ["PERSON_ID", "FIRST_NAME", "LAST_NAME", "DISPLAY_FIRST_LAST", "DISPLAY_LAST_COMMA_FIRST", "DISPLAY_FI_LAST", "PLAYER_SLUG",
               "BIRTHDATE", "SCHOOL", "COUNTRY", "LAST_AFFILIATION", "HEIGHT", "WEIGHT", "SEASON_EXP", "JERSEY", "POSITION", "ROSTERSTATUS",
               "GAMES_PLAYED_CURRENT_SEASON_FLAG", "TEAM_ID", "TEAM_NAME", "TEAM_ABBREVIATION", "TEAM_CODE", "TEAM_CITY", "PLAYERCODE",
               "FROM_YEAR", "TO_YEAR", "DLEAGUE_FLAG", "NBA_FLAG", "GAMES_PLAYED_FLAG", "DRAFT_YEAR", "DRAFT_ROUND", "DRAFT_NUMBER",
               "GREATEST_75_FLAG", "SUPPLEMENTAL_STATUS"]


def _player(pid: int) -> dict:
    p = PLAYERS.get(pid)
    if p:
        return p
    r = rng("hist", pid)
    t = r.choice(TEAMS)
    start = r.randint(1960, 2010)
    return {"id": pid, "first": r.choice(FIRST), "last": r.choice(LAST), "teamId": t["id"], "tri": t["tri"], "num": str(r.randint(0, 45)),
            "pos": r.choice(POS), "height": f"6-{r.randint(0, 11)}", "weight": str(r.randint(180, 260)), "age": 2026 - (start - 21),
            "birth": f"{start - 21}-05-12", "school": r.choice(COLLEGES), "country": "USA", "from": start, "exp": 0, "pts": 11.2,
            "reb": 4.1, "ast": 2.2, "retired": True, "to": start + r.randint(3, 15), "name": "Ancien Joueur"}


def common_player_info(pid: int) -> dict:
    p = _player(pid)
    active = not p.get("retired")
    t = teams_meta.team(p["teamId"])
    row = [pid, p["first"], p["last"], f"{p['first']} {p['last']}", f"{p['last']}, {p['first']}", f"{p['first'][0]}. {p['last']}",
           f"{p['first']}-{p['last']}".lower(), f"{p['birth']}T00:00:00", p["school"], p["country"], p["school"], p["height"], p["weight"],
           p["exp"], p["num"], {"G": "Guard", "F": "Forward", "C": "Center", "G-F": "Guard-Forward", "F-C": "Forward-Center"}[p["pos"]],
           "Active" if active else "Inactive", "Y", t["id"] if active else 0, t["name"] if active else "", t["tri"] if active else "",
           t["name"].lower(), t["city"] if active else "", "x", p["from"], p.get("to", 2026), "N", "Y", "Y",
           str(p["from"] - 1) if pid != 1700001 else "Undrafted", "1", "1" if pid in (STAR, STAR2) else "14", "N", 0]
    headline = [pid, row[3], "2025-26", p["pts"], p["ast"], p["reb"], 0.12]
    return wrap(rs("CommonPlayerInfo", CPI_HEADERS, [row]), rs("PlayerHeadlineStats", ["PLAYER_ID", "PLAYER_NAME", "TimeFrame", "PTS", "AST", "REB", "PIE"], [headline]),
                rs("AvailableSeasons", ["SEASON_ID"], []))


STAT_COLS = ["GP", "GS", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "PTS"]


def _season_line(r: random.Random, ppg: float, gp: int) -> list:
    pts = int(ppg * gp)
    fga = int(pts / 1.2)
    fgm = int(fga * r.uniform(0.43, 0.54))
    tpa = int(fga * r.uniform(0.15, 0.4))
    tpm = int(tpa * r.uniform(0.3, 0.4))
    fta = int(fga * 0.3)
    ftm = int(fta * 0.76)
    oreb, dreb = int(gp * r.uniform(0.5, 2)), int(gp * r.uniform(3, 7))
    return [gp, gp, gp * r.randint(28, 38), fgm, fga, round(fgm / max(1, fga), 3), tpm, tpa, round(tpm / max(1, tpa), 3), ftm, fta,
            round(ftm / max(1, fta), 3), oreb, dreb, oreb + dreb, int(gp * r.uniform(2, 8)), int(gp * r.uniform(0.6, 1.8)),
            int(gp * r.uniform(0.2, 1.2)), int(gp * r.uniform(1.5, 3.5)), int(gp * 1.8), pts]


def player_career(pid: int) -> dict:
    p = _player(pid)
    r = rng("career", pid)
    last = p.get("to", 2025) if p.get("retired") else 2025
    seasons, playoffs = [], []
    team_seq = [p["teamId"]]
    if pid == STAR:
        team_seq = [1610612739] * 7 + [1610612748] * 4 + [1610612739] * 4 + [1610612747] * 7 + [1610612747]
    cur_team = team_seq[0]
    for k, year in enumerate(range(p["from"], last + 1)):
        season = f"{year}-{str(year + 1)[-2:]}"
        if pid == STAR:
            cur_team = team_seq[min(k, len(team_seq) - 1)]
        elif r.random() < 0.15:
            cur_team = r.choice(TEAMS)["id"]
        t = teams_meta.team(cur_team)
        ppg = max(4, p["pts"] + r.uniform(-6, 6) + (6 if pid == STAR and k < 15 else 0))
        gp = r.randint(55, 82)
        age = year - int(p["birth"][:4])
        if pid != STAR and k == 2 and r.random() < 0.5:
            # saison partagée entre deux équipes
            other = r.choice(TEAMS)
            l1 = _season_line(r, ppg, gp // 2)
            l2 = _season_line(r, ppg, gp - gp // 2)
            tot = [a + b if isinstance(a, int) else round((a + b) / 2, 3) for a, b in zip(l1, l2)]
            seasons.append([pid, season, "00", cur_team, t["tri"], age] + l1)
            seasons.append([pid, season, "00", other["id"], other["tri"], age] + l2)
            seasons.append([pid, season, "00", 0, "TOT", age] + tot)
            cur_team = other["id"]
        else:
            seasons.append([pid, season, "00", cur_team, t["tri"], age] + _season_line(r, ppg, gp))
        if r.random() < 0.6:
            playoffs.append([pid, season, "00", cur_team, teams_meta.team(cur_team)["tri"], age] + _season_line(r, ppg + 1, r.randint(4, 22)))
    hdr = ["PLAYER_ID", "SEASON_ID", "LEAGUE_ID", "TEAM_ID", "TEAM_ABBREVIATION", "PLAYER_AGE"] + STAT_COLS
    def totals(rows):
        rows = [x for x in rows if x[4] != "TOT"]
        sums = [sum(x[6 + i] for x in rows) if isinstance(rows[0][6 + i], int) else 0 for i in range(len(STAT_COLS))] if rows else [0] * len(STAT_COLS)
        if rows:
            sums[5] = round(sums[3] / max(1, sums[4]), 3)
            sums[8] = round(sums[6] / max(1, sums[7]), 3)
            sums[11] = round(sums[9] / max(1, sums[10]), 3)
        return [[pid, "00", 0] + sums]
    hi_hdr = ["PLAYER_ID", "GAME_ID", "GAME_DATE", "VS_TEAM_ID", "VS_TEAM_CITY", "VS_TEAM_NAME", "VS_TEAM_ABBREVIATION", "STAT", "STAT_VALUE", "STAT_ORDER", "DATE_EST"]
    highs = []
    for order, (stat, val) in enumerate([("PTS", 61 if pid == STAR else r.randint(30, 52)), ("REB", r.randint(12, 20)), ("AST", r.randint(8, 19)),
                                         ("STL", r.randint(3, 7)), ("BLK", r.randint(2, 8)), ("FG3M", r.randint(4, 9))], 1):
        opp = r.choice(TEAMS)
        highs.append([pid, "0021300893", "Mar 03 2014", opp["id"], opp["city"], opp["name"], opp["tri"], stat, val, order, "2014-03-03T00:00:00"])
    allstar = [[pid, f"{2005 + k}-{str(2006 + k)[-2:]}", "00", 1610616833, "EST", 20 + k] + _season_line(r, 20, 1) for k in range(21 if pid == STAR else 0)]
    return wrap(
        rs("SeasonTotalsRegularSeason", hdr, seasons),
        rs("CareerTotalsRegularSeason", ["PLAYER_ID", "LEAGUE_ID", "TEAM_ID"] + STAT_COLS, totals(seasons)),
        rs("SeasonTotalsPostSeason", hdr, playoffs),
        rs("CareerTotalsPostSeason", ["PLAYER_ID", "LEAGUE_ID", "TEAM_ID"] + STAT_COLS, totals(playoffs) if playoffs else []),
        rs("SeasonTotalsAllStarSeason", hdr, allstar),
        rs("CareerHighs", hi_hdr, highs),
        rs("SeasonHighs", hi_hdr, highs[:3]),
    )


def player_awards(pid: int) -> dict:
    hdr = ["PERSON_ID", "FIRST_NAME", "LAST_NAME", "TEAM", "DESCRIPTION", "ALL_NBA_TEAM_NUMBER", "SEASON", "MONTH", "WEEK", "CONFERENCE", "TYPE", "SUBTYPE1", "SUBTYPE2", "SUBTYPE3"]
    rows = []
    def add(desc, season, number=None, team="Los Angeles Lakers"):
        rows.append([pid, "x", "y", team, desc, number, season, None, None, None, "Award", None, None, None])
    if pid == STAR:
        for s in ["2011-12", "2012-13", "2015-16", "2019-20"]:
            add("NBA Champion", s)
            add("NBA Finals Most Valuable Player", s)
        for s in ["2008-09", "2009-10", "2011-12", "2012-13"]:
            add("NBA Most Valuable Player", s)
        add("NBA Rookie of the Year", "2003-04", team="Cleveland Cavaliers")
        for k in range(21):
            add("NBA All-Star", f"{2004 + k}-{str(2005 + k)[-2:]}")
        for k in range(21):
            add("All-NBA", f"{2004 + k}-{str(2005 + k)[-2:]}", number=str(1 if k < 13 else 2 if k < 17 else 3))
        for k in range(6):
            add("All-Defensive Team", f"{2008 + k}-{str(2009 + k)[-2:]}", number="1" if k < 5 else "2")
        add("All-Rookie Team", "2003-04", number="1")
        for s in ["2005-06", "2007-08", "2017-18", "2022-23"]:
            add("NBA All-Star Most Valuable Player", s)
        add("NBA Cup Most Valuable Player", "2023-24")
        add("Olympic Gold Medal", "2008", team="USA")
        add("Olympic Gold Medal", "2012", team="USA")
        add("Olympic Gold Medal", "2024", team="USA")
        add("Olympic Bronze Medal", "2004", team="USA")
        for k in range(69):
            add("NBA Player of the Week", "2010-11")
        for k in range(40):
            add("NBA Player of the Month", "2010-11")
    elif pid in PLAYERS and PLAYERS[pid]["pts"] > 20:
        add("NBA All-Star", "2024-25")
        add("All-NBA", "2024-25", number="2")
        add("NBA Player of the Week", "2024-25")
    return wrap(rs("PlayerAwards", hdr, rows))


def player_gamelog(pid: int, season: str, season_type: str) -> dict:
    hdr = ["SEASON_ID", "Player_ID", "Game_ID", "GAME_DATE", "MATCHUP", "WL", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA",
           "FT_PCT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "PTS", "PLUS_MINUS", "VIDEO_AVAILABLE"]
    rows = []
    if season == "2026-27" and season_type == "Pre Season":
        p = _player(pid)
        r = rng("gl", pid)
        mine = [g for g in GAMES if g["gameStatus"] == 3 and g["gameLabel"] == "Preseason" and p.get("tri") in (g["away"], g["home"])]
        for g in reversed(mine):
            home = g["home"] == p["tri"]
            opp = g["away"] if home else g["home"]
            won = (g["sh"] > g["sa"]) == home
            d = datetime.fromisoformat(g["etDate"])
            pts = r.randint(4, 34)
            rows.append(["12026", pid, g["gameId"], d.strftime("%b %d, %Y"), f"{p['tri']} {'vs.' if home else '@'} {opp}", "W" if won else "L",
                         r.randint(14, 34), pts // 2, pts // 2 + 6, 0.48, 1, 4, 0.25, 2, 3, 0.66, 1, 4, 5, r.randint(0, 9), 1, 0, 2, 2, pts, r.randint(-12, 12), 1])
    return wrap(rs("PlayerGameLog", hdr, rows))


def team_roster(team_id: int, season: str) -> dict:
    hdr = ["TeamID", "SEASON", "LeagueID", "PLAYER", "NICKNAME", "PLAYER_SLUG", "NUM", "POSITION", "HEIGHT", "WEIGHT", "BIRTH_DATE", "AGE", "EXP", "SCHOOL",
           "PLAYER_ID", "HOW_ACQUIRED", "SUPPLEMENTAL_STATUS"]
    rows = []
    for p in ROSTERS.get(team_id, []):
        bd = datetime.fromisoformat(p["birth"]).strftime("%b %d, %Y").upper()
        how = rng("how", p["id"]).choice(["Signed on 07/14/26", "#7 Pick in 2024 Draft", "Traded from DAL on 02/06/25", "Re-signed on 07/01/26", "Claimed off waivers"])
        rows.append([team_id, season[:4], "00", p["name"], p["first"], "slug", p["num"], p["pos"], p["height"], p["weight"], bd, p["age"],
                     "R" if p["exp"] == 0 else str(p["exp"]), p["school"], p["id"], how, 0])
    coaches = [[team_id, season[:4], 1, "Joe", "Coach", "Joe Coach", 1, "Head Coach", None, 1],
               [team_id, season[:4], 2, "Ann", "Assist", "Ann Assist", 2, "Assistant Coach", None, 5],
               [team_id, season[:4], 3, "Bob", "Trainer", "Bob Trainer", 2, "Trainer", None, 9]]
    return wrap(rs("CommonTeamRoster", hdr, rows), rs("Coaches", ["TEAM_ID", "SEASON", "COACH_ID", "FIRST_NAME", "LAST_NAME", "COACH_NAME", "IS_ASSISTANT", "COACH_TYPE", "SORT_SEQUENCE", "SUB_SORT_SEQUENCE"], coaches))


def _champ_years(team_id: int) -> list[int]:
    real = {1610612738: [1957, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1968, 1969, 1974, 1976, 1981, 1984, 1986, 2008, 2024],
            1610612747: [1949, 1950, 1952, 1953, 1954, 1972, 1980, 1982, 1985, 1987, 1988, 2000, 2001, 2002, 2009, 2010, 2020],
            1610612752: [1970, 1973, 2026], 1610612759: [1999, 2003, 2005, 2007, 2014]}
    return real.get(team_id, [])


def team_details(team_id: int) -> dict:
    t = teams_meta.team(team_id)
    r = rng("details", team_id)
    bg = [team_id, t["tri"], t["name"], t["founded"], t["city"], f"{t['city']} Arena", str(r.randint(17500, 21000)), "Owner Name", "GM Name",
          "Coach Name", f"{t['city']} G League"]
    champs = [[y, r.choice(TEAMS)["fullName"]] for y in _champ_years(team_id)]
    retired = [[1718 + k, f"{r.choice(FIRST)} {r.choice(LAST)}", r.choice(["F", "G", "C"]), str(r.randint(0, 45)), f"{1960 + 5 * k}-{1970 + 5 * k}", 1980 + 5 * k] for k in range(r.randint(0, 9))]
    hof = [[2000 + k, f"{r.choice(FIRST)} {r.choice(LAST)}", r.choice(["F", "G", "C"]), None, "1990-2000", 2010 + k] for k in range(r.randint(0, 6))]
    return wrap(
        rs("TeamBackground", ["TEAM_ID", "ABBREVIATION", "NICKNAME", "YEARFOUNDED", "CITY", "ARENA", "ARENACAPACITY", "OWNER", "GENERALMANAGER", "HEADCOACH", "DLEAGUEAFFILIATION"], [bg]),
        rs("TeamHistory", ["TEAM_ID", "CITY", "NICKNAME", "YEARFOUNDED", "YEARACTIVETILL"], [[team_id, t["city"], t["name"], t["founded"], 2026]]),
        rs("TeamSocialSites", ["ACCOUNTTYPE", "WEBSITE_LINK"], [["Facebook", "https://facebook.com/x"], ["Instagram", "https://instagram.com/x"], ["Twitter", "https://twitter.com/x"]]),
        rs("TeamAwardsChampionships", ["YEARAWARDED", "OPPOSITETEAM"], champs),
        rs("TeamAwardsConf", ["YEARAWARDED", "OPPOSITETEAM"], [[y, None] for y in _champ_years(team_id)[:5]]),
        rs("TeamAwardsDiv", ["YEARAWARDED", "OPPOSITETEAM"], [[1990 + k, None] for k in range(r.randint(0, 8))]),
        rs("TeamHof", ["PLAYERID", "PLAYER", "POSITION", "JERSEY", "SEASONSWITHTEAM", "YEAR"], hof),
        rs("TeamRetired", ["PLAYERID", "PLAYER", "POSITION", "JERSEY", "SEASONSWITHTEAM", "YEAR"], retired),
        rs("TeamAwardsCommCup", ["YEARAWARDED", "OPPOSITETEAM"], [[2023, "Indiana Pacers"]] if team_id == 1610612747 else []),
    )


def team_year_by_year(team_id: int) -> dict:
    t = teams_meta.team(team_id)
    r = rng("ybys", team_id)
    champs = set(_champ_years(team_id))
    rows = []
    for year in range(t["founded"], 2026):
        gp = 82 if year >= 1967 else 72
        w = r.randint(int(gp * 0.25), int(gp * 0.75))
        end = year + 1
        champion = end in champs
        if champion:
            w = max(w, int(gp * 0.68))
        finals = "LEAGUE CHAMPION" if champion else ("FINALS APPEARANCE" if r.random() < 0.05 else "N/A")
        rows.append([team_id, t["city"], t["name"], f"{year}-{str(end)[-2:]}", gp, w, gp - w, round(w / gp, 3), r.randint(1, 15), r.randint(1, 5),
                     16 if champion else r.randint(0, 8), r.randint(0, 6), 15, 5, finals] + [0] * 18 + [r.randint(1, 30)])
    hdr = ["TEAM_ID", "TEAM_CITY", "TEAM_NAME", "YEAR", "GP", "WINS", "LOSSES", "WIN_PCT", "CONF_RANK", "DIV_RANK", "PO_WINS", "PO_LOSSES", "CONF_COUNT",
           "DIV_COUNT", "NBA_FINALS_APPEARANCE", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT", "OREB", "DREB", "REB", "AST",
           "PF", "STL", "TOV", "BLK", "PTS", "PTS_RANK"]
    return wrap(rs("TeamStats", hdr, rows))


def franchise_history() -> dict:
    hdr = ["LEAGUE_ID", "TEAM_ID", "TEAM_CITY", "TEAM_NAME", "START_YEAR", "END_YEAR", "YEARS", "GAMES", "WINS", "LOSSES", "WIN_PCT", "PO_APPEARANCES",
           "DIV_TITLES", "CONF_TITLES", "LEAGUE_TITLES"]
    rows = []
    for t in TEAMS:
        years = 2026 - t["founded"]
        games = years * 80
        w = int(games * rng("fh", t["id"]).uniform(0.42, 0.6))
        titles = len(_champ_years(t["id"]))
        rows.append(["00", t["id"], t["city"], t["name"], str(t["founded"]), "2025", years, games, w, games - w, round(w / games, 3), years // 2, 10, titles + 2, titles])
        if t["tri"] in ("OKC", "LAL"):
            rows.append(["00", t["id"], "Seattle" if t["tri"] == "OKC" else "Minneapolis", "SuperSonics" if t["tri"] == "OKC" else "Lakers",
                         str(t["founded"]), "2008" if t["tri"] == "OKC" else "1960", 41, 3000, 1700, 1300, 0.56, 22, 6, 3, 1])
    return wrap(rs("FranchiseHistory", hdr, rows), rs("DefunctTeams", hdr, []))


def standings(season: str) -> dict:
    hdr = ["LeagueID", "SeasonID", "TeamID", "TeamCity", "TeamName", "TeamSlug", "Conference", "ConferenceRecord", "PlayoffRank", "ClinchIndicator",
           "Division", "DivisionRecord", "DivisionRank", "WINS", "LOSSES", "WinPCT", "LeagueRank", "Record", "HOME", "ROAD", "L10", "Last10Home",
           "Last10Road", "OT", "ThreePTSOrLess", "TenPTSOrMore", "LongHomeStreak", "strLongHomeStreak", "LongRoadStreak", "strLongRoadStreak",
           "LongWinStreak", "LongLossStreak", "CurrentHomeStreak", "strCurrentHomeStreak", "CurrentRoadStreak", "strCurrentRoadStreak",
           "CurrentStreak", "strCurrentStreak", "ConferenceGamesBack", "DivisionGamesBack", "PointsPG", "OppPointsPG", "DiffPointsPG"]
    rows = []
    zero = season == "2026-27"
    for conf in ("East", "West"):
        conf_teams = [t for t in TEAMS if t["conf"] == conf]
        r = rng("stand", season, conf)
        wins = sorted([0 if zero else r.randint(18, 64) for _ in conf_teams], reverse=True)
        r.shuffle(conf_teams)
        for rank, (t, w) in enumerate(zip(conf_teams, wins), 1):
            l = 0 if zero else 82 - w
            gb = 0 if zero else (wins[0] - w)
            ppg = 0 if zero else round(r.uniform(105, 121), 1)
            opp = 0 if zero else round(ppg - (w - 41) / 4, 1)
            clinch = "" if zero else (" - e" if rank == 1 and conf == "East" else " - w" if rank == 1 else " - x" if rank <= 6 else " - pi" if rank <= 10 else " - o")
            rows.append(["00", "22025", t["id"], t["city"], t["name"], t["name"].lower(), conf, "30-22", rank, clinch, t["div"], "10-6", 1, w, l,
                         0 if zero else round(w / 82, 3), rank, f"{w}-{l}", "0-0" if zero else f"{w // 2 + 3}-{41 - w // 2 - 3}", "0-0" if zero else f"{w - w // 2 - 3}-{l - (41 - w // 2 - 3)}",
                         "0-0" if zero else f"{min(10, w // 7)}-{10 - min(10, w // 7)}", "", "", "", "", "", 0, "", 0, "", 0, 0, 0, "", 0, "", 0,
                         "W 0" if zero else r.choice(["W 3", "L 2", "W 1", "L 1"]), gb / 2 if gb else 0, 0, ppg, opp, round(ppg - opp, 1)])
    return wrap(rs("Standings", hdr, rows))


def league_leaders(season: str) -> dict:
    hdr = ["PLAYER_ID", "RANK", "PLAYER", "TEAM_ID", "TEAM", "GP", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FG3A", "FG3_PCT", "FTM", "FTA", "FT_PCT",
           "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PTS", "EFF"]
    if season == "2026-27":
        return {"resultSet": {"name": "LeagueLeaders", "headers": hdr, "rowSet": []}}
    r = rng("leaders", season)
    rows = []
    pool = [p for roster in ROSTERS.values() for p in roster[:8]]
    for p in pool:
        rows.append([p["id"], 0, p["name"], p["teamId"], p["tri"], r.randint(58, 80), round(r.uniform(24, 37), 1), 8, 17, round(r.uniform(0.41, 0.65), 3),
                     round(r.uniform(0.3, 4.5), 1), 7, 0.36, 4, 5, 0.8, 1.2, 5.5, round(r.uniform(2, 13.5), 1), round(r.uniform(1, 10.5), 1),
                     round(r.uniform(0.3, 2.1), 1), round(r.uniform(0.1, 3.4), 1), 2.1, round(r.uniform(9, 33.5), 1), round(r.uniform(10, 33), 1)])
    rows.sort(key=lambda x: -x[23])
    for i, row in enumerate(rows, 1):
        row[1] = i
    return {"resultSet": {"name": "LeagueLeaders", "headers": hdr, "rowSet": rows}}


def player_index() -> dict:
    hdr = ["PERSON_ID", "PLAYER_LAST_NAME", "PLAYER_FIRST_NAME", "PLAYER_SLUG", "TEAM_ID", "TEAM_SLUG", "IS_DEFUNCT", "TEAM_CITY", "TEAM_NAME",
           "TEAM_ABBREVIATION", "JERSEY_NUMBER", "POSITION", "HEIGHT", "WEIGHT", "COLLEGE", "COUNTRY", "DRAFT_YEAR", "DRAFT_ROUND", "DRAFT_NUMBER",
           "ROSTER_STATUS", "PTS", "REB", "AST", "STATS_TIMEFRAME", "FROM_YEAR", "TO_YEAR", "SUPPLEMENTAL_STATUS"]
    rows = []
    for p in PLAYERS.values():
        t = teams_meta.team(p["teamId"])
        rows.append([p["id"], p["last"], p["first"], "slug", p["teamId"], "x", 0, t["city"], t["name"], t["tri"], p["num"], p["pos"], p["height"], p["weight"],
                     p["school"], p["country"], p["from"] - 1, 1, 10, 1, p["pts"], p["reb"], p["ast"], "Season", str(p["from"]), "2026", 0])
    r = rng("histidx")
    for k in range(4500):
        pid = 100000 + k
        start = r.randint(1947, 2022)
        rows.append([pid, r.choice(LAST), r.choice(FIRST), "slug", r.choice(TEAMS)["id"], "x", 0, "", "", "", "", r.choice(POS), "6-6", "210",
                     r.choice(COLLEGES), r.choice(COUNTRIES), start - 1, 2, 40, None, round(r.uniform(1, 25), 1), 3.2, 1.4, "Career", str(start), str(start + r.randint(1, 15)), 0])
    return wrap(rs("PlayerIndex", hdr, rows))


# ---------------------------------------------------------------- Wikipédia

def wiki(url: str, params: dict) -> dict:
    if "wikidata" in url:
        if params.get("list") == "search":
            pid = params["srsearch"].split("=")[-1]
            return {"query": {"search": [{"title": f"Q{pid}"}]}}
        qid = params["ids"]
        pid = int(qid[1:])
        p = _player(pid)
        return {"entities": {qid: {"sitelinks": {"frwiki": {"title": f"{p['first']} {p['last']}"}}}}}
    if params.get("meta") == "siteinfo":
        return {"query": {"general": {}}}
    title = params.get("titles", "")
    text = (f"Texte de démonstration pour « {title} ». En mode normal, Parquet affiche ici l'introduction "
            "de l'article Wikipédia correspondant, retrouvé automatiquement.\n"
            "Le résumé reprend les faits marquants de la carrière ou de l'histoire de la franchise, avec un lien "
            "vers l'article complet et la mention de la licence CC BY-SA.")
    return {"query": {"pages": [{"title": title, "extract": text}]}}


# ---------------------------------------------------------------- routage


def _handle_base(url: str, params: dict | None):
    params = params or {}
    if "cdn.nba.com" in url:
        if url.endswith("todaysScoreboard_00.json"):
            return todays_scoreboard()
        if url.endswith("scheduleLeagueV2.json"):
            return schedule()
        if "/boxscore/" in url:
            return boxscore(url.split("boxscore_")[1][:10])
        if "/playbyplay/" in url:
            return playbyplay(url.split("playbyplay_")[1][:10])
        raise NotAvailable("introuvable", status=404, source="cdn.nba.com")
    if "stats.nba.com" in url:
        ep = url.rsplit("/", 1)[1]
        if ep == "commonplayerinfo":
            return common_player_info(int(params["PlayerID"]))
        if ep == "playercareerstats":
            return player_career(int(params["PlayerID"]))
        if ep == "playerawards":
            return player_awards(int(params["PlayerID"]))
        if ep == "playergamelog":
            return player_gamelog(int(params["PlayerID"]), params["Season"], params["SeasonType"])
        if ep == "commonteamroster":
            return team_roster(int(params["TeamID"]), params["Season"])
        if ep == "teamdetails":
            return team_details(int(params["TeamID"]))
        if ep == "teamyearbyyearstats":
            return team_year_by_year(int(params["TeamID"]))
        if ep == "franchisehistory":
            return franchise_history()
        if ep == "leaguestandingsv3":
            return standings(params["Season"])
        if ep == "leagueleaders":
            return league_leaders(params["Season"])
        if ep == "playerindex":
            return player_index()
        if ep == "scoreboardv3":
            return scoreboard_v3(params["GameDate"])
        if ep == "scheduleleaguev2":
            return schedule()
        if ep == "boxscoretraditionalv3":
            live = boxscore(params["GameID"])["game"]
            def team(t):
                players = []
                for p in t["players"]:
                    st = dict(p["statistics"])
                    secs = 0
                    if st.get("minutes"):
                        m = st["minutes"][2:].split("M")
                        secs = int(m[0]) * 60 + int(float(m[1].rstrip("S")))
                    st["minutes"] = f"{secs // 60}:{secs % 60:02d}" if secs else ""
                    players.append({"personId": p["personId"], "firstName": p["firstName"], "familyName": p["familyName"],
                                    "nameI": p["nameI"], "position": p.get("position", "") if p["starter"] == "1" else "",
                                    "comment": "" if p["played"] == "1" else "DNP - Coach's Decision", "jerseyNum": p["jerseyNum"],
                                    "statistics": st})
                return {"teamId": t["teamId"], "teamCity": t["teamCity"], "teamName": t["teamName"], "teamTricode": t["teamTricode"],
                        "players": players, "statistics": t["statistics"]}
            return {"meta": {}, "boxScoreTraditional": {"gameId": params["GameID"], "homeTeam": team(live["homeTeam"]), "awayTeam": team(live["awayTeam"])}}
        if ep == "playbyplayv3":
            acts = playbyplay(params["GameID"])["game"]["actions"]
            out = []
            prev = None
            for a in acts:
                score = (a["scoreAway"], a["scoreHome"])
                changed = score != prev
                prev = score
                out.append({**a, "actionType": ("Made Shot" if a.get("shotResult") == "Made" else "Missed Shot") if a.get("isFieldGoal") else a["actionType"].capitalize(),
                            "scoreAway": a["scoreAway"] if changed else "", "scoreHome": a["scoreHome"] if changed else "",
                            "shotValue": 3 if a["actionType"] == "3pt" else 2 if a.get("isFieldGoal") else 0})
            return {"meta": {}, "game": {"gameId": params["GameID"], "actions": out}}
        raise SourceError(f"endpoint non simulé : {ep}", status=400, source="stats.nba.com")
    if "wiki" in url:
        return wiki(url, params)
    raise SourceError("hôte inconnu", source=url)


# ---------------------------------------------------------------- ajouts : leaders (dash), playoffs

def league_dash(season: str) -> dict:
    ll = league_leaders(season)["resultSet"]
    idx = {hname: i for i, hname in enumerate(ll["headers"])}
    hdr = ["PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "MIN", "FGM", "FGA", "FG_PCT", "FG3M", "FTM", "FTA", "REB", "AST", "STL", "BLK", "TOV", "PTS"]
    rows = [[r[idx["PLAYER_ID"]], r[idx["PLAYER"]], r[idx["TEAM_ID"]], r[idx["TEAM"]], r[idx["GP"]], r[idx["MIN"]], r[idx["FGM"]], r[idx["FGA"]], r[idx["FG_PCT"]],
             r[idx["FG3M"]], r[idx["FTM"]], r[idx["FTA"]], r[idx["REB"]], r[idx["AST"]], r[idx["STL"]], r[idx["BLK"]], r[idx["TOV"]], r[idx["PTS"]]] for r in ll["rowSet"]]
    return wrap(rs("LeagueDashPlayerStats", hdr, rows))


def _po_series(season: str):
    """Arbre des playoffs fictif, cohérent avec le classement fictif de la même saison."""
    r = rng("po", season)
    y = season[2:4]
    rows = net.result_sets(standings(season))["Standings"]
    seeded = {conf: [teams_meta.team(x["TeamID"]) for x in sorted((x for x in rows if x["Conference"] == conf), key=lambda x: x["PlayoffRank"])][:8] for conf in ("East", "West")}
    series, gf = [], []
    day = [date(int(season[:4]) + 1, 4, 18)]

    def play(sid, a, b):
        wa = wb = n = 0
        while wa < 4 and wb < 4:
            n += 1
            home, vis = (a, b) if n in (1, 2, 5, 7) else (b, a)
            gid = f"004{y}00{sid[-2:]}{n}"
            series.append({"GAME_ID": gid, "HOME_TEAM_ID": home["id"], "VISITOR_TEAM_ID": vis["id"], "SERIES_ID": f"004{y}0{sid}", "GAME_NUM": n})
            a_wins = r.random() < 0.62
            win_pts, lose_pts = r.randint(104, 128), r.randint(90, 103)
            pa, pb = (win_pts, lose_pts) if a_wins else (lose_pts, win_pts)
            if a_wins:
                wa += 1
            else:
                wb += 1
            when = (day[0] + timedelta(days=2 * n)).isoformat()
            gf.append({"GAME_ID": gid, "TEAM_ID": a["id"], "PTS": pa, "WL": "W" if a_wins else "L", "GAME_DATE": when})
            gf.append({"GAME_ID": gid, "TEAM_ID": b["id"], "PTS": pb, "WL": "L" if a_wins else "W", "GAME_DATE": when})
        return a if wa == 4 else b

    e, w = seeded["East"], seeded["West"]
    e1 = [play("0010", e[0], e[7]), play("0013", e[3], e[4]), play("0012", e[2], e[5]), play("0011", e[1], e[6])]
    w1 = [play("0014", w[0], w[7]), play("0017", w[3], w[4]), play("0016", w[2], w[5]), play("0015", w[1], w[6])]
    day[0] += timedelta(days=16)
    e2 = [play("0020", e1[0], e1[1]), play("0021", e1[2], e1[3])]
    w2 = [play("0022", w1[0], w1[1]), play("0023", w1[2], w1[3])]
    day[0] += timedelta(days=16)
    ef, wf = play("0030", e2[0], e2[1]), play("0031", w2[0], w2[1])
    day[0] += timedelta(days=16)
    play("0040", ef, wf)
    hdr_s = ["GAME_ID", "HOME_TEAM_ID", "VISITOR_TEAM_ID", "SERIES_ID", "GAME_NUM"]
    hdr_g = ["GAME_ID", "TEAM_ID", "PTS", "WL", "GAME_DATE"]
    return (
        wrap(rs("PlayoffSeries", hdr_s, [[x[k] for k in hdr_s] for x in series])),
        wrap(rs("LeagueGameFinderResults", hdr_g, [[x[k] for k in hdr_g] for x in gf])),
    )


def handle(url: str, params: dict | None):
    """Répond à la place de NBA.com et de Wikipédia."""
    params = params or {}
    if "stats.nba.com" in url:
        ep = url.rsplit("/", 1)[1]
        if ep == "leaguedashplayerstats":
            return league_dash(params["Season"])
        if ep in ("commonplayoffseries", "leaguegamefinder"):
            if params["Season"] >= "2026-27":
                return wrap(rs("PlayoffSeries", [], []), rs("LeagueGameFinderResults", [], []))
            s, g = _po_series(params["Season"])
            return s if ep == "commonplayoffseries" else g
    return _handle_base(url, params)


def _demo_get(url, params, headers, timeout, source):
    return handle(url, params)


def install() -> None:
    """Remplace l'accès réseau de Parquet par les données de démonstration."""
    net._get = _demo_get
    net.DEMO = True
