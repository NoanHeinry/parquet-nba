"""Palmarès de la NBA : champions et grands trophées individuels, saison par saison.

La NBA ne publie aucune liste des lauréats interrogeable : ces données historiques sont donc
gardées ici, telles que publiées par NBA.com (pages « year-by-year list » de chaque trophée),
ESPN (trophées 2026) et la liste des finales. Elles se complètent une fois par an, après les
trophées de fin de saison (en général en mai) et les finales (en juin).

Format des lignes : « saison | joueur | équipe » ; pour les finales, « année | champion |
finaliste | résultat de la série ».
"""

from __future__ import annotations

import re
import unicodedata

MVP = """
2025-26|Shai Gilgeous-Alexander|Oklahoma City Thunder
2024-25|Shai Gilgeous-Alexander|Oklahoma City Thunder
2023-24|Nikola Jokic|Denver Nuggets
2022-23|Joel Embiid|Philadelphia 76ers
2021-22|Nikola Jokic|Denver Nuggets
2020-21|Nikola Jokic|Denver Nuggets
2019-20|Giannis Antetokounmpo|Milwaukee Bucks
2018-19|Giannis Antetokounmpo|Milwaukee Bucks
2017-18|James Harden|Houston Rockets
2016-17|Russell Westbrook|Oklahoma City Thunder
2015-16|Stephen Curry|Golden State Warriors
2014-15|Stephen Curry|Golden State Warriors
2013-14|Kevin Durant|Oklahoma City Thunder
2012-13|LeBron James|Miami Heat
2011-12|LeBron James|Miami Heat
2010-11|Derrick Rose|Chicago Bulls
2009-10|LeBron James|Cleveland Cavaliers
2008-09|LeBron James|Cleveland Cavaliers
2007-08|Kobe Bryant|Los Angeles Lakers
2006-07|Dirk Nowitzki|Dallas Mavericks
2005-06|Steve Nash|Phoenix Suns
2004-05|Steve Nash|Phoenix Suns
2003-04|Kevin Garnett|Minnesota Timberwolves
2002-03|Tim Duncan|San Antonio Spurs
2001-02|Tim Duncan|San Antonio Spurs
2000-01|Allen Iverson|Philadelphia 76ers
1999-00|Shaquille O'Neal|Los Angeles Lakers
1998-99|Karl Malone|Utah Jazz
1997-98|Michael Jordan|Chicago Bulls
1996-97|Karl Malone|Utah Jazz
1995-96|Michael Jordan|Chicago Bulls
1994-95|David Robinson|San Antonio Spurs
1993-94|Hakeem Olajuwon|Houston Rockets
1992-93|Charles Barkley|Phoenix Suns
1991-92|Michael Jordan|Chicago Bulls
1990-91|Michael Jordan|Chicago Bulls
1989-90|Magic Johnson|Los Angeles Lakers
1988-89|Magic Johnson|Los Angeles Lakers
1987-88|Michael Jordan|Chicago Bulls
1986-87|Magic Johnson|Los Angeles Lakers
1985-86|Larry Bird|Boston Celtics
1984-85|Larry Bird|Boston Celtics
1983-84|Larry Bird|Boston Celtics
1982-83|Moses Malone|Philadelphia 76ers
1981-82|Moses Malone|Houston Rockets
1980-81|Julius Erving|Philadelphia 76ers
1979-80|Kareem Abdul-Jabbar|Los Angeles Lakers
1978-79|Moses Malone|Houston Rockets
1977-78|Bill Walton|Portland Trail Blazers
1976-77|Kareem Abdul-Jabbar|Los Angeles Lakers
1975-76|Kareem Abdul-Jabbar|Los Angeles Lakers
1974-75|Bob McAdoo|Buffalo Braves
1973-74|Kareem Abdul-Jabbar|Milwaukee Bucks
1972-73|Dave Cowens|Boston Celtics
1971-72|Kareem Abdul-Jabbar|Milwaukee Bucks
1970-71|Kareem Abdul-Jabbar|Milwaukee Bucks
1969-70|Willis Reed|New York Knicks
1968-69|Wes Unseld|Baltimore Bullets
1967-68|Wilt Chamberlain|Philadelphia 76ers
1966-67|Wilt Chamberlain|Philadelphia 76ers
1965-66|Wilt Chamberlain|Philadelphia 76ers
1964-65|Bill Russell|Boston Celtics
1963-64|Oscar Robertson|Cincinnati Royals
1962-63|Bill Russell|Boston Celtics
1961-62|Bill Russell|Boston Celtics
1960-61|Bill Russell|Boston Celtics
1959-60|Wilt Chamberlain|Philadelphia Warriors
1958-59|Bob Pettit|St. Louis Hawks
1957-58|Bill Russell|Boston Celtics
1956-57|Bob Cousy|Boston Celtics
1955-56|Bob Pettit|St. Louis Hawks
"""

