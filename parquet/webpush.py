"""Envoi de notifications Web Push (RFC 8030), chiffrées (RFC 8291) et signées VAPID (RFC 8292).

Aucune dépendance obligatoire : si la bibliothèque `cryptography` est installée, elle fait les calculs ;
sinon, une implémentation en Python pur prend le relais (courbe P-256, ECDSA, AES-128-GCM). C'est le cas
sur un téléphone Android (Termux), où `cryptography` s'installe mal. Les deux voies sont vérifiées par
les tests sur les vecteurs officiels de la RFC 8291 et l'une contre l'autre.

Le Python pur n'est pas « à temps constant » : acceptable ici (des notifications de scores, signées
par un serveur personnel), à ne pas réutiliser pour protéger des secrets importants.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

try:  # voie rapide, si disponible
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    HAVE_CRYPTOGRAPHY = True
except ImportError:  # pragma: no cover - dépend de l'appareil
    HAVE_CRYPTOGRAPHY = False

USE_CRYPTOGRAPHY = HAVE_CRYPTOGRAPHY and os.environ.get("PARQUET_PUSH_PUR") != "1"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64u(text: str) -> bytes:
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------------------------------------------------------------------------
# Courbe P-256 (secp256r1) en Python pur
# ---------------------------------------------------------------------------

P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _jdouble(pt):
    x, y, z = pt
    if not y:
        return (0, 1, 0)
    ysq = y * y % P
    s = 4 * x * ysq % P
    zsq = z * z % P
    m = 3 * (x - zsq) * (x + zsq) % P  # a = -3
    nx = (m * m - 2 * s) % P
    ny = (m * (s - nx) - 8 * ysq * ysq) % P
    nz = 2 * y * z % P
    return (nx, ny, nz)


def _jadd(p1, p2):
    if not p1[2]:
        return p2
    if not p2[2]:
        return p1
    x1, y1, z1 = p1
    x2, y2, z2 = p2
    z1s, z2s = z1 * z1 % P, z2 * z2 % P
    u1, u2 = x1 * z2s % P, x2 * z1s % P
    s1, s2 = y1 * z2s * z2 % P, y2 * z1s * z1 % P
    if u1 == u2:
        return _jdouble(p1) if s1 == s2 else (0, 1, 0)
    h = (u2 - u1) % P
    r = (s2 - s1) % P
    h2 = h * h % P
    h3 = h * h2 % P
    u1h2 = u1 * h2 % P
    nx = (r * r - h3 - 2 * u1h2) % P
    ny = (r * (u1h2 - nx) - s1 * h3) % P
    nz = h * z1 * z2 % P
    return (nx, ny, nz)


def _mul(k: int, point=G):
    result = (0, 1, 0)
    addend = (point[0], point[1], 1)
    while k:
        if k & 1:
            result = _jadd(result, addend)
        addend = _jdouble(addend)
        k >>= 1
    x, y, z = result
    if not z:
        raise ValueError("point à l'infini")
    zi = pow(z, P - 2, P)
    return (x * zi * zi % P, y * zi * zi * zi % P)


def _on_curve(pt) -> bool:
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def _encode_point(pt) -> bytes:
    return b"\x04" + pt[0].to_bytes(32, "big") + pt[1].to_bytes(32, "big")


def _decode_point(data: bytes):
    if len(data) != 65 or data[0] != 4:
        raise ValueError("clé publique P-256 invalide")
    pt = (int.from_bytes(data[1:33], "big"), int.from_bytes(data[33:], "big"))
    if not _on_curve(pt):
        raise ValueError("clé publique hors de la courbe P-256")
    return pt


def _rfc6979_k(priv: int, digest: bytes) -> int:
    """Nonce ECDSA déterministe (RFC 6979, SHA-256) : jamais de nonce faible ou répété."""
    x = priv.to_bytes(32, "big")
    h1 = (int.from_bytes(digest, "big") % N).to_bytes(32, "big")
    v, k = b"\x01" * 32, b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + x + h1, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + x + h1, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        cand = int.from_bytes(v, "big")
        if 1 <= cand < N:
            return cand
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


# ---------------------------------------------------------------------------
# AES-128-GCM en Python pur
# ---------------------------------------------------------------------------


def _build_sbox() -> list[int]:
    sbox = [0] * 256
    p = q = 1
    while True:  # parcours du groupe multiplicatif de GF(2^8) : p * 3, q / 3
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        rot = lambda v, s: ((v << s) | (v >> (8 - s))) & 0xFF  # noqa: E731
        sbox[p] = q ^ rot(q, 1) ^ rot(q, 2) ^ rot(q, 3) ^ rot(q, 4) ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


SBOX = _build_sbox()


def _xtime(b: int) -> int:
    return ((b << 1) ^ 0x1B) & 0xFF if b & 0x80 else b << 1


def _expand_key(key: bytes) -> list[list[int]]:
    words = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    rcon = 1
    for i in range(4, 44):
        t = list(words[i - 1])
        if i % 4 == 0:
            t = [SBOX[b] for b in t[1:] + t[:1]]
            t[0] ^= rcon
            rcon = _xtime(rcon)
        words.append([a ^ b for a, b in zip(words[i - 4], t)])
    return [sum(words[r * 4:r * 4 + 4], []) for r in range(11)]


def _aes_block(round_keys: list[list[int]], block: bytes) -> bytes:
    s = [b ^ k for b, k in zip(block, round_keys[0])]
    for rnd in range(1, 11):
        s = [SBOX[b] for b in s]
        # ShiftRows (état en colonnes : octet i = ligne i % 4, colonne i // 4)
        s = [s[(i + 4 * (i % 4)) % 16] for i in range(16)]
        if rnd != 10:
            out = []
            for c in range(4):
                a = s[4 * c:4 * c + 4]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                out += [a[i] ^ t ^ _xtime(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
            s = out
        s = [b ^ k for b, k in zip(s, round_keys[rnd])]
    return bytes(s)


def _gmul(x: int, y: int) -> int:
    r = 0xE1 << 120
    z = 0
    for i in range(127, -1, -1):
        if (y >> i) & 1:
            z ^= x
        x = (x >> 1) ^ r if x & 1 else x >> 1
    return z


def _aesgcm_encrypt(key: bytes, nonce: bytes, data: bytes) -> bytes:
    rk = _expand_key(key)
    h = int.from_bytes(_aes_block(rk, b"\x00" * 16), "big")
    j0 = nonce + b"\x00\x00\x00\x01"
    out = bytearray()
    for i in range(0, len(data), 16):
        counter = nonce + struct.pack(">I", 2 + i // 16)
        ks = _aes_block(rk, counter)
        out += bytes(a ^ b for a, b in zip(data[i:i + 16], ks))
    ghash = 0
    padded = bytes(out) + b"\x00" * (-len(out) % 16)
    for i in range(0, len(padded), 16):
        ghash = _gmul(ghash ^ int.from_bytes(padded[i:i + 16], "big"), h)
    ghash = _gmul(ghash ^ (len(out) * 8), h)  # longueurs : données associées 0, texte chiffré
    tag = (ghash ^ int.from_bytes(_aes_block(rk, j0), "big")).to_bytes(16, "big")
    return bytes(out) + tag


# ---------------------------------------------------------------------------
# Opérations utilisées par Web Push (voie rapide ou Python pur)
# ---------------------------------------------------------------------------


def new_private_key() -> int:
    return secrets.randbelow(N - 1) + 1


def public_key(priv: int) -> bytes:
    if USE_CRYPTOGRAPHY:
        key = ec.derive_private_key(priv, ec.SECP256R1())
        return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _encode_point(_mul(priv))


def ecdh(priv: int, peer_public: bytes) -> bytes:
    if USE_CRYPTOGRAPHY:
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), peer_public)
        return ec.derive_private_key(priv, ec.SECP256R1()).exchange(ec.ECDH(), peer)
    return _mul(priv, _decode_point(peer_public))[0].to_bytes(32, "big")


def sign_es256(priv: int, message: bytes) -> bytes:
    if USE_CRYPTOGRAPHY:
        der = ec.derive_private_key(priv, ec.SECP256R1()).sign(message, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
    else:
        digest = hashlib.sha256(message).digest()
        z = int.from_bytes(digest, "big")
        k = _rfc6979_k(priv, digest)
        r = _mul(k)[0] % N
        s = pow(k, N - 2, N) * (z + r * priv) % N
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def aesgcm(key: bytes, nonce: bytes, data: bytes) -> bytes:
    if USE_CRYPTOGRAPHY:
        return AESGCM(key).encrypt(nonce, data, None)
    return _aesgcm_encrypt(key, nonce, data)


def _hmac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def encrypt(payload: bytes, ua_public: bytes, auth_secret: bytes, *, sender_private: int | None = None, salt: bytes | None = None) -> bytes:
    """Corps chiffré « aes128gcm » d'une notification (RFC 8291 §3.4), un seul enregistrement."""
    if len(payload) > 3993:
        raise ValueError("notification trop longue")
    as_private = sender_private or new_private_key()
    as_public = public_key(as_private)
    salt = salt or secrets.token_bytes(16)
    ecdh_secret = ecdh(as_private, ua_public)
    prk_key = _hmac(auth_secret, ecdh_secret)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01")
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    header = salt + struct.pack(">I", 4096) + bytes([len(as_public)]) + as_public
    return header + aesgcm(cek, nonce, payload + b"\x02")


