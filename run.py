"""Lance Parquet : python run.py

Options :
  --port 8765        port local (le suivant libre est choisi s'il est occupé)
  --lan              rend l'application accessible depuis les autres appareils du Wi-Fi (téléphone…)
  --demo             lance l'application sur des données de démonstration, sans connexion à NBA.com
  --no-browser       ne pas ouvrir le navigateur automatiquement
  --diagnostic       teste les sources de données puis s'arrête
  --vider-cache      efface les données mises en cache puis démarre
"""

from __future__ import annotations

import argparse
import errno
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

if sys.version_info < (3, 9):
    sys.exit("Parquet a besoin de Python 3.9 ou plus récent : https://www.python.org/downloads/")

try:
    import requests  # noqa: F401
except ImportError:
    sys.exit(
        "Il manque la bibliothèque « requests ».\n"
        "Lance plutôt le fichier lancer.bat (Windows) ou lancer.command (Mac), "
        "installer-android.sh sur un téléphone Android (Termux), "
        "ou tape : python -m pip install -r requirements.txt"
    )

from parquet import __version__, nba, settings
from parquet.cache import Cache
from parquet.server import make_server

APP_DIR = Path(__file__).resolve().parent


def lan_address() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # adresse de test : aucun paquet n'est réellement envoyé
            return s.getsockname()[0]
    except OSError:
        return None


def on_termux() -> bool:
    """Vrai quand Parquet tourne sur un téléphone Android, dans l'application Termux."""
    return "com.termux" in os.environ.get("PREFIX", "")


def open_browser(url: str) -> None:
    # Sur Android, le module webbrowser ne trouve pas le navigateur : Termux fournit termux-open-url.
    opener = shutil.which("termux-open-url") if on_termux() else None
    if opener:
        subprocess.run([opener, url], check=False)
    else:
        webbrowser.open(url)


def run_diagnostic() -> int:
    print("Test des sources de données…\n")
    report = nba.diagnostic()
    width = max(len(c["label"]) for c in report["checks"])
    failures = 0
    for c in report["checks"]:
        state = "OK" if c["ok"] else "ÉCHEC"
        failures += 0 if c["ok"] else 1
        line = f"  {c['label'].ljust(width)}  {state:<5}  {c['ms']:>5} ms"
        if not c["ok"]:
            line += f"\n      {c['message']}"
        print(line)
    print(f"\nSaison : {report['season']} — journée NBA en cours : {report['gameDay']}")
    if failures:
        print(
            "\nSi NBA.com ne répond pas : vérifie ta connexion, désactive un éventuel VPN "
            "ou bloqueur réseau, puis réessaie dans quelques minutes."
        )
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Parquet, tableau de bord NBA personnel")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--lan", action="store_true", help="rendre l'application accessible depuis le téléphone (même Wi-Fi)")
    parser.add_argument("--local-only", action="store_true", help=argparse.SUPPRESS)  # ancienne option, c'est désormais le comportement par défaut
    parser.add_argument("--demo", action="store_true", help="données de démonstration, sans accès à NBA.com")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port-fixe", action="store_true", help=argparse.SUPPRESS)  # pas de port de secours (lanceur Android)
    parser.add_argument("--diagnostic", action="store_true")
    parser.add_argument("--vider-cache", action="store_true")
    args = parser.parse_args()

    if args.demo:
        # Données fictives générées localement : utile pour découvrir l'application hors ligne.
        from parquet import demo

        demo.install()
        cache = Cache(APP_DIR / "data" / "demo-cache.sqlite3")
        cache.clear()
    else:
        cache = Cache(APP_DIR / "data" / "cache.sqlite3")
    if args.vider_cache:
        cache.clear()
        print("Cache vidé.")
    nba.init(cache)
    settings.init(APP_DIR / "data" / "settings.json")

    if args.diagnostic:
        return run_diagnostic()

    # Par défaut, seul cet ordinateur peut ouvrir Parquet. Avec --lan, les appareils
    # du même réseau aussi : à réserver au Wi-Fi de la maison, pas aux réseaux publics.
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    server = None
    port = args.port
    for candidate in range(args.port, args.port + (1 if args.port_fixe else 20)):
        try:
            server = make_server(host, candidate)
            port = candidate
            break
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, getattr(errno, "WSAEADDRINUSE", -1), 10048, 10013):
                raise
    if server is None:
        if args.port_fixe:
            print(f"Le port {args.port} est déjà utilisé par une autre application.")
            return 1
        print(f"Aucun port libre entre {args.port} et {args.port + 19}.")
        return 1

    url = f"http://localhost:{port}/"
    print(f"\n  Parquet {__version__} est lancé : {url}")
    if args.demo:
        print("  Mode démonstration : joueurs et scores fictifs, aucune connexion à NBA.com.")
    if host == "0.0.0.0":
        ip = lan_address()
        if ip:
            print(f"  Sur ton téléphone (même Wi-Fi) : http://{ip}:{port}/")
        print("  Parquet est visible des autres appareils de ce réseau : à éviter sur un Wi-Fi public.")
    if on_termux():
        print("  Tu peux passer au navigateur : Termux garde Parquet allumé en arrière-plan.")
        print("  Pour arrêter : tape « parquet stop », ou touche « Exit » dans la notification de Termux.\n")
    else:
        print("  Laisse cette fenêtre ouverte pendant que tu utilises l'application.")
        print("  Pour arrêter : ferme la fenêtre ou appuie sur Ctrl+C.\n")

    if not args.no_browser:
        threading.Timer(0.8, open_browser, args=(url,)).start()

    # « parquet stop » (Android) et les gestionnaires de processus envoient SIGTERM :
    # même arrêt propre qu'avec Ctrl+C.
    def stop(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nParquet est arrêté. À bientôt !")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