FINALS_MVP = """
2025-26|Jalen Brunson|New York Knicks
2024-25|Shai Gilgeous-Alexander|Oklahoma City Thunder
2023-24|Jaylen Brown|Boston Celtics
2022-23|Nikola Jokic|Denver Nuggets
2021-22|Stephen Curry|Golden State Warriors
2020-21|Giannis Antetokounmpo|Milwaukee Bucks
2019-20|LeBron James|Los Angeles Lakers
2018-19|Kawhi Leonard|Toronto Raptors
2017-18|Kevin Durant|Golden State Warriors
2016-17|Kevin Durant|Golden State Warriors
2015-16|LeBron James|Cleveland Cavaliers
2014-15|Andre Iguodala|Golden State Warriors
2013-14|Kawhi Leonard|San Antonio Spurs
2012-13|LeBron James|Miami Heat
2011-12|LeBron James|Miami Heat
2010-11|Dirk Nowitzki|Dallas Mavericks
2009-10|Kobe Bryant|Los Angeles Lakers
2008-09|Kobe Bryant|Los Angeles Lakers
2007-08|Paul Pierce|Boston Celtics
2006-07|Tony Parker|San Antonio Spurs
2005-06|Dwyane Wade|Miami Heat
2004-05|Tim Duncan|San Antonio Spurs
2003-04|Chauncey Billups|Detroit Pistons
2002-03|Tim Duncan|San Antonio Spurs
2001-02|Shaquille O'Neal|Los Angeles Lakers
2000-01|Shaquille O'Neal|Los Angeles Lakers
1999-00|Shaquille O'Neal|Los Angeles Lakers
1998-99|Tim Duncan|San Antonio Spurs
1997-98|Michael Jordan|Chicago Bulls
1996-97|Michael Jordan|Chicago Bulls
1995-96|Michael Jordan|Chicago Bulls
1994-95|Hakeem Olajuwon|Houston Rockets
1993-94|Hakeem Olajuwon|Houston Rockets
1992-93|Michael Jordan|Chicago Bulls
1991-92|Michael Jordan|Chicago Bulls
1990-91|Michael Jordan|Chicago Bulls
1989-90|Isiah Thomas|Detroit Pistons
1988-89|Joe Dumars|Detroit Pistons
1987-88|James Worthy|Los Angeles Lakers
1986-87|Magic Johnson|Los Angeles Lakers
1985-86|Larry Bird|Boston Celtics
1984-85|Kareem Abdul-Jabbar|Los Angeles Lakers
1983-84|Larry Bird|Boston Celtics
1982-83|Moses Malone|Philadelphia 76ers
1981-82|Magic Johnson|Los Angeles Lakers
1980-81|Cedric Maxwell|Boston Celtics
1979-80|Magic Johnson|Los Angeles Lakers
1978-79|Dennis Johnson|Seattle SuperSonics
1977-78|Wes Unseld|Washington Bullets
1976-77|Bill Walton|Portland Trail Blazers
1975-76|Jo Jo White|Boston Celtics
1974-75|Rick Barry|Golden State Warriors
1973-74|John Havlicek|Boston Celtics
1972-73|Willis Reed|New York Knicks
1971-72|Wilt Chamberlain|Los Angeles Lakers
1970-71|Kareem Abdul-Jabbar|Milwaukee Bucks
1969-70|Willis Reed|New York Knicks
1968-69|Jerry West|Los Angeles Lakers
"""

