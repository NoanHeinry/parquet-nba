"""Records de tous les temps en un match et sur une saison (NBA, saison régulière).

NBA.com ne publie pas ces classements : ils sont repris du livre des records, vérifiés le
14 novembre 2026 sur Basketball-Reference (pages « Single Game Leaders » et « Single Season
Leaders », tableaux NBA seulement) et sur Wikipédia (listes des records en un match, qui
remontent avant 1983-84 pour les rebonds et les passes). La saison en cours n'y figure pas :
elle est calculée en direct (voir history.py), et une performance qui entre dans le top 10 de
l'histoire y est signalée.

Rappels : interceptions et contres ne sont comptés que depuis 1973-74, les tirs à 3 points
depuis 1979-80.
"""

# En un match : (valeur, joueur, équipe, adversaire ou "", date AAAA-MM-JJ)
GAME = {
    "PTS": [
        (100, "Wilt Chamberlain", "Philadelphia Warriors", "New York Knicks", "1962-03-02"),
        (83, "Bam Adebayo", "Miami Heat", "", "2026-03-10"),
        (81, "Kobe Bryant", "Los Angeles Lakers", "Toronto Raptors", "2006-01-22"),
        (78, "Wilt Chamberlain", "Philadelphia Warriors", "Los Angeles Lakers", "1961-12-08"),
        (73, "Luka Dončić", "Dallas Mavericks", "Atlanta Hawks", "2024-01-26"),
        (73, "David Thompson", "Denver Nuggets", "Detroit Pistons", "1978-04-09"),
        (73, "Wilt Chamberlain", "San Francisco Warriors", "New York Knicks", "1962-11-16"),
        (73, "Wilt Chamberlain", "Philadelphia Warriors", "Chicago Packers", "1962-01-13"),
        (72, "Wilt Chamberlain", "San Francisco Warriors", "Los Angeles Lakers", "1962-11-03"),
        (71, "Damian Lillard", "Portland Trail Blazers", "Houston Rockets", "2023-02-26"),
        (71, "Donovan Mitchell", "Cleveland Cavaliers", "Chicago Bulls", "2023-01-02"),
        (71, "David Robinson", "San Antonio Spurs", "Los Angeles Clippers", "1994-04-24"),
        (71, "Elgin Baylor", "Los Angeles Lakers", "New York Knicks", "1960-11-15"),
    ],
    "REB": [
        (55, "Wilt Chamberlain", "Philadelphia Warriors", "Boston Celtics", "1960-11-24"),
        (51, "Bill Russell", "Boston Celtics", "Syracuse Nationals", "1960-02-05"),
        (49, "Bill Russell", "Boston Celtics", "Philadelphia Warriors", "1957-11-16"),
        (49, "Bill Russell", "Boston Celtics", "Detroit Pistons", "1965-03-11"),
        (45, "Wilt Chamberlain", "Philadelphia Warriors", "Syracuse Nationals", "1960-02-06"),
        (45, "Wilt Chamberlain", "Philadelphia Warriors", "Los Angeles Lakers", "1961-01-21"),
        (43, "Wilt Chamberlain", "Philadelphia Warriors", "New York Knicks", "1959-11-10"),
        (43, "Wilt Chamberlain", "Philadelphia Warriors", "Los Angeles Lakers", "1961-12-08"),
        (43, "Bill Russell", "Boston Celtics", "Los Angeles Lakers", "1963-01-20"),
        (43, "Wilt Chamberlain", "Philadelphia 76ers", "Boston Celtics", "1965-03-06"),
    ],
    "AST": [
        (30, "Scott Skiles", "Orlando Magic", "Denver Nuggets", "1990-12-30"),
        (29, "Kevin Porter", "New Jersey Nets", "Houston Rockets", "1978-02-24"),
        (28, "Bob Cousy", "Boston Celtics", "Minneapolis Lakers", "1959-02-27"),
        (28, "Guy Rodgers", "San Francisco Warriors", "St. Louis Hawks", "1963-03-14"),
        (28, "John Stockton", "Utah Jazz", "San Antonio Spurs", "1991-01-15"),
        (27, "Geoff Huston", "Cleveland Cavaliers", "Golden State Warriors", "1982-01-27"),
        (27, "John Stockton", "Utah Jazz", "New York Knicks", "1989-12-19"),
        (26, "John Stockton", "Utah Jazz", "Portland Trail Blazers", "1988-04-14"),
        (25, "Ernie DiGregorio", "Buffalo Braves", "Portland Trail Blazers", "1974-01-01"),
        (25, "Kevin Porter", "Detroit Pistons", "Boston Celtics", "1979-03-09"),
    ],
    "STL": [
        (11, "Larry Kenon", "San Antonio Spurs", "Kansas City Kings", "1976-12-26"),
        (11, "Kendall Gill", "New Jersey Nets", "Miami Heat", "1999-04-03"),
        (10, "Jerry West", "Los Angeles Lakers", "Seattle SuperSonics", "1973-12-07"),
        (10, "Larry Steele", "Portland Trail Blazers", "Los Angeles Lakers", "1974-11-16"),
        (10, "Fred Brown", "Seattle SuperSonics", "Philadelphia 76ers", "1976-12-03"),
        (10, "Gus Williams", "Seattle SuperSonics", "New Jersey Nets", "1978-02-22"),
        (10, "Eddie Jordan", "New Jersey Nets", "Philadelphia 76ers", "1979-03-23"),
        (10, "Johnny Moore", "San Antonio Spurs", "Indiana Pacers", "1985-03-06"),
        (10, "Fat Lever", "Denver Nuggets", "Indiana Pacers", "1985-03-09"),
        (10, "Clyde Drexler", "Portland Trail Blazers", "Milwaukee Bucks", "1986-01-10"),
    ],
    "BLK": [
        (17, "Elmore Smith", "Los Angeles Lakers", "Portland Trail Blazers", "1973-10-28"),
        (15, "Manute Bol", "Washington Bullets", "Atlanta Hawks", "1986-01-25"),
        (15, "Manute Bol", "Washington Bullets", "Indiana Pacers", "1987-02-26"),
        (15, "Shaquille O'Neal", "Orlando Magic", "New Jersey Nets", "1993-11-20"),
        (14, "Elmore Smith", "Los Angeles Lakers", "Detroit Pistons", "1973-10-26"),
        (14, "Elmore Smith", "Los Angeles Lakers", "Houston Rockets", "1973-11-04"),
        (14, "Mark Eaton", "Utah Jazz", "Portland Trail Blazers", "1985-01-18"),
        (14, "Mark Eaton", "Utah Jazz", "San Antonio Spurs", "1989-02-18"),
        (13, "George Johnson", "San Antonio Spurs", "Golden State Warriors", "1981-02-24"),
        (13, "Mark Eaton", "Utah Jazz", "Portland Trail Blazers", "1983-02-18"),
    ],
    "FG3M": [
        (14, "Klay Thompson", "Golden State Warriors", "Chicago Bulls", "2018-10-29"),
        (13, "Damian Lillard", "Portland Trail Blazers", "Houston Rockets", "2023-02-26"),
        (13, "Zach LaVine", "Chicago Bulls", "Charlotte Hornets", "2019-11-23"),
        (13, "Stephen Curry", "Golden State Warriors", "New Orleans Pelicans", "2016-11-07"),
        (12, "Trey Murphy III", "New Orleans Pelicans", "", "2026-02-04"),
        (12, "Stephen Curry", "Golden State Warriors", "", "2025-12-14"),
        (12, "Stephen Curry", "Golden State Warriors", "", "2025-04-01"),
        (12, "Stephen Curry", "Golden State Warriors", "", "2025-02-27"),
        (12, "Keegan Murray", "Sacramento Kings", "Utah Jazz", "2023-12-16"),
        (12, "Klay Thompson", "Golden State Warriors", "Houston Rockets", "2023-02-24"),
        (12, "Klay Thompson", "Golden State Warriors", "Oklahoma City Thunder", "2023-02-06"),
        (12, "Stephen Curry", "Golden State Warriors", "Oklahoma City Thunder", "2016-02-27"),
    ],
}

