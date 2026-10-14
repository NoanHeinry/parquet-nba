"""Données fixes sur les 30 franchises : identifiants NBA, conférences, couleurs, article Wikipédia.

Les identifiants sont ceux de NBA.com (les mêmes que dans toutes les données stats et live).
Les couleurs servent uniquement à habiller l'interface (bandeaux, liserés, graphiques).
"""

from __future__ import annotations

# id, tricode, ville, nom, conférence, division, couleurs [principale, secondaire, tertiaire],
# titre de l'article sur Wikipédia en français, année de création, État / province
_RAW = [
    (1610612737, "ATL", "Atlanta", "Hawks", "East", "Southeast", ["#E03A3E", "#C1D32F", "#26282A"], "Hawks d'Atlanta", 1949, "Georgia"),
    (1610612738, "BOS", "Boston", "Celtics", "East", "Atlantic", ["#007A33", "#BA9653", "#963821"], "Celtics de Boston", 1946, "Massachusetts"),
    (1610612751, "BKN", "Brooklyn", "Nets", "East", "Atlantic", ["#000000", "#FFFFFF", "#707271"], "Nets de Brooklyn", 1976, "New York"),
    (1610612766, "CHA", "Charlotte", "Hornets", "East", "Southeast", ["#1D1160", "#00788C", "#A1A1A4"], "Hornets de Charlotte", 1988, "North Carolina"),
    (1610612741, "CHI", "Chicago", "Bulls", "East", "Central", ["#CE1141", "#000000", "#FFFFFF"], "Bulls de Chicago", 1966, "Illinois"),
    (1610612739, "CLE", "Cleveland", "Cavaliers", "East", "Central", ["#860038", "#FDBB30", "#041E42"], "Cavaliers de Cleveland", 1970, "Ohio"),
    (1610612742, "DAL", "Dallas", "Mavericks", "West", "Southwest", ["#00538C", "#B8C4CA", "#002B5E"], "Mavericks de Dallas", 1980, "Texas"),
    (1610612743, "DEN", "Denver", "Nuggets", "West", "Northwest", ["#0E2240", "#FEC524", "#8B2131"], "Nuggets de Denver", 1976, "Colorado"),
    (1610612765, "DET", "Detroit", "Pistons", "East", "Central", ["#C8102E", "#1D42BA", "#BEC0C2"], "Pistons de Détroit", 1948, "Michigan"),
    (1610612744, "GSW", "Golden State", "Warriors", "West", "Pacific", ["#1D428A", "#FFC72C", "#26282A"], "Warriors de Golden State", 1946, "California"),
    (1610612745, "HOU", "Houston", "Rockets", "West", "Southwest", ["#CE1141", "#C4CED4", "#000000"], "Rockets de Houston", 1967, "Texas"),
    (1610612754, "IND", "Indiana", "Pacers", "East", "Central", ["#002D62", "#FDBB30", "#BEC0C2"], "Pacers de l'Indiana", 1976, "Indiana"),
    (1610612746, "LAC", "Los Angeles", "Clippers", "West", "Pacific", ["#1D428A", "#C8102E", "#BEC0C2"], "Clippers de Los Angeles", 1970, "California"),
    (1610612747, "LAL", "Los Angeles", "Lakers", "West", "Pacific", ["#552583", "#FDB927", "#000000"], "Lakers de Los Angeles", 1948, "California"),
    (1610612763, "MEM", "Memphis", "Grizzlies", "West", "Southwest", ["#5D76A9", "#12173F", "#F5B112"], "Grizzlies de Memphis", 1995, "Tennessee"),
    (1610612748, "MIA", "Miami", "Heat", "East", "Southeast", ["#98002E", "#F9A01B", "#000000"], "Heat de Miami", 1988, "Florida"),
    (1610612749, "MIL", "Milwaukee", "Bucks", "East", "Central", ["#00471B", "#EEE1C6", "#0077C0"], "Bucks de Milwaukee", 1968, "Wisconsin"),
    (1610612750, "MIN", "Minnesota", "Timberwolves", "West", "Northwest", ["#0C2340", "#236192", "#78BE20"], "Timberwolves du Minnesota", 1989, "Minnesota"),
    (1610612740, "NOP", "New Orleans", "Pelicans", "West", "Southwest", ["#0C2340", "#C8102E", "#85714D"], "Pelicans de La Nouvelle-Orléans", 2002, "Louisiana"),
    (1610612752, "NYK", "New York", "Knicks", "East", "Atlantic", ["#006BB6", "#F58426", "#BEC0C2"], "Knicks de New York", 1946, "New York"),
    (1610612760, "OKC", "Oklahoma City", "Thunder", "West", "Northwest", ["#007AC1", "#EF3B24", "#002D62"], "Thunder d'Oklahoma City", 1967, "Oklahoma"),
    (1610612753, "ORL", "Orlando", "Magic", "East", "Southeast", ["#0077C0", "#C4CED4", "#000000"], "Magic d'Orlando", 1989, "Florida"),
    (1610612755, "PHI", "Philadelphia", "76ers", "East", "Atlantic", ["#006BB6", "#ED174C", "#002B5C"], "76ers de Philadelphie", 1949, "Pennsylvania"),
    (1610612756, "PHX", "Phoenix", "Suns", "West", "Pacific", ["#1D1160", "#E56020", "#F9AD1B"], "Suns de Phoenix", 1968, "Arizona"),
    (1610612757, "POR", "Portland", "Trail Blazers", "West", "Northwest", ["#E03A3E", "#000000", "#FFFFFF"], "Trail Blazers de Portland", 1970, "Oregon"),
    (1610612758, "SAC", "Sacramento", "Kings", "West", "Pacific", ["#5A2D81", "#63727A", "#000000"], "Kings de Sacramento", 1948, "California"),
    (1610612759, "SAS", "San Antonio", "Spurs", "West", "Southwest", ["#C4CED4", "#000000", "#8A8D8F"], "Spurs de San Antonio", 1976, "Texas"),
    (1610612761, "TOR", "Toronto", "Raptors", "East", "Atlantic", ["#CE1141", "#000000", "#A1A1A4"], "Raptors de Toronto", 1995, "Ontario"),
    (1610612762, "UTA", "Utah", "Jazz", "West", "Northwest", ["#4E2A84", "#000000", "#F9A01B"], "Jazz de l'Utah", 1974, "Utah"),
    (1610612764, "WAS", "Washington", "Wizards", "East", "Southeast", ["#002B5C", "#E31837", "#C4CED4"], "Wizards de Washington", 1961, "District of Columbia"),
]