ROY = """
2025-26|Cooper Flagg|Dallas Mavericks
2024-25|Stephon Castle|San Antonio Spurs
2023-24|Victor Wembanyama|San Antonio Spurs
2022-23|Paolo Banchero|Orlando Magic
2021-22|Scottie Barnes|Toronto Raptors
2020-21|LaMelo Ball|Charlotte Hornets
2019-20|Ja Morant|Memphis Grizzlies
2018-19|Luka Doncic|Dallas Mavericks
2017-18|Ben Simmons|Philadelphia 76ers
2016-17|Malcolm Brogdon|Milwaukee Bucks
2015-16|Karl-Anthony Towns|Minnesota Timberwolves
2014-15|Andrew Wiggins|Minnesota Timberwolves
2013-14|Michael Carter-Williams|Philadelphia 76ers
2012-13|Damian Lillard|Portland Trail Blazers
2011-12|Kyrie Irving|Cleveland Cavaliers
2010-11|Blake Griffin|LA Clippers
2009-10|Tyreke Evans|Sacramento Kings
2008-09|Derrick Rose|Chicago Bulls
2007-08|Kevin Durant|Seattle SuperSonics
2006-07|Brandon Roy|Portland Trail Blazers
2005-06|Chris Paul|New Orleans/Oklahoma City Hornets
2004-05|Emeka Okafor|Charlotte Bobcats
2003-04|LeBron James|Cleveland Cavaliers
2002-03|Amar'e Stoudemire|Phoenix Suns
2001-02|Pau Gasol|Memphis Grizzlies
2000-01|Mike Miller|Orlando Magic
1999-00|Steve Francis|Houston Rockets
1999-00|Elton Brand|Chicago Bulls
1998-99|Vince Carter|Toronto Raptors
1997-98|Tim Duncan|San Antonio Spurs
1996-97|Allen Iverson|Philadelphia 76ers
1995-96|Damon Stoudamire|Toronto Raptors
1994-95|Jason Kidd|Dallas Mavericks
1994-95|Grant Hill|Detroit Pistons
1993-94|Chris Webber|Golden State Warriors
1992-93|Shaquille O'Neal|Orlando Magic
1991-92|Larry Johnson|Charlotte Hornets
1990-91|Derrick Coleman|New Jersey Nets
1989-90|David Robinson|San Antonio Spurs
1988-89|Mitch Richmond|Golden State Warriors
1987-88|Mark Jackson|New York Knicks
1986-87|Chuck Person|Indiana Pacers
1985-86|Patrick Ewing|New York Knicks
1984-85|Michael Jordan|Chicago Bulls
1983-84|Ralph Sampson|Houston Rockets
1982-83|Terry Cummings|San Diego Clippers
1981-82|Buck Williams|New Jersey Nets
1980-81|Darrell Griffith|Utah Jazz
1979-80|Larry Bird|Boston Celtics
1978-79|Phil Ford|Kansas City Kings
1977-78|Walter Davis|Phoenix Suns
1976-77|Adrian Dantley|Buffalo Braves
1975-76|Alvan Adams|Phoenix Suns
1974-75|Jamaal Wilkes|Golden State Warriors
1973-74|Ernie DiGregorio|Buffalo Braves
1972-73|Bob McAdoo|Buffalo Braves
1971-72|Sidney Wicks|Portland Trail Blazers
1970-71|Geoff Petrie|Portland Trail Blazers
1970-71|Dave Cowens|Boston Celtics
1969-70|Lew Alcindor|Milwaukee Bucks
1968-69|Wes Unseld|Baltimore Bullets
1967-68|Earl Monroe|Baltimore Bullets
1966-67|Dave Bing|Detroit Pistons
1965-66|Rick Barry|San Francisco Warriors
1964-65|Willis Reed|New York Knicks
1963-64|Jerry Lucas|Cincinnati Royals
1962-63|Terry Dischinger|Chicago Zephyrs
1961-62|Walt Bellamy|Chicago Packers
1960-61|Oscar Robertson|Cincinnati Royals
1959-60|Wilt Chamberlain|Philadelphia Warriors
1958-59|Elgin Baylor|Minneapolis Lakers
1957-58|Wood Sauldsberry|Philadelphia Warriors
1956-57|Tom Heinsohn|Boston Celtics
1955-56|Maurice Stokes|Rochester Royals
1954-55|Bob Pettit|Milwaukee Hawks
1953-54|Ray Felix|Baltimore Bullets
1952-53|Don Meineke|Fort Wayne Pistons
"""