# ---------------------------------------------------------------------------
# VAPID et envoi
# ---------------------------------------------------------------------------


class Vapid:
    """Paire de clés du serveur, présentée aux services de notification (Google, Mozilla, Apple)."""

    def __init__(self, private: int, subject: str = "mailto:parquet@localhost"):
        self.private = private
        self.public = public_key(private)
        self.subject = subject
        self._tokens: dict[str, tuple[float, str]] = {}

    @classmethod
    def load_or_create(cls, path, subject: str = "mailto:parquet@localhost") -> "Vapid":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return cls(int(data["private"], 16), subject)
        except (OSError, ValueError, KeyError):
            vapid = cls(new_private_key(), subject)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"private": f"{vapid.private:064x}"}), encoding="utf-8")
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
            return vapid

    @property
    def public_b64(self) -> str:
        return b64u(self.public)

    def authorization(self, endpoint: str) -> str:
        parts = urlsplit(endpoint)
        audience = f"{parts.scheme}://{parts.netloc}"
        cached = self._tokens.get(audience)
        if cached and cached[0] > time.time() + 600:
            token = cached[1]
        else:
            exp = int(time.time()) + 12 * 3600
            head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
            body = b64u(json.dumps({"aud": audience, "exp": exp, "sub": self.subject}, separators=(",", ":")).encode())
            signature = b64u(sign_es256(self.private, f"{head}.{body}".encode()))
            token = f"{head}.{body}.{signature}"
            self._tokens[audience] = (exp, token)
        return f"vapid t={token}, k={self.public_b64}"


class Gone(Exception):
    """L'abonnement n'existe plus (appareil désabonné, appli désinstallée) : à supprimer."""


def send(vapid: Vapid, subscription: dict, message: dict, ttl: int = 3600, urgency: str = "high") -> int:
    endpoint = subscription["endpoint"]
    host = urlsplit(endpoint).hostname or ""
    if not (endpoint.startswith("https://") or host in ("127.0.0.1", "localhost")):  # local : tests
        raise ValueError("adresse de notification invalide")
    keys = subscription.get("keys") or {}
    body = encrypt(json.dumps(message, ensure_ascii=False).encode("utf-8"), unb64u(keys["p256dh"]), unb64u(keys["auth"]))
    req = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": str(ttl),
        "Urgency": urgency,
        "Authorization": vapid.authorization(endpoint),
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            raise Gone(endpoint) from exc
        raise
