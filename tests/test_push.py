"""Notifications push : chiffrement (RFC 8291), signature VAPID (RFC 8292), abonnements, alertes de match.

Un faux service de notification local reçoit les envois ; chaque message est déchiffré ici avec la clé
privée de l'« appareil », par un code écrit séparément (bibliothèque cryptography), et la signature
VAPID est vérifiée de la même façon.
"""

import base64
import hashlib
import hmac
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from parquet import push, webpush

try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    HAVE = True
except ImportError:  # pragma: no cover
    HAVE = False


def b64d(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Device:
    """Un navigateur abonné : sa paire de clés et son secret d'authentification."""

    def __init__(self, endpoint):
        self.private = ec.generate_private_key(ec.SECP256R1())
        self.public = self.private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.auth = b"0123456789abcdef"
        self.subscription = {"endpoint": endpoint, "keys": {"p256dh": webpush.b64u(self.public), "auth": webpush.b64u(self.auth)}}

    def decrypt(self, body):
        salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
        as_public = body[21:21 + idlen]
        ciphertext = body[21 + idlen:]
        assert rs == 4096 and idlen == 65
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public)
        secret = self.private.exchange(ec.ECDH(), peer)
        mac = lambda k, d: hmac.new(k, d, hashlib.sha256).digest()  # noqa: E731
        ikm = mac(mac(self.auth, secret), b"WebPush: info\x00" + self.public + as_public + b"\x01")
        prk = mac(salt, ikm)
        cek = mac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
        nonce = mac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
        plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
        assert plain.endswith(b"\x02")
        return json.loads(plain[:-1].decode("utf-8"))


class FakePushService:
    """Service de notification local : enregistre chaque envoi, ou répond par un code imposé."""

    def __init__(self):
        self.received = []
        self.status = 201
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.received.append((self.path, dict(self.headers), body))
                self.send_response(outer.status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@unittest.skipUnless(HAVE, "cryptography sert à vérifier les envois")
class WebPushTests(unittest.TestCase):
    RFC = {
        "plaintext": b"When I grow up, I want to be a watermelon",
        "as_private": "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
        "ua_public": "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        "auth": "BTBZMqHH6r4Tts7J_aSIgg",
        "salt": "DGv6ra1nlYgDCS1FRnbzlw",
        "body": "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    }

    def setUp(self):
        self.saved = webpush.USE_CRYPTOGRAPHY

    def tearDown(self):
        webpush.USE_CRYPTOGRAPHY = self.saved

    def test_rfc8291_vector_both_implementations(self):
        r = self.RFC
        for fast in (False, True):
            webpush.USE_CRYPTOGRAPHY = fast
            body = webpush.encrypt(r["plaintext"], b64d(r["ua_public"]), b64d(r["auth"]), sender_private=int.from_bytes(b64d(r["as_private"]), "big"), salt=b64d(r["salt"]))
            self.assertEqual(webpush.b64u(body), r["body"], "cryptography" if fast else "Python pur")

    def test_pure_python_primitives_match_cryptography(self):
        import secrets

        rk = webpush._expand_key(bytes.fromhex("000102030405060708090a0b0c0d0e0f"))
        self.assertEqual(webpush._aes_block(rk, bytes.fromhex("00112233445566778899aabbccddeeff")).hex(), "69c4e0d86a7b0430d8cdb78070b4c55a")  # FIPS-197
        for n in (0, 1, 16, 17, 250):
            k, iv, d = secrets.token_bytes(16), secrets.token_bytes(12), secrets.token_bytes(n)
            self.assertEqual(webpush._aesgcm_encrypt(k, iv, d), AESGCM(k).encrypt(iv, d, None))
        a, b = webpush.new_private_key(), webpush.new_private_key()
        ref = ec.derive_private_key(a, ec.SECP256R1())
        self.assertEqual(webpush._encode_point(webpush._mul(a)), ref.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        pb = webpush._encode_point(webpush._mul(b))
        self.assertEqual(webpush._mul(a, webpush._decode_point(pb))[0].to_bytes(32, "big"), ref.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pb)))
        with self.assertRaises(ValueError):
            webpush._decode_point(b"\x04" + b"\x01" * 64)  # hors de la courbe

    def test_vapid_signature_is_valid_in_both_implementations(self):
        for fast in (False, True):
            webpush.USE_CRYPTOGRAPHY = fast
            vapid = webpush.Vapid(webpush.new_private_key(), "https://parquet-nba.fr")
            header = vapid.authorization("https://fcm.googleapis.com/fcm/send/abc")
            token = header.split("t=")[1].split(",")[0]
            k = header.split("k=")[1]
            head, body, sig = token.split(".")
            claims = json.loads(b64d(body))
            self.assertEqual(claims["aud"], "https://fcm.googleapis.com")
            self.assertEqual(claims["sub"], "https://parquet-nba.fr")
            pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b64d(k))
            raw = b64d(sig)
            pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")), f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))