DPOY = """
2025-26|Victor Wembanyama|San Antonio Spurs
2024-25|Evan Mobley|Cleveland Cavaliers
2023-24|Rudy Gobert|Minnesota Timberwolves
2022-23|Jaren Jackson Jr.|Memphis Grizzlies
2021-22|Marcus Smart|Boston Celtics
2020-21|Rudy Gobert|Utah Jazz
2019-20|Giannis Antetokounmpo|Milwaukee Bucks
2018-19|Rudy Gobert|Utah Jazz
2017-18|Rudy Gobert|Utah Jazz
2016-17|Draymond Green|Golden State Warriors
2015-16|Kawhi Leonard|San Antonio Spurs
2014-15|Kawhi Leonard|San Antonio Spurs
2013-14|Joakim Noah|Chicago Bulls
2012-13|Marc Gasol|Memphis Grizzlies
2011-12|Tyson Chandler|New York Knicks
2010-11|Dwight Howard|Orlando Magic
2009-10|Dwight Howard|Orlando Magic
2008-09|Dwight Howard|Orlando Magic
2007-08|Kevin Garnett|Boston Celtics
2006-07|Marcus Camby|Denver Nuggets
2005-06|Ben Wallace|Detroit Pistons
2004-05|Ben Wallace|Detroit Pistons
2003-04|Ron Artest|Indiana Pacers
2002-03|Ben Wallace|Detroit Pistons
2001-02|Ben Wallace|Detroit Pistons
2000-01|Dikembe Mutombo|Philadelphia 76ers
1999-00|Alonzo Mourning|Miami Heat
1998-99|Alonzo Mourning|Miami Heat
1997-98|Dikembe Mutombo|Atlanta Hawks
1996-97|Dikembe Mutombo|Atlanta Hawks
1995-96|Gary Payton|Seattle SuperSonics
1994-95|Dikembe Mutombo|Denver Nuggets
1993-94|Hakeem Olajuwon|Houston Rockets
1992-93|Hakeem Olajuwon|Houston Rockets
1991-92|David Robinson|San Antonio Spurs
1990-91|Dennis Rodman|Detroit Pistons
1989-90|Dennis Rodman|Detroit Pistons
1988-89|Mark Eaton|Utah Jazz
1987-88|Michael Jordan|Chicago Bulls
1986-87|Michael Cooper|Los Angeles Lakers
1985-86|Alvin Robertson|San Antonio Spurs
1984-85|Mark Eaton|Utah Jazz
1983-84|Sidney Moncrief|Milwaukee Bucks
1982-83|Sidney Moncrief|Milwaukee Bucks
"""

