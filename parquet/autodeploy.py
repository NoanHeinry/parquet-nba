"""Déploiement automatique : Parquet se met à jour tout seul, sans risque.

`run.py --auto-maj` ne sert pas les pages lui-même : il lance le vrai serveur dans un processus enfant
et le surveille.
- Le serveur s'arrête par erreur : il est relancé (avec une attente croissante).
- Toutes les 10 minutes, il regarde s'il existe une nouvelle version sur GitHub. Il ne l'installe que
  si les tests automatiques de GitHub (la pipeline) sont tous passés pour ce commit.
- Mise à jour : git (avance rapide seulement), bibliothèques si requirements.txt a changé, redémarrage,
  puis contrôle de santé (la nouvelle version doit répondre sur /api/sante dans la minute).
- Contrôle raté : retour automatique à la version précédente, et ce commit n'est plus retenté.

L'état (version, dernières opérations) est écrit dans data/deploiement.json et affiché sur la page
« État des sources ». Sur un téléphone (Termux), la commande « parquet » est aussi rafraîchie.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

APP_DIR = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get("PARQUET_ETAT_DEPLOIEMENT", APP_DIR / "data" / "deploiement.json"))
INTERVAL = int(os.environ.get("PARQUET_MAJ_MINUTES", "10")) * 60
HEALTH_TIMEOUT = 60
OK_CONCLUSIONS = {"success", "skipped", "neutral"}
# Fichiers du superviseur lui-même : s'ils changent, il se relance pour utiliser sa nouvelle version.
SELF_FILES = ("run.py", "parquet/autodeploy.py")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# État partagé avec le serveur (page « État des sources »)
# ---------------------------------------------------------------------------


def public_state(path: Path = STATE) -> dict:
    """État affiché par le serveur : « actif » seulement si le superviseur tourne vraiment."""
    state = read_state(path)
    pid = state.get("pid")
    alive = False
    if state.get("active") and isinstance(pid, int):
        try:
            os.kill(pid, 0)
            alive = True
        except (OSError, PermissionError):
            alive = False
    state["active"] = alive
    state.pop("pid", None)
    state.pop("bad", None)
    return state


def read_state(path: Path = STATE) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict, path: Path = STATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def log(state: dict, kind: str, message: str, **extra) -> None:
    entry = {"at": now(), "kind": kind, "message": message, **extra}
    state["events"] = ([entry] + state.get("events", []))[:12]
    print(f"[mise à jour auto] {message}", flush=True)


# ---------------------------------------------------------------------------
# Git et GitHub
# ---------------------------------------------------------------------------


def git(app: Path, *args: str, timeout: int = 120) -> str:
    out = subprocess.run(["git", "-C", str(app), *args], capture_output=True, text=True, timeout=timeout)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout).strip() or f"git {' '.join(args)} a échoué")
    return out.stdout.strip()


def repo_slug(app: Path) -> str | None:
    """« propriétaire/dépôt » à partir de l'adresse du dépôt GitHub d'origine."""
    try:
        url = git(app, "remote", "get-url", "origin")
    except (RuntimeError, OSError):
        return None
    m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else None


def github_ci(slug: str | None, sha: str) -> str:
    """« success », « pending » ou « failure » selon les tests GitHub de ce commit (« unknown » si injoignable)."""
    if not slug:
        return "success"  # dépôt hors GitHub : pas de tests à attendre, le contrôle de santé reste là
    req = urllib.request.Request(
        f"https://api.github.com/repos/{slug}/commits/{sha}/check-runs?per_page=100",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "parquet-autodeploy"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            runs = json.load(r).get("check_runs", [])
    except (urllib.error.URLError, OSError, ValueError):
        return "unknown"
    return ci_verdict(runs)


def ci_verdict(runs: list[dict]) -> str:
    if not runs:
        return "pending"  # les tests n'ont pas encore démarré
    if any(r.get("status") != "completed" for r in runs):
        return "pending"
    return "success" if all(r.get("conclusion") in OK_CONCLUSIONS for r in runs) else "failure"


def read_version(app: Path) -> str:
    text = (app / "parquet" / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'__version__\s*=\s*"([^"]+)"', text)
    return m.group(1) if m else "?"


# ---------------------------------------------------------------------------
# Une vérification : cherche, installe, contrôle, revient en arrière si besoin
# ---------------------------------------------------------------------------


class Deployer:
    def __init__(self, app: Path, restart: Callable[[], None], healthy: Callable[[str], bool],
                 ci: Callable[[str, str], str] = github_ci, state_path: Path = STATE, pip: Callable[[Path], None] | None = None):
        self.app, self.restart, self.healthy, self.ci = app, restart, healthy, ci
        self.state_path = state_path
        self.pip = pip or install_requirements
        self.state = read_state(state_path)
        self.state.update({"active": True, "pid": os.getpid(), "interval": INTERVAL // 60, "version": read_version(app), "startedAt": now()})
        try:
            self.state["commit"] = git(app, "rev-parse", "--short", "HEAD")
        except (RuntimeError, OSError):
            self.state["active"] = False
            self.state["message"] = "Ce dossier n'est pas un dépôt git : mises à jour automatiques impossibles."
        self.save()

    def save(self) -> None:
        save_state(self.state, self.state_path)

    def check(self) -> str:
        """Une vérification complète. Renvoie ce qui s'est passé (pour les tests et le journal)."""
        if not self.state.get("active"):
            return "inactive"
        self.state["checkedAt"] = now()
        try:
            git(self.app, "fetch", "--quiet", "origin")
            branch = git(self.app, "rev-parse", "--abbrev-ref", "HEAD")
            head = git(self.app, "rev-parse", "HEAD")
            target = git(self.app, "rev-parse", f"origin/{branch}")
        except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
            self.state["message"] = f"GitHub injoignable pour l'instant ({str(exc)[:120]})."
            self.save()
            return "offline"
        if target == head or git(self.app, "merge-base", head, target) == target:
            self.state["message"] = "À jour."
            self.save()
            return "uptodate"
        if target in self.state.get("bad", []):
            self.state["message"] = f"La version {target[:7]} a échoué ici : en attente d'une version corrigée."
            self.save()
            return "known-bad"
        verdict = self.ci(repo_slug(self.app), target)
        if verdict != "success":
            self.state["message"] = {
                "pending": f"Nouvelle version {target[:7]} : les tests GitHub sont en cours, installation au prochain passage.",
                "failure": f"Nouvelle version {target[:7]} ignorée : des tests GitHub ont échoué.",
                "unknown": "Impossible de lire le résultat des tests GitHub pour l'instant.",
            }[verdict]
            if verdict == "failure" and self.state.get("lastFailure") != target:
                self.state["lastFailure"] = target
                log(self.state, "ci-failed", self.state["message"], commit=target[:7])
            self.save()
            return f"ci-{verdict}"
        return self.deploy(head, target)

    def deploy(self, head: str, target: str) -> str:
        old_version = read_version(self.app)
        changed = git(self.app, "diff", "--name-only", head, target).splitlines()
        try:
            git(self.app, "merge", "--ff-only", "--quiet", target)
        except RuntimeError as exc:
            self.state["message"] = "Mise à jour bloquée : des fichiers ont été modifiés à la main sur cet appareil."
            log(self.state, "blocked", self.state["message"], detail=str(exc)[:200])
            self.save()
            return "blocked"
        if "requirements.txt" in changed:
            self.pip(self.app)
        new_version = read_version(self.app)
        self.restart()
        if self.healthy(new_version):
            self.state.update({"version": new_version, "commit": target[:7], "message": f"Mis à jour en {new_version}.", "deployedAt": now()})
            log(self.state, "deployed", f"Version {old_version} → {new_version} installée et vérifiée.", commit=target[:7])
            self.save()
            refresh_termux_command(self.app, changed)
            return "deployed-self" if any(f in changed for f in SELF_FILES) else "deployed"
        # Contrôle de santé raté : retour à la version qui marchait.
        git(self.app, "reset", "--hard", "--quiet", head)
        if "requirements.txt" in changed:
            self.pip(self.app)
        self.restart()
        self.state.setdefault("bad", []).append(target)
        self.state["bad"] = self.state["bad"][-20:]
        self.state.update({"version": old_version, "commit": head[:7]})
        self.state["message"] = f"La version {new_version} ne démarrait pas : retour automatique à {old_version}."
        log(self.state, "rollback", self.state["message"], commit=target[:7])
        self.save()
        return "rollback"


