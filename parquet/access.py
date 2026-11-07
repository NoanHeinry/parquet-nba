"""Code d'accès facultatif, pour un Parquet joignable depuis Internet.

Sans code (le cas normal), rien ne change : Parquet n'est ouvert qu'à cet appareil ou au Wi-Fi
de la maison. Avec un code (variable d'environnement PARQUET_ACCES, ou option --code-acces), chaque
appareil doit le taper une fois : Parquet lui remet alors un cookie signé, valable un an. Changer le
code déconnecte tous les appareils.

Le cookie ne contient pas le code : c'est une signature HMAC du code par une clé aléatoire gardée dans
data/acces.key. Les essais ratés sont limités (10 par quart d'heure, tous appareils confondus, car
derrière un tunnel toutes les requêtes semblent venir de la même adresse).
"""

from __future__ import annotations

import hashlib
import hmac
import html
import os
import secrets
import threading
import time
from pathlib import Path

ENV = "PARQUET_ACCES"
COOKIE = "parquet_acces"
MIN_LENGTH = 6
MAX_FAILURES = 10
WINDOW = 15 * 60
COOKIE_AGE = 365 * 24 * 3600

# Fichiers visibles sans code : polices et icônes de la page du code, de l'onglet et de l'écran d'accueil.
PUBLIC = {"/api/sante", "/fonts/oswald.woff", "/fonts/barlow-400.woff", "/fonts/barlow-600.woff", "/img/icon.svg", "/img/logo.svg", "/img/logo-complet.svg", "/img/icon-maskable-512.png", "/img/icon-192.png", "/img/icon-512.png", "/img/apple-touch-icon.png", "/manifest.webmanifest"}

_code: str | None = None
_key: bytes = b""
_failures: list[float] = []
_lock = threading.Lock()


def init(code: str | None, key_path: Path | None) -> None:
    """Active (ou désactive, avec un code vide) le code d'accès."""
    global _code, _key
    code = (code or "").strip()
    _failures.clear()
    if not code:
        _code, _key = None, b""
        return
    if len(code) < MIN_LENGTH:
        raise ValueError(f"Le code d'accès doit faire au moins {MIN_LENGTH} caractères.")
    _code = code
    _key = _load_key(key_path)


def _load_key(path: Path | None) -> bytes:
    if path is None:
        return secrets.token_bytes(32)
    try:
        key = path.read_bytes()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_bytes(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def enabled() -> bool:
    return _code is not None


def _token() -> str:
    return hmac.new(_key, _code.encode("utf-8"), hashlib.sha256).hexdigest()


def _cookies(header: str | None) -> dict[str, str]:
    out = {}
    for part in (header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name:
            out[name] = value
    return out


def allowed(path: str, cookie_header: str | None) -> bool:
    if _code is None or path in PUBLIC:
        return True
    given = _cookies(cookie_header).get(COOKIE, "")
    return bool(given) and hmac.compare_digest(given, _token())


def locked() -> bool:
    now = time.monotonic()
    with _lock:
        _failures[:] = [t for t in _failures if now - t < WINDOW]
        return len(_failures) >= MAX_FAILURES


def check(code: str) -> bool:
    """Vérifie un code tapé. Faux aussi quand trop d'essais ont échoué récemment."""
    if _code is None:
        return True
    if locked():
        return False
    ok = hmac.compare_digest(code.strip().encode("utf-8"), _code.encode("utf-8"))
    if not ok:
        with _lock:
            _failures.append(time.monotonic())
        time.sleep(0.4)  # ralentit les essais en rafale
    return ok


def set_cookie(secure: bool) -> str:
    flags = f"Max-Age={COOKIE_AGE}; Path=/; HttpOnly; SameSite=Lax"
    return f"{COOKIE}={_token()}; {flags}{'; Secure' if secure else ''}"


def clear_cookie() -> str:
    return f"{COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"


def safe_next(target: str | None) -> str:
    """Page où revenir après le code : seulement une adresse de Parquet, jamais un autre site."""
    target = target or "/"
    if not target.startswith("/") or target.startswith("//") or "\\" in target or target.startswith("/acces") or any(ord(c) < 33 or ord(c) == 127 for c in target):
        return "/"
    return target


def login_page(next_path: str, error: str | None = None) -> bytes:
    msg = f'<p class="err" role="alert">{html.escape(error, quote=False)}</p>' if error else ""
    page = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Parquet · code d'accès</title>
<link rel="icon" href="/img/icon.svg" type="image/svg+xml">
<style>
  :root {{ color-scheme: dark; --bg: #0d0f12; --ink: #f2efe8; --mute: #9a968d; --line: #2a2d33; --accent: #f26b1d; --err: #ff6b5b; }}
  @media (prefers-color-scheme: light) {{ :root {{ color-scheme: light; --bg: #f4f1ea; --ink: #15171a; --mute: #6b675f; --line: #d8d3c8; --err: #c8321f; }} }}
  @font-face {{ font-family: "Oswald"; src: url("/fonts/oswald.woff") format("woff"); font-weight: 200 700; font-display: swap; }}
  @font-face {{ font-family: "Barlow"; src: url("/fonts/barlow-400.woff") format("woff"); font-weight: 400; font-display: swap; }}
  @font-face {{ font-family: "Barlow"; src: url("/fonts/barlow-600.woff") format("woff"); font-weight: 600; font-display: swap; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--ink);
         font: 17px/1.5 "Barlow", system-ui, sans-serif; }}
  main {{ width: min(360px, 100%); }}
  .brand {{ display: flex; justify-content: center; margin: 0 0 30px; }}
  .brand img {{ width: min(300px, 100%); height: auto; }}
  h1 {{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }}
  p {{ margin: 0 0 18px; color: var(--mute); }}
  label {{ display: block; font: 500 12px/1.4 "Oswald", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--mute); margin-bottom: 6px; }}
  input {{ width: 100%; padding: 12px 14px; font: inherit; color: var(--ink); background: transparent; border: 0;
          border-bottom: 2px solid var(--line); outline: none; }}
  input:focus {{ border-bottom-color: var(--accent); }}
  button {{ margin-top: 22px; width: 100%; padding: 13px 14px; font: 600 15px/1 "Oswald", sans-serif; letter-spacing: .08em; text-transform: uppercase;
           color: #fff; background: var(--accent); border: 0; cursor: pointer;
           clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px); }}
  .err {{ color: var(--err); margin: 14px 0 0; }}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="/img/logo-complet.svg" alt=""><h1>Parquet</h1></div>
  <p>Ce Parquet est protégé. Tape le code d'accès choisi lors de l'installation : cet appareil s'en souviendra.</p>
  <form method="post" action="/acces">
    <input type="hidden" name="next" value="{html.escape(next_path)}">
    <label for="code">Code d'accès</label>
    <input id="code" name="code" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Entrer</button>
    {msg}
  </form>
</main>
<script>
  // L'adresse d'une page de Parquet est après le « # » : le navigateur ne l'envoie pas, on l'ajoute.
  document.querySelector("form").addEventListener("submit", (e) => {{
    if (location.hash) e.target.elements.next.value = "/" + location.hash;
  }});
</script>
</body>
</html>
"""
    return page.encode("utf-8")