SMOY = """
2025-26|Keldon Johnson|San Antonio Spurs
2024-25|Payton Pritchard|Boston Celtics
2023-24|Naz Reid|Minnesota Timberwolves
2022-23|Malcolm Brogdon|Boston Celtics
2021-22|Tyler Herro|Miami Heat
2020-21|Jordan Clarkson|Utah Jazz
2019-20|Montrezl Harrell|LA Clippers
2018-19|Lou Williams|LA Clippers
2017-18|Lou Williams|LA Clippers
2016-17|Eric Gordon|Houston Rockets
2015-16|Jamal Crawford|LA Clippers
2014-15|Lou Williams|Toronto Raptors
2013-14|Jamal Crawford|LA Clippers
2012-13|J.R. Smith|New York Knicks
2011-12|James Harden|Oklahoma City Thunder
2010-11|Lamar Odom|Los Angeles Lakers
2009-10|Jamal Crawford|Atlanta Hawks
2008-09|Jason Terry|Dallas Mavericks
2007-08|Manu Ginobili|San Antonio Spurs
2006-07|Leandro Barbosa|Phoenix Suns
2005-06|Mike Miller|Memphis Grizzlies
2004-05|Ben Gordon|Chicago Bulls
2003-04|Antawn Jamison|Dallas Mavericks
2002-03|Bobby Jackson|Sacramento Kings
2001-02|Corliss Williamson|Detroit Pistons
2000-01|Aaron McKie|Philadelphia 76ers
1999-00|Rodney Rogers|Phoenix Suns
1998-99|Darrell Armstrong|Orlando Magic
1997-98|Danny Manning|Phoenix Suns
1996-97|John Starks|New York Knicks
1995-96|Toni Kukoc|Chicago Bulls
1994-95|Anthony Mason|New York Knicks
1993-94|Dell Curry|Charlotte Hornets
1992-93|Clifford Robinson|Portland Trail Blazers
1991-92|Detlef Schrempf|Indiana Pacers
1990-91|Detlef Schrempf|Indiana Pacers
1989-90|Ricky Pierce|Milwaukee Bucks
1988-89|Eddie Johnson|Phoenix Suns
1987-88|Roy Tarpley|Dallas Mavericks
1986-87|Ricky Pierce|Milwaukee Bucks
1985-86|Bill Walton|Boston Celtics
1984-85|Kevin McHale|Boston Celtics
1983-84|Kevin McHale|Boston Celtics
1982-83|Bobby Jones|Philadelphia 76ers
"""

MIP = """
2025-26|Nickeil Alexander-Walker|Atlanta Hawks
2024-25|Dyson Daniels|Atlanta Hawks
2023-24|Tyrese Maxey|Philadelphia 76ers
2022-23|Lauri Markkanen|Utah Jazz
2021-22|Ja Morant|Memphis Grizzlies
2020-21|Julius Randle|New York Knicks
2019-20|Brandon Ingram|New Orleans Pelicans
2018-19|Pascal Siakam|Toronto Raptors
2017-18|Victor Oladipo|Indiana Pacers
2016-17|Giannis Antetokounmpo|Milwaukee Bucks
2015-16|C.J. McCollum|Portland Trail Blazers
2014-15|Jimmy Butler|Chicago Bulls
2013-14|Goran Dragic|Phoenix Suns
2012-13|Paul George|Indiana Pacers
2011-12|Ryan Anderson|Orlando Magic
2010-11|Kevin Love|Minnesota Timberwolves
2009-10|Aaron Brooks|Houston Rockets
2008-09|Danny Granger|Indiana Pacers
2007-08|Hedo Turkoglu|Orlando Magic
2006-07|Monta Ellis|Golden State Warriors
2005-06|Boris Diaw|Phoenix Suns
2004-05|Bobby Simmons|LA Clippers
2003-04|Zach Randolph|Portland Trail Blazers
2002-03|Gilbert Arenas|Golden State Warriors
2001-02|Jermaine O'Neal|Indiana Pacers
2000-01|Tracy McGrady|Orlando Magic
1999-00|Jalen Rose|Indiana Pacers
1998-99|Darrell Armstrong|Orlando Magic
1997-98|Alan Henderson|Atlanta Hawks
1996-97|Isaac Austin|Miami Heat
1995-96|Gheorghe Muresan|Washington Bullets
1994-95|Dana Barros|Philadelphia 76ers
1993-94|Don MacLean|Washington Bullets
1992-93|Mahmoud Abdul-Rauf|Denver Nuggets
1991-92|Pervis Ellison|Washington Bullets
1990-91|Scott Skiles|Orlando Magic
1989-90|Rony Seikaly|Miami Heat
1988-89|Kevin Johnson|Phoenix Suns
1987-88|Kevin Duckworth|Portland Trail Blazers
1986-87|Dale Ellis|Seattle SuperSonics
1985-86|Alvin Robertson|San Antonio Spurs
"""