CONFERENCES_FR = {"East": "Est", "West": "Ouest"}
DIVISIONS_FR = {
    "Atlantic": "Atlantique",
    "Central": "Centrale",
    "Southeast": "Sud-Est",
    "Northwest": "Nord-Ouest",
    "Pacific": "Pacifique",
    "Southwest": "Sud-Ouest",
}

TEAMS: list[dict] = []
for (tid, tri, city, name, conf, div, colors, wiki, founded, state) in _RAW:
    TEAMS.append(
        {
            "id": tid,
            "tri": tri,
            "city": city,
            "name": name,
            "fullName": f"{city} {name}" if tri != "LAC" else "LA Clippers",
            "conf": conf,
            "div": div,
            "confFr": CONFERENCES_FR[conf],
            "divFr": DIVISIONS_FR[div],
            "colors": colors,
            "wiki": wiki,
            "founded": founded,
            "state": state,
        }
    )

TEAMS.sort(key=lambda t: (t["city"], t["name"]))
TEAMS_BY_ID: dict[int, dict] = {t["id"]: t for t in TEAMS}
TEAMS_BY_TRI: dict[str, dict] = {t["tri"]: t for t in TEAMS}


def team(team_id) -> dict | None:
    try:
        return TEAMS_BY_ID.get(int(team_id))
    except (TypeError, ValueError):
        return None
