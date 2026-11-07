"""Déploiement automatique : seulement après les tests GitHub, avec retour arrière si la nouvelle
version ne démarre pas. Un dépôt « GitHub » est simulé localement (dépôt nu + clone)."""

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from parquet import autodeploy

ROOT = Path(__file__).resolve().parent.parent


def sh(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})


class DeployerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.origin, self.seed, self.app = base / "origin.git", base / "seed", base / "app"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)], check=True)
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.seed)], check=True)
        self.write("parquet/__init__.py", '__version__ = "1.0.0"\n')
        self.write("requirements.txt", "")
        self.write("web/page.txt", "v1\n")
        self.commit("v1")
        sh(self.seed, "remote", "add", "origin", str(self.origin))
        sh(self.seed, "push", "-q", "origin", "main")
        subprocess.run(["git", "clone", "-q", str(self.origin), str(self.app)], check=True)
        self.restarts, self.pips = 0, 0
        self.ci_answer, self.health_answer = "success", True
        self.deployer = autodeploy.Deployer(
            self.app, restart=self.on_restart, healthy=lambda v: self.health_answer,
            ci=lambda slug, sha: self.ci_answer, state_path=base / "state.json", pip=self.on_pip,
        )

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.seed / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self, msg):
        sh(self.seed, "add", "-A")
        sh(self.seed, "commit", "-q", "-m", msg)

    def publish(self, version, req=None):
        self.write("parquet/__init__.py", f'__version__ = "{version}"\n')
        self.write("web/page.txt", f"{version}\n")
        if req is not None:
            self.write("requirements.txt", req)
        self.commit(version)
        sh(self.seed, "push", "-q", "origin", "main")

    def on_restart(self):
        self.restarts += 1

    def on_pip(self, app):
        self.pips += 1

    def version(self):
        return autodeploy.read_version(self.app)

    def test_up_to_date_does_nothing(self):
        self.assertEqual(self.deployer.check(), "uptodate")
        self.assertEqual(self.restarts, 0)

    def test_waits_for_github_tests_and_ignores_failed_ones(self):
        self.publish("1.1.0")
        self.ci_answer = "pending"
        self.assertEqual(self.deployer.check(), "ci-pending")
        self.assertEqual(self.version(), "1.0.0")
        self.ci_answer = "failure"
        self.assertEqual(self.deployer.check(), "ci-failure")
        self.assertEqual(self.version(), "1.0.0")
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.deployer.state["events"][0]["kind"], "ci-failed")

    def test_green_version_is_installed_and_checked(self):
        self.publish("1.1.0")
        self.assertEqual(self.deployer.check(), "deployed")
        self.assertEqual(self.version(), "1.1.0")
        self.assertEqual(self.restarts, 1)
        self.assertEqual(self.pips, 0)  # requirements.txt n'a pas changé
        state = json.loads((Path(self.tmp.name) / "state.json").read_text())
        self.assertEqual(state["version"], "1.1.0")
        self.assertEqual(state["events"][0]["kind"], "deployed")
        self.assertEqual(self.deployer.check(), "uptodate")

    def test_new_libraries_are_installed(self):
        self.publish("1.1.0", req="exemple==1.0\n")
        self.assertEqual(self.deployer.check(), "deployed")
        self.assertEqual(self.pips, 1)

    def test_broken_version_is_rolled_back_and_not_retried(self):
        self.publish("1.1.0")
        self.health_answer = False
        self.assertEqual(self.deployer.check(), "rollback")
        self.assertEqual(self.version(), "1.0.0")
        self.assertEqual((self.app / "web" / "page.txt").read_text(), "v1\n")
        self.assertEqual(self.restarts, 2)  # nouvelle version, puis retour à l'ancienne
        self.assertEqual(self.deployer.check(), "known-bad")
        self.assertEqual(self.restarts, 2)
        # Une version corrigée est installée normalement.
        self.health_answer = True
        self.publish("1.1.1")
        self.assertEqual(self.deployer.check(), "deployed")
        self.assertEqual(self.version(), "1.1.1")

    def test_local_edits_block_the_update_without_losing_them(self):
        (self.app / "web" / "page.txt").write_text("modifié à la main\n")
        self.publish("1.1.0")
        self.assertEqual(self.deployer.check(), "blocked")
        self.assertEqual((self.app / "web" / "page.txt").read_text(), "modifié à la main\n")
        self.assertEqual(self.restarts, 0)

    def test_offline(self):
        sh(self.app, "remote", "set-url", "origin", str(Path(self.tmp.name) / "absent.git"))
        self.assertEqual(self.deployer.check(), "offline")


class HelpersTests(unittest.TestCase):
    def test_ci_verdict(self):
        ok = {"status": "completed", "conclusion": "success"}
        self.assertEqual(autodeploy.ci_verdict([]), "pending")
        self.assertEqual(autodeploy.ci_verdict([ok, {"status": "in_progress"}]), "pending")
        self.assertEqual(autodeploy.ci_verdict([ok, {"status": "completed", "conclusion": "skipped"}]), "success")
        self.assertEqual(autodeploy.ci_verdict([ok, {"status": "completed", "conclusion": "failure"}]), "failure")

    def test_repo_slug(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            for url in ("https://github.com/NoanHeinry/parquet-nba.git", "git@github.com:NoanHeinry/parquet-nba.git", "https://github.com/NoanHeinry/parquet-nba"):
                subprocess.run(["git", "-C", d, "remote", "remove", "origin"], capture_output=True)
                subprocess.run(["git", "-C", d, "remote", "add", "origin", url], check=True)
                self.assertEqual(autodeploy.repo_slug(Path(d)), "NoanHeinry/parquet-nba")

    def test_public_state_hides_dead_supervisor(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "s.json"
            autodeploy.save_state({"active": True, "pid": 999999, "bad": ["x"], "version": "1"}, path)
            state = autodeploy.public_state(path)
            self.assertFalse(state["active"])
            self.assertNotIn("bad", state)
            autodeploy.save_state({"active": True, "pid": os.getpid()}, path)
            self.assertTrue(autodeploy.public_state(path)["active"])


class SupervisorTests(unittest.TestCase):
    def test_supervisor_runs_the_server_and_stops_cleanly(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / "deploiement.json"
            env = {**os.environ, "PARQUET_ETAT_DEPLOIEMENT": str(state), "PARQUET_ACCES": "code-secret"}
            proc = subprocess.Popen([sys.executable, str(ROOT / "run.py"), "--demo", "--no-browser", "--port", str(port), "--port-fixe", "--auto-maj"],
                                    cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                data = None
                end = time.time() + 30
                while time.time() < end:
                    try:
                        # /api/sante répond même quand un code d'accès protège le reste.
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sante", timeout=2) as r:
                            data = json.load(r)["data"]
                            break
                    except OSError:
                        time.sleep(0.3)
                self.assertIsNotNone(data, "le serveur supervisé n'a pas démarré")
                self.assertEqual(data["version"], autodeploy.read_version(ROOT))
                self.assertTrue(json.loads(state.read_text())["active"])
                proc.send_signal(signal.SIGTERM)
                out, _ = proc.communicate(timeout=30)
            finally:
                if proc.poll() is None:
                    proc.kill()
            self.assertEqual(proc.returncode, 0)
            self.assertIn("Mises à jour automatiques activées", out)
            self.assertFalse(json.loads(state.read_text())["active"])
            with self.assertRaises(OSError):
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/sante", timeout=2)


if __name__ == "__main__":
    unittest.main()