FINALS = """
2026|New York Knicks|San Antonio Spurs|4-1
2025|Oklahoma City Thunder|Indiana Pacers|4-3
2024|Boston Celtics|Dallas Mavericks|4-1
2023|Denver Nuggets|Miami Heat|4-1
2022|Golden State Warriors|Boston Celtics|4-2
2021|Milwaukee Bucks|Phoenix Suns|4-2
2020|Los Angeles Lakers|Miami Heat|4-2
2019|Toronto Raptors|Golden State Warriors|4-2
2018|Golden State Warriors|Cleveland Cavaliers|4-0
2017|Golden State Warriors|Cleveland Cavaliers|4-1
2016|Cleveland Cavaliers|Golden State Warriors|4-3
2015|Golden State Warriors|Cleveland Cavaliers|4-2
2014|San Antonio Spurs|Miami Heat|4-1
2013|Miami Heat|San Antonio Spurs|4-3
2012|Miami Heat|Oklahoma City Thunder|4-1
2011|Dallas Mavericks|Miami Heat|4-2
2010|Los Angeles Lakers|Boston Celtics|4-3
2009|Los Angeles Lakers|Orlando Magic|4-1
2008|Boston Celtics|Los Angeles Lakers|4-2
2007|San Antonio Spurs|Cleveland Cavaliers|4-0
2006|Miami Heat|Dallas Mavericks|4-2
2005|San Antonio Spurs|Detroit Pistons|4-3
2004|Detroit Pistons|Los Angeles Lakers|4-1
2003|San Antonio Spurs|New Jersey Nets|4-2
2002|Los Angeles Lakers|New Jersey Nets|4-0
2001|Los Angeles Lakers|Philadelphia 76ers|4-1
2000|Los Angeles Lakers|Indiana Pacers|4-2
1999|San Antonio Spurs|New York Knicks|4-1
1998|Chicago Bulls|Utah Jazz|4-2
1997|Chicago Bulls|Utah Jazz|4-2
1996|Chicago Bulls|Seattle SuperSonics|4-2
1995|Houston Rockets|Orlando Magic|4-0
1994|Houston Rockets|New York Knicks|4-3
1993|Chicago Bulls|Phoenix Suns|4-2
1992|Chicago Bulls|Portland Trail Blazers|4-2
1991|Chicago Bulls|Los Angeles Lakers|4-1
1990|Detroit Pistons|Portland Trail Blazers|4-1
1989|Detroit Pistons|Los Angeles Lakers|4-0
1988|Los Angeles Lakers|Detroit Pistons|4-3
1987|Los Angeles Lakers|Boston Celtics|4-2
1986|Boston Celtics|Houston Rockets|4-2
1985|Los Angeles Lakers|Boston Celtics|4-2
1984|Boston Celtics|Los Angeles Lakers|4-3
1983|Philadelphia 76ers|Los Angeles Lakers|4-0
1982|Los Angeles Lakers|Philadelphia 76ers|4-2
1981|Boston Celtics|Houston Rockets|4-2
1980|Los Angeles Lakers|Philadelphia 76ers|4-2
1979|Seattle SuperSonics|Washington Bullets|4-1
1978|Washington Bullets|Seattle SuperSonics|4-3
1977|Portland Trail Blazers|Philadelphia 76ers|4-2
1976|Boston Celtics|Phoenix Suns|4-2
1975|Golden State Warriors|Washington Bullets|4-0
1974|Boston Celtics|Milwaukee Bucks|4-3
1973|New York Knicks|Los Angeles Lakers|4-1
1972|Los Angeles Lakers|New York Knicks|4-1
1971|Milwaukee Bucks|Baltimore Bullets|4-0
1970|New York Knicks|Los Angeles Lakers|4-3
1969|Boston Celtics|Los Angeles Lakers|4-3
1968|Boston Celtics|Los Angeles Lakers|4-2
1967|Philadelphia 76ers|San Francisco Warriors|4-2
1966|Boston Celtics|Los Angeles Lakers|4-3
1965|Boston Celtics|Los Angeles Lakers|4-1
1964|Boston Celtics|San Francisco Warriors|4-1
1963|Boston Celtics|Los Angeles Lakers|4-2
1962|Boston Celtics|Los Angeles Lakers|4-3
1961|Boston Celtics|St. Louis Hawks|4-1
1960|Boston Celtics|St. Louis Hawks|4-3
1959|Boston Celtics|Minneapolis Lakers|4-0
1958|St. Louis Hawks|Boston Celtics|4-2
1957|Boston Celtics|St. Louis Hawks|4-3
1956|Philadelphia Warriors|Fort Wayne Pistons|4-1
1955|Syracuse Nationals|Fort Wayne Pistons|4-3
1954|Minneapolis Lakers|Syracuse Nationals|4-3
1953|Minneapolis Lakers|New York Knicks|4-1
1952|Minneapolis Lakers|New York Knicks|4-3
1951|Rochester Royals|New York Knicks|4-3
1950|Minneapolis Lakers|Syracuse Nationals|4-2
1949|Minneapolis Lakers|Washington Capitols|4-2
1948|Baltimore Bullets|Philadelphia Warriors|4-2
1947|Philadelphia Warriors|Chicago Stags|4-1
"""

