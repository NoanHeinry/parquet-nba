"""Tests du lancement sur téléphone Android (Termux), dans un Termux simulé.

Les outils propres à Android (termux-open-url, termux-wake-lock…) sont remplacés par de petits
scripts qui notent leurs appels. Parquet tourne en mode démo : aucun accès réseau.
Lancer : python -m unittest tests.test_android -v
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import run

ROOT = Path(__file__).resolve().parent.parent
COMMAND = ROOT / "android" / "parquet"
INSTALLER = ROOT / "installer-android.sh"
POSIX = os.name == "posix" and shutil.which("bash") and shutil.which("pkill")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TermuxDetectionTests(unittest.TestCase):
    def test_detects_termux_from_prefix(self):
        with mock.patch.dict(os.environ, {"PREFIX": "/data/data/com.termux/files/usr"}):
            self.assertTrue(run.on_termux())
        with mock.patch.dict(os.environ, {"PREFIX": "/usr/local"}):
            self.assertFalse(run.on_termux())

    def test_opens_phone_browser_with_termux_open_url(self):
        with mock.patch.dict(os.environ, {"PREFIX": "/data/data/com.termux/files/usr"}), \
             mock.patch("run.shutil.which", return_value="/bin/termux-open-url"), \
             mock.patch("run.subprocess.run") as sp, mock.patch("run.webbrowser.open") as wb:
            run.open_browser("http://localhost:8765/")
        sp.assert_called_once_with(["/bin/termux-open-url", "http://localhost:8765/"], check=False)
        wb.assert_not_called()

    def test_computer_keeps_default_browser(self):
        with mock.patch.dict(os.environ, {"PREFIX": ""}), mock.patch("run.webbrowser.open") as wb:
            run.open_browser("http://localhost:8765/")
        wb.assert_called_once()


@unittest.skipUnless(POSIX, "nécessite bash et pkill")
class TermuxCommandTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        prefix = base / "data" / "data" / "com.termux" / "files" / "usr"
        (prefix / "bin").mkdir(parents=True)
        self.log = base / "log"
        self.log.touch()
        for tool in ("termux-open-url", "termux-wake-lock", "termux-wake-unlock"):
            stub = prefix / "bin" / tool
            stub.write_text(f'#!/bin/bash\necho "{tool} $*" >> "{self.log}"\n')
            stub.chmod(0o755)
        python = prefix / "bin" / "python"
        python.write_text(f'#!/bin/bash\nexec "{sys.executable}" "$@"\n')
        python.chmod(0o755)
        self.port = free_port()
        self.env = {
            **os.environ,
            "PREFIX": str(prefix),
            "HOME": str(base),
            "PATH": f"{prefix / 'bin'}:{os.environ.get('PATH', '')}",
            "PARQUET_DIR": str(ROOT),
            "PARQUET_PYTHON": sys.executable,
            "PARQUET_PORT": str(self.port),
        }

    def tearDown(self):
        self.parquet("stop")
        self.tmp.cleanup()

    def parquet(self, *args, timeout=20):
        return subprocess.run(["bash", str(COMMAND), *args], env=self.env, capture_output=True, text=True, timeout=timeout)

    def wait_for(self, text, timeout=20.0):
        end = time.time() + timeout
        while time.time() < end:
            if text in self.log.read_text():
                return True
            time.sleep(0.2)
        return False

    def test_start_open_reuse_and_stop(self):
        url = f"http://localhost:{self.port}/"
        server = subprocess.Popen(["bash", str(COMMAND), "demo"], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            self.assertTrue(self.wait_for(f"termux-open-url {url}"), "le navigateur du téléphone ne s'est pas ouvert")
            self.assertIn("termux-wake-lock", self.log.read_text())

            again = self.parquet()
            self.assertIn("tourne déjà", again.stdout)

            stopped = self.parquet("stop")
            self.assertIn("arrêté", stopped.stdout)
            out, _ = server.communicate(timeout=15)
        finally:
            if server.poll() is None:
                server.kill()
        self.assertIn("Tu peux passer au navigateur", out)
        self.assertIn("À bientôt", out)
        self.assertIn("termux-wake-unlock", self.log.read_text())

    def test_same_port_after_quick_restart(self):
        for _ in range(2):
            server = subprocess.Popen(["bash", str(COMMAND), "demo"], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            self.assertTrue(self.wait_for(f"localhost:{self.port}/"))
            self.log.write_text("")
            self.parquet("stop")
            out, _ = server.communicate(timeout=15)
            self.assertIn(f"localhost:{self.port}/", out)

    def test_server_mode_behind_access_code_and_boot_script(self):
        env = {**self.env, "PARQUET_ACCES": "code-secret"}
        server = subprocess.Popen(["bash", str(COMMAND), "serveur", "--demo"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            lines = []
            for line in server.stdout:
                lines.append(line)
                if "est lancé" in line:
                    break
            again = self.parquet("serveur")
            # Protégé par un code, Parquet répond 401 : la commande doit quand même le voir tourner.
            self.assertIn("tourne déjà", again.stdout)
            self.assertIn("termux-wake-lock", self.log.read_text())
            self.assertNotIn("termux-open-url", self.log.read_text())
            self.parquet("stop")
            out, _ = server.communicate(timeout=15)
        finally:
            if server.poll() is None:
                server.kill()
        self.assertIn("Protégé par un code d'accès", "".join(lines) + out)
        boot = Path(self.env["HOME"]) / ".termux" / "boot" / "parquet-serveur"
        self.assertIn("démarrera", self.parquet("demarrage", "oui").stdout)
        self.assertIn("exec parquet serveur", boot.read_text())
        self.assertIn("activé", self.parquet("demarrage").stdout)
        self.parquet("demarrage", "non")
        self.assertFalse(boot.exists())

    def test_access_code_is_stored_privately(self):
        self.assertEqual(self.parquet("code", "court").returncode, 2)
        self.assertIn("enregistré", self.parquet("code", "code-secret").stdout)
        stored = Path(self.env["HOME"]) / ".parquet-acces"
        self.assertEqual(stored.read_text(), "code-secret")
        self.assertEqual(stored.stat().st_mode & 0o777, 0o600)
        self.assertIn("activé", self.parquet("code").stdout)
        self.parquet("code", "aucun")
        self.assertFalse(stored.exists())

    def test_help_and_unknown_command(self):
        self.assertIn("parquet maj", self.parquet("aide").stdout)
        self.assertIn("parquet demarrage", self.parquet("aide").stdout)
        self.assertEqual(self.parquet("nimporte").returncode, 2)

    def test_scripts_are_valid_bash(self):
        for script in (COMMAND, INSTALLER, ROOT / "installer-serveur.sh", ROOT / "serveur" / "parquet-serveur"):
            self.assertEqual(subprocess.run(["bash", "-n", str(script)]).returncode, 0, script.name)

    def test_installer_refuses_outside_termux(self):
        env = {**self.env, "PREFIX": "/usr"}
        result = subprocess.run(["bash", str(INSTALLER)], env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Termux", result.stdout)


if __name__ == "__main__":
    unittest.main()