def game(gid, status, away=(1610612738, "BOS", "Boston", "Celtics", 0), home=(1610612747, "LAL", "Los Angeles", "Lakers", 0), period=0, clock=""):
    side = lambda t: {"id": t[0], "tri": t[1], "city": t[2], "name": t[3], "score": t[4]}  # noqa: E731
    return {"id": gid, "status": status, "period": period, "clock": clock, "away": side(away), "home": side(home)}


@unittest.skipUnless(HAVE, "cryptography sert à vérifier les envois")
class AlertTests(unittest.TestCase):
    BOS, LAL = 1610612738, 1610612747

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.service = FakePushService()
        self.store = push.Store(Path(self.tmp.name))
        self.board = {"games": []}
        self.box = {}
        self.deploy = {"events": []}
        self.devices = {}

    def tearDown(self):
        self.service.close()
        self.tmp.cleanup()

    def device(self, name, **prefs):
        d = Device(f"{self.service.base}/{name}")
        self.store.subscribe(d.subscription, prefs)
        self.devices[name] = d
        return d

    def watcher(self):
        return push.Watcher(self.store, scoreboard=lambda: self.board, box=lambda gid: self.box, deploy_state=lambda: self.deploy)

    def inbox(self):
        out = {}
        for path, headers, body in self.service.received:
            name = path.strip("/")
            self.assertEqual(headers["Content-Encoding"], "aes128gcm")
            self.assertTrue(headers["Authorization"].startswith("vapid t="))
            out.setdefault(name, []).append(self.devices[name].decrypt(body))
        self.service.received.clear()
        return out

    def test_match_alerts_follow_each_device_preferences(self):
        self.device("fan", teams=[self.BOS])
        self.device("tous", teams=[], clutchAll=True)
        self.device("calme", teams=[self.BOS], spoiler=True, perf=True)
        w = self.watcher()
        self.board = {"games": [game("001", 1)]}
        w.tick()  # premier passage : relevé seulement
        self.assertEqual(self.inbox(), {})

        self.board = {"games": [game("001", 2, period=1, clock="12:00")]}
        w.tick()
        box = self.inbox()
        self.assertEqual(sorted(box), ["calme", "fan"])  # favoris seulement
        self.assertEqual(box["fan"][0]["title"], "Coup d'envoi : BOS – LAL")
        self.assertEqual(box["fan"][0]["url"], "#/match/001")

        self.board = {"games": [game("001", 2, away=(self.BOS, "BOS", "Boston", "Celtics", 101), home=(self.LAL, "LAL", "Los Angeles", "Lakers", 99), period=4, clock="2:31")]}
        w.tick()
        w.tick()  # pas de doublon
        box = self.inbox()
        self.assertEqual(sorted(box), ["calme", "fan", "tous"])
        self.assertEqual(box["fan"][0]["title"], "Fin de match serrée : BOS 101 – 99 LAL")
        self.assertNotIn("101", box["calme"][0]["title"])  # mode sans spoiler : pas de score

        self.box = {"teams": {
            "away": {"name": "Celtics", "players": [{"id": 1, "name": "Jayson Tatum", "pts": 42, "reb": 9, "ast": 6}]},
            "home": {"name": "Lakers", "players": [{"id": 2, "name": "LeBron James", "pts": 25, "reb": 11, "ast": 12}]},
        }}
        self.board = {"games": [game("001", 3, away=(self.BOS, "BOS", "Boston", "Celtics", 110), home=(self.LAL, "LAL", "Los Angeles", "Lakers", 104), period=4)]}
        w.tick()
        box = self.inbox()
        fan_titles = [m["title"] for m in box["fan"]]
        self.assertIn("Fin du match : BOS 110 – 104 LAL", fan_titles)
        self.assertIn("Grosse performance : Jayson Tatum", fan_titles)
        self.assertIn("Triple-double : LeBron James", fan_titles)
        self.assertEqual([m["title"] for m in box["calme"]], ["Match terminé : Celtics – Lakers"])  # pas de score, pas de performance
        self.assertNotIn("Fin du match : BOS 110 – 104 LAL", [m["title"] for m in box["tous"]])  # résultat : favoris seulement

        # Redémarrage du serveur : rien n'est renvoyé.
        w2 = self.watcher()
        w2.tick()
        w2.tick()
        self.assertEqual(self.inbox(), {})

    def test_final_score_of_every_game_for_morning_readers(self):
        # Option « score final de tous les matchs » : un résultat par match, même sans équipe favorite.
        self.device("reveil", teams=[], finalAll=True, perf=False)
        self.device("fan", teams=[self.BOS], perf=False)
        w = self.watcher()
        self.board = {"games": [game("001", 2, period=4), game("002", 2, period=4)]}
        w.tick()  # premier passage : relevé seulement
        self.inbox()
        self.board = {"games": [
            game("001", 3, away=(self.BOS, "BOS", "Boston", "Celtics", 110), home=(self.LAL, "LAL", "Los Angeles", "Lakers", 104), period=4),
            game("002", 3, away=(1610612759, "SAS", "San Antonio", "Spurs", 122), home=(1610612756, "PHX", "Phoenix", "Suns", 96), period=5),
        ]}
        w.tick()
        w.tick()  # pas de doublon
        box = self.inbox()
        self.assertEqual([m["title"] for m in box["reveil"]], ["Fin du match : BOS 110 – 104 LAL", "Fin du match : SAS 122 – 96 PHX"])
        self.assertEqual(box["reveil"][1]["body"], "Victoire des Spurs contre les Suns après prolongation.")
        self.assertEqual(box["reveil"][1]["url"], "#/match/002")
        # Sans l'option : seulement le match de son équipe favorite.
        self.assertEqual([m["title"] for m in box["fan"]], ["Fin du match : BOS 110 – 104 LAL"])

    def test_server_alerts_only_for_devices_that_want_them(self):
        self.device("admin", server=True)
        self.device("fan", teams=[self.BOS])
        w = self.watcher()
        self.deploy = {"events": [{"at": "2000-01-01T00:00:00+00:00", "kind": "rollback", "message": "ancien"}]}
        w.tick()
        self.assertEqual(self.inbox(), {})  # historique antérieur à l'activation : ignoré
        self.deploy["events"].insert(0, {"at": "2999-01-01T00:00:00+00:00", "kind": "rollback", "message": "La version 9.9.9 ne démarrait pas : retour automatique à 9.9.8."})
        w.tick()
        box = self.inbox()
        self.assertEqual(list(box), ["admin"])
        self.assertEqual(box["admin"][0]["title"], "Parquet : mise à jour annulée")
        w.tick()
        self.assertEqual(self.inbox(), {})

    def test_gone_subscription_is_removed_and_invalid_ones_refused(self):
        self.device("parti", teams=[self.BOS])
        sid = next(iter(self.store.subs))
        self.service.status = 410
        self.assertFalse(self.store.deliver(sid, {"title": "x"}))
        self.assertEqual(self.store.subs, {})
        self.assertEqual(json.loads((Path(self.tmp.name) / "push.json").read_text())["subs"], {})
        with self.assertRaises(ValueError):
            self.store.subscribe({"endpoint": "ftp://x", "keys": {}}, {})
        with self.assertRaises(ValueError):
            self.store.subscribe({"endpoint": "https://push.example/x", "keys": {"p256dh": "abc", "auth": "def"}}, {})

    def test_prefs_are_cleaned(self):
        prefs = push.clean_prefs({"teams": ["1610612738", "x", 5], "server": 1, "inconnu": True})
        self.assertEqual(prefs["teams"], [5, 1610612738])
        self.assertTrue(prefs["server"])
        self.assertNotIn("inconnu", prefs)

    def test_vapid_key_is_kept_between_restarts(self):
        again = push.Store(Path(self.tmp.name))
        self.assertEqual(again.vapid.public_b64, self.store.vapid.public_b64)