AWARDS = [
    ("mvp", "MVP", "Meilleur joueur de la saison régulière", MVP),
    ("fmvp", "MVP des Finales", "Trophée Bill Russell", FINALS_MVP),
    ("roy", "Rookie de l'année", "Trophée Wilt Chamberlain", ROY),
    ("dpoy", "Défenseur de l'année", "Trophée Hakeem Olajuwon", DPOY),
    ("smoy", "Sixième homme", "Trophée John Havlicek", SMOY),
    ("mip", "Meilleure progression", "Trophée George Mikan", MIP),
]

# Anciens noms des franchises actuelles (sigle de la franchise d'aujourd'hui). Les franchises
# disparues (Chicago Stags, Washington Capitols, premiers Baltimore Bullets) n'ont pas de logo.
TEAM_ALIASES = {
    "Minneapolis Lakers": "LAL", "Philadelphia Warriors": "GSW", "San Francisco Warriors": "GSW", "Syracuse Nationals": "PHI",
    "Rochester Royals": "SAC", "Cincinnati Royals": "SAC", "Kansas City Kings": "SAC", "St. Louis Hawks": "ATL",
    "Milwaukee Hawks": "ATL", "Fort Wayne Pistons": "DET", "Washington Bullets": "WAS", "Chicago Packers": "WAS",
    "Chicago Zephyrs": "WAS", "Seattle SuperSonics": "OKC", "Buffalo Braves": "LAC", "San Diego Clippers": "LAC",
    "LA Clippers": "LAC", "New Jersey Nets": "BKN", "New Orleans/Oklahoma City Hornets": "NOP", "Charlotte Bobcats": "CHA",
    "Charlotte Hornets": "CHA",
}

# Noms d'usage différents de ceux de l'index NBA.
PLAYER_ALIASES = {"lew alcindor": "kareem abdul-jabbar", "ron artest": "metta world peace", "wood sauldsberry": "woody sauldsberry"}


def norm(name: str) -> str:
    text = unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode().lower()
    text = re.sub(r"[.'’]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _lines(block: str) -> list[list[str]]:
    return [line.split("|") for line in block.strip().splitlines() if line.strip()]


def team_tri(name: str, year: int) -> str | None:
    """Sigle de la franchise actuelle pour un nom d'équipe de l'époque (année de fin de saison)."""
    from . import teams_meta

    if name == "Baltimore Bullets" and year <= 1955:
        return None  # franchise disparue en 1954, sans lien avec les Bullets de 1963
    if name == "Baltimore Bullets":
        return "WAS"
    if name == "Charlotte Hornets" and 1989 <= year <= 2002:
        return "CHA"
    for t in teams_meta.TEAMS:
        if f"{t['city']} {t['name']}" == name:
            return t["tri"]
    return TEAM_ALIASES.get(name)


def season_end(season: str) -> int:
    start = int(season[:4])
    return start + 1


def raw() -> dict:
    awards = []
    for key, label, sub, block in AWARDS:
        awards.append(
            {
                "key": key,
                "label": label,
                "sub": sub,
                "winners": [{"season": s, "name": n, "team": t} for s, n, t in _lines(block)],
            }
        )
    finals = [{"year": int(y), "champion": c, "runnerUp": r, "result": res} for y, c, r, res in _lines(FINALS)]
    return {"awards": awards, "finals": finals}