# Sur une saison : (valeur, joueur, saison). Moyennes par match, sauf les tirs à 3 points (total).
SEASON = {
    "PTS": [
        (50.36, "Wilt Chamberlain", "1961-62"),
        (44.83, "Wilt Chamberlain", "1962-63"),
        (38.39, "Wilt Chamberlain", "1960-61"),
        (37.60, "Wilt Chamberlain", "1959-60"),
        (37.09, "Michael Jordan", "1986-87"),
        (36.85, "Wilt Chamberlain", "1963-64"),
        (36.13, "James Harden", "2018-19"),
        (35.58, "Rick Barry", "1966-67"),
        (35.40, "Kobe Bryant", "2005-06"),
        (34.98, "Michael Jordan", "1987-88"),
    ],
    "REB": [
        (27.20, "Wilt Chamberlain", "1960-61"),
        (26.96, "Wilt Chamberlain", "1959-60"),
        (25.65, "Wilt Chamberlain", "1961-62"),
        (24.74, "Bill Russell", "1963-64"),
        (24.59, "Wilt Chamberlain", "1965-66"),
        (24.32, "Wilt Chamberlain", "1962-63"),
        (24.16, "Wilt Chamberlain", "1966-67"),
        (24.08, "Bill Russell", "1964-65"),
        (24.03, "Bill Russell", "1959-60"),
        (23.95, "Bill Russell", "1960-61"),
    ],
    "AST": [
        (14.54, "John Stockton", "1989-90"),
        (14.20, "John Stockton", "1990-91"),
        (13.86, "Isiah Thomas", "1984-85"),
        (13.76, "John Stockton", "1987-88"),
        (13.73, "John Stockton", "1991-92"),
        (13.63, "John Stockton", "1988-89"),
        (13.40, "Kevin Porter", "1978-79"),
        (13.06, "Magic Johnson", "1983-84"),
        (12.83, "Magic Johnson", "1988-89"),
        (12.60, "Magic Johnson", "1985-86"),
    ],
    "STL": [
        (3.67, "Alvin Robertson", "1985-86"),
        (3.47, "Don Buse", "1976-77"),
        (3.43, "Magic Johnson", "1980-81"),
        (3.23, "Michael Ray Richardson", "1979-80"),
        (3.21, "Alvin Robertson", "1986-87"),
        (3.21, "John Stockton", "1988-89"),
        (3.18, "Slick Watts", "1975-76"),
        (3.16, "Michael Jordan", "1987-88"),
        (3.04, "Alvin Robertson", "1990-91"),
        (3.03, "Alvin Robertson", "1988-89"),
    ],
    "BLK": [
        (5.56, "Mark Eaton", "1984-85"),
        (4.96, "Manute Bol", "1985-86"),
        (4.85, "Elmore Smith", "1973-74"),
        (4.61, "Mark Eaton", "1985-86"),
        (4.59, "Hakeem Olajuwon", "1989-90"),
        (4.49, "Dikembe Mutombo", "1995-96"),
        (4.49, "David Robinson", "1991-92"),
        (4.34, "Hakeem Olajuwon", "1991-92"),
        (4.31, "Manute Bol", "1988-89"),
        (4.29, "Tree Rollins", "1982-83"),
    ],
    "FG3M": [
        (402, "Stephen Curry", "2015-16"),
        (378, "James Harden", "2018-19"),
        (357, "Stephen Curry", "2023-24"),
        (354, "Stephen Curry", "2018-19"),
        (337, "Stephen Curry", "2020-21"),
        (324, "Stephen Curry", "2016-17"),
        (320, "Anthony Edwards", "2024-25"),
        (319, "Malik Beasley", "2024-25"),
        (311, "Stephen Curry", "2024-25"),
        (301, "Klay Thompson", "2022-23"),
    ],
}

# Nom dans les listes → nom dans l'index des joueurs de NBA.com, quand ils diffèrent.
NAME_ALIASES = {
    "michael ray richardson": "micheal ray richardson",
    "fat lever": "lafayette lever",
}
