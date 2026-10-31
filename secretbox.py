"""Chiffrement des mots de passe des sondes (bibliothèque standard uniquement).

Python n'offre pas AES sans dépendance : on utilise une construction classique à base de
HMAC-SHA256, qui est une fonction pseudo-aléatoire sûre :
  - flux de chiffrement : HMAC(clé_chiffrement, nonce || compteur), XOR avec le texte (mode CTR) ;
  - authentification : HMAC(clé_mac, version || nonce || texte chiffré) (encrypt-then-MAC).
Les deux sous-clés sont dérivées de la clé principale de 32 octets. Un nonce aléatoire de
16 octets est tiré à chaque chiffrement. Toute modification ou mauvaise clé est détectée.

Format stocké : "enc1:" + base64url(nonce || texte chiffré || étiquette).
"""
import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path

PREFIX = "enc1:"
NONCE = 16
TAG = 32
KEY_BYTES = 32
EXPORT_ROUNDS = 300_000  # PBKDF2 pour le mot de passe d'export


class DecryptError(ValueError):
    pass


class SecretBox:
    def __init__(self, key):
        if len(key) != KEY_BYTES:
            raise ValueError("la clé de chiffrement doit faire 32 octets")
        self._enc = hmac.new(key, b"monitoring/enc", hashlib.sha256).digest()
        self._mac = hmac.new(key, b"monitoring/mac", hashlib.sha256).digest()

    def _stream(self, nonce, length):
        out = bytearray()
        counter = 0
        while len(out) < length:
            out += hmac.new(self._enc, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
            counter += 1
        return bytes(out[:length])

    def _tag(self, nonce, ct):
        return hmac.new(self._mac, PREFIX.encode() + nonce + ct, hashlib.sha256).digest()

    def encrypt(self, text):
        if text is None or text == "":
            return None
        data = str(text).encode("utf-8")
        nonce = os.urandom(NONCE)
        ct = bytes(a ^ b for a, b in zip(data, self._stream(nonce, len(data))))
        return PREFIX + base64.urlsafe_b64encode(nonce + ct + self._tag(nonce, ct)).decode()

    def decrypt(self, value):
        if not value:
            return None
        if not is_encrypted(value):
            return value  # ancien mot de passe en clair (avant migration)
        try:
            raw = base64.urlsafe_b64decode(value[len(PREFIX):].encode())
        except (ValueError, TypeError):
            raise DecryptError("mot de passe chiffré illisible") from None
        if len(raw) < NONCE + TAG:
            raise DecryptError("mot de passe chiffré illisible")
        nonce, ct, tag = raw[:NONCE], raw[NONCE:-TAG], raw[-TAG:]
        if not hmac.compare_digest(tag, self._tag(nonce, ct)):
            raise DecryptError("clé de chiffrement différente ou donnée modifiée")
        data = bytes(a ^ b for a, b in zip(ct, self._stream(nonce, len(ct))))
        return data.decode("utf-8")

    def check_value(self):
        """Empreinte qui permet de vérifier qu'un mot de passe d'export est le bon."""
        return hmac.new(self._mac, b"monitoring/check", hashlib.sha256).hexdigest()


def is_encrypted(value):
    return isinstance(value, str) and value.startswith(PREFIX)


def load_key(path):
    """Lit la clé principale ; la crée (aléatoire) si le fichier n'existe pas encore."""
    path = Path(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        old = os.umask(0o077)
        try:
            with open(path, "x", encoding="utf-8") as f:
                f.write(secrets.token_hex(KEY_BYTES) + "\n")
        except OSError as e:
            raise SystemExit(f"Impossible de créer la clé de chiffrement {path} : {e}") from None
        finally:
            os.umask(old)
        print(f"Clé de chiffrement des mots de passe créée : {path} (à sauvegarder avec la base)")
    text = path.read_text(encoding="utf-8").strip()
    try:
        key = bytes.fromhex(text)
    except ValueError:
        key = b""
    if len(key) != KEY_BYTES:
        raise SystemExit(f"Clé de chiffrement invalide dans {path} (64 caractères hexadécimaux attendus)")
    return key


def export_box(password, salt=None, rounds=EXPORT_ROUNDS):
    """Boîte dérivée d'un mot de passe d'export (PBKDF2-SHA256)."""
    salt = salt or secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), rounds)
    return SecretBox(key), {"kdf": "pbkdf2_sha256", "rounds": rounds, "salt": salt}