def install_requirements(app: Path) -> None:
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", str(app / "requirements.txt")], check=False, timeout=600)


def refresh_termux_command(app: Path, changed: list[str]) -> None:
    """Sur un téléphone (Termux), la commande « parquet » est une copie : on la remplace si elle a changé."""
    prefix = os.environ.get("PREFIX")
    if not prefix or "android/parquet" not in changed:
        return
    dest = Path(prefix) / "bin" / "parquet"
    if not dest.exists():
        return
    tmp = dest.with_name(".parquet.new")
    shutil.copyfile(app / "android" / "parquet", tmp)
    tmp.chmod(0o755)
    tmp.replace(dest)


# ---------------------------------------------------------------------------
# Le superviseur
# ---------------------------------------------------------------------------


def health(port: int, expected: str, timeout: int = HEALTH_TIMEOUT) -> bool:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sante", timeout=3) as r:
                if (json.load(r).get("data") or {}).get("version") == expected:
                    return True
        except (urllib.error.URLError, OSError, ValueError):
            pass
        time.sleep(1)
    return False


def supervise(child_args: list[str], port: int) -> int:
    child: subprocess.Popen | None = None
    stopping = False

    def start() -> None:
        nonlocal child
        child = subprocess.Popen([sys.executable, str(APP_DIR / "run.py"), *child_args], cwd=str(APP_DIR))

    def stop() -> None:
        nonlocal child
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        child = None

    def restart() -> None:
        stop()
        time.sleep(1)  # le port se libère
        start()

    def on_signal(signum, _frame) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    deployer = Deployer(APP_DIR, restart, lambda v: health(port, v))
    print(f"Mises à jour automatiques activées : vérification toutes les {INTERVAL // 60} minutes (tests GitHub obligatoires).", flush=True)
    start()
    next_check = time.monotonic() + 60
    backoff = 3
    while not stopping:
        time.sleep(1)
        if stopping:
            break
        if child is not None and child.poll() is not None:
            # Le serveur s'est arrêté tout seul : on le relance, avec une attente qui grandit.
            log(deployer.state, "crash", f"Le serveur s'est arrêté (code {child.returncode}) : relance dans {backoff} s.")
            deployer.save()
            child = None
            for _ in range(backoff):
                if stopping:
                    break
                time.sleep(1)
            if stopping:
                break
            backoff = min(backoff * 2, 120)
            start()
            continue
        if time.monotonic() >= next_check:
            next_check = time.monotonic() + INTERVAL
            backoff = 3
            try:
                outcome = deployer.check()
            except Exception as exc:  # noqa: BLE001 - le superviseur ne doit jamais tomber
                log(deployer.state, "error", f"Vérification impossible : {exc}")
                deployer.save()
                continue
            if outcome == "deployed-self":
                # Le superviseur a changé : il se relance lui-même (le serveur aussi, brièvement).
                stop()
                os.execv(sys.executable, [sys.executable, str(APP_DIR / "run.py"), *sys.argv[1:]])
    stop()
    deployer.state["active"] = False
    deployer.state["message"] = "Arrêté."
    deployer.save()
    return 0