@unittest.skipUnless(HAVE, "cryptography sert à vérifier les envois")
class AlertTestsPurePython(AlertTests):
    """Mêmes envois avec le chiffrement en Python pur : celui d'un téléphone Android sans « cryptography »."""

    def setUp(self):
        super().setUp()
        self.saved = webpush.USE_CRYPTOGRAPHY
        webpush.USE_CRYPTOGRAPHY = False

    def tearDown(self):
        webpush.USE_CRYPTOGRAPHY = self.saved
        super().tearDown()


@unittest.skipUnless(HAVE, "cryptography sert à vérifier les envois")
class PushApiTests(unittest.TestCase):
    """Routes HTTP : clé publique, abonnement (origine vérifiée), envoi de test."""

    def setUp(self):
        from parquet import access, demo, nba, settings
        from parquet.cache import Cache
        from parquet.server import make_server

        self.tmp = tempfile.TemporaryDirectory()
        demo.install()
        nba.init(Cache(Path(self.tmp.name) / "c.sqlite3"))
        settings.init(Path(self.tmp.name) / "settings.json")
        access.init(None, None)
        self.service = FakePushService()
        push.STORE = push.Store(Path(self.tmp.name))
        self.server = make_server("127.0.0.1", 0)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        from parquet import net

        self.server.shutdown()
        self.server.server_close()
        self.service.close()
        push.STORE = None
        net.DEMO = False
        self.tmp.cleanup()

    def post(self, path, body, origin=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Origin": origin or self.base})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as exc:
            return exc.code, json.load(exc)

    def test_subscribe_test_and_unsubscribe(self):
        with urllib.request.urlopen(self.base + "/api/push/cle") as r:
            key = json.load(r)["data"]
        self.assertTrue(key["available"])
        self.assertEqual(key["publicKey"], push.STORE.vapid.public_b64)
        d = Device(f"{self.service.base}/telephone")
        self.assertEqual(self.post("/api/push/abonnement", {"subscription": d.subscription, "prefs": {"teams": [1610612738]}}, origin="https://autre-site.fr")[0], 403)
        status, data = self.post("/api/push/abonnement", {"subscription": d.subscription, "prefs": {"teams": [1610612738], "perf": False}})
        self.assertEqual(status, 200)
        self.assertEqual(data["data"]["prefs"]["teams"], [1610612738])
        self.assertFalse(data["data"]["prefs"]["perf"])
        status, _ = self.post("/api/push/test", {"endpoint": d.subscription["endpoint"]})
        self.assertEqual(status, 200)
        _path, _headers, body = self.service.received[-1]
        self.assertEqual(d.decrypt(body)["title"], "Parquet : notifications activées")
        self.assertEqual(self.post("/api/push/desabonnement", {"endpoint": d.subscription["endpoint"]})[1]["data"]["removed"], True)
        self.assertEqual(self.post("/api/push/test", {"endpoint": d.subscription["endpoint"]})[0], 404)


if __name__ == "__main__":
    unittest.main()
