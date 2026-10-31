"""Stockage SQLite des sondes et de l'historique de leurs résultats."""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time

from secretbox import DecryptError, SecretBox, export_box, is_encrypted

HISTORY_KEEP = 1000  # résultats conservés par sonde
SESSION_DAYS = 30
PBKDF2_ROUNDS = 300_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS probes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    grp TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    interval_s INTEGER NOT NULL DEFAULT 120,
    config TEXT NOT NULL DEFAULT '{}',
    secret TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    probe_id INTEGER NOT NULL REFERENCES probes(id) ON DELETE CASCADE,
    ts REAL NOT NULL,
    status TEXT NOT NULL,
    value REAL,
    duration_ms INTEGER,
    summary TEXT,
    details TEXT
);
CREATE INDEX IF NOT EXISTS results_probe_ts ON results(probe_id, ts);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_used REAL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def check_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, AttributeError):
        return False


class Store:
    def __init__(self, path, box):
        # Mots de passe des sondes chiffrés avec la clé de l'installation (voir secretbox.py).
        self.box = box
        new = not os.path.exists(path)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.execute("PRAGMA secure_delete = ON")  # efface vraiment les anciennes valeurs
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()
        if new:
            try:
                os.chmod(path, 0o600)  # contient les mots de passe
            except OSError:
                pass

    def _seal(self, secret):
        return self.box.encrypt(secret) if secret else None

    def _open(self, stored):
        """Déchiffre un mot de passe ; None et un message d'erreur s'il est illisible."""
        try:
            return self.box.decrypt(stored), None
        except DecryptError as e:
            return None, f"Mot de passe illisible ({e}) : ressaisis-le dans la sonde"

    def encrypt_plain_secrets(self):
        """Chiffre les mots de passe encore en clair. Renvoie (chiffrés, illisibles)."""
        migrated = unreadable = 0
        with self.lock, self.db:
            for row in self.db.execute("SELECT id, secret FROM probes WHERE secret IS NOT NULL AND secret != ''").fetchall():
                if is_encrypted(row["secret"]):
                    unreadable += self._open(row["secret"])[1] is not None
                else:
                    self.db.execute("UPDATE probes SET secret = ? WHERE id = ?",
                                    (self._seal(row["secret"]), row["id"]))
                    migrated += 1
        if migrated:
            # Les anciennes pages de la base peuvent encore contenir le texte en clair : on les efface.
            with self.lock:
                self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                self.db.execute("VACUUM")
        return migrated, unreadable

    def _probe(self, row, with_secret=False):
        p = {
            "id": row["id"], "name": row["name"], "type": row["type"], "group": row["grp"],
            "enabled": bool(row["enabled"]), "interval": row["interval_s"],
            "config": json.loads(row["config"]), "has_secret": bool(row["secret"]),
            "position": row["position"],
        }
        if with_secret:
            p["secret"], error = self._open(row["secret"])
            if error:
                p["secret_error"] = error
        return p

    def list_probes(self, with_secret=False):
        with self.lock:
            rows = self.db.execute("SELECT * FROM probes ORDER BY grp, position, id").fetchall()
        return [self._probe(r, with_secret) for r in rows]

    def get_probe(self, pid, with_secret=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM probes WHERE id = ?", (pid,)).fetchone()
        return self._probe(row, with_secret) if row else None

    def create_probe(self, p):
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT INTO probes (name, type, grp, enabled, interval_s, config, secret, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (p["name"], p["type"], p["group"], int(p["enabled"]), p["interval"],
                 json.dumps(p["config"]), self._seal(p.get("secret")), time.time()))
            return cur.lastrowid

    def update_probe(self, pid, p, secret=None, clear_secret=False):
        with self.lock, self.db:
            self.db.execute(
                "UPDATE probes SET name=?, type=?, grp=?, enabled=?, interval_s=?, config=? WHERE id=?",
                (p["name"], p["type"], p["group"], int(p["enabled"]), p["interval"],
                 json.dumps(p["config"]), pid))
            if secret or clear_secret:
                self.db.execute("UPDATE probes SET secret=? WHERE id=?", (self._seal(secret), pid))

    def delete_probe(self, pid):
        with self.lock, self.db:
            self.db.execute("DELETE FROM probes WHERE id = ?", (pid,))

    def add_result(self, pid, ts, res):
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO results (probe_id, ts, status, value, duration_ms, summary, details)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (pid, ts, res["status"], res.get("value"), res.get("duration_ms"),
                 res.get("summary"), json.dumps(res.get("details") or {}, ensure_ascii=False)))
            self.db.execute(
                "DELETE FROM results WHERE probe_id = ? AND id NOT IN"
                " (SELECT id FROM results WHERE probe_id = ? ORDER BY ts DESC LIMIT ?)",
                (pid, pid, HISTORY_KEEP))

    def history(self, pid, limit=60):
        with self.lock:
            rows = self.db.execute(
                "SELECT ts, status, value, summary FROM results WHERE probe_id = ?"
                " ORDER BY ts DESC LIMIT ?", (pid, limit)).fetchall()
        return [dict(r) for r in reversed(rows)]

    def last_result(self, pid):
        with self.lock:
            row = self.db.execute(
                "SELECT * FROM results WHERE probe_id = ? ORDER BY ts DESC LIMIT 1", (pid,)).fetchone()
        if not row:
            return None
        return {"ts": row["ts"], "status": row["status"], "value": row["value"],
                "duration_ms": row["duration_ms"], "summary": row["summary"],
                "details": json.loads(row["details"] or "{}")}

    def count(self):
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM probes").fetchone()[0]

    # --- Comptes administrateur et sessions ---

    def has_users(self):
        with self.lock:
            return self.db.execute("SELECT COUNT(*) FROM users").fetchone()[0] > 0

    def set_user(self, login, password):
        """Crée le compte, ou remplace son mot de passe s'il existe (et ferme ses sessions)."""
        pw = hash_password(password)
        with self.lock, self.db:
            row = self.db.execute("SELECT id FROM users WHERE login = ?", (login,)).fetchone()
            if row:
                self.db.execute("UPDATE users SET pw_hash = ? WHERE id = ?", (pw, row["id"]))
                self.db.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            else:
                self.db.execute("INSERT INTO users (login, pw_hash) VALUES (?, ?)", (login, pw))

    def delete_users(self):
        with self.lock, self.db:
            self.db.execute("DELETE FROM users")

    def authenticate(self, login, password):
        with self.lock:
            row = self.db.execute("SELECT * FROM users WHERE login = ?", (login,)).fetchone()
        return row["id"] if row and check_password(password, row["pw_hash"]) else None

    def create_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with self.lock, self.db:
            self.db.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
            self.db.execute("INSERT INTO sessions VALUES (?, ?, ?)",
                            (token, user_id, time.time() + SESSION_DAYS * 86400))
        return token

    def session_user(self, token):
        if not token:
            return None
        with self.lock:
            row = self.db.execute(
                "SELECT users.id, users.login FROM sessions JOIN users ON users.id = sessions.user_id"
                " WHERE token = ? AND expires > ?", (token, time.time())).fetchone()
        return dict(row) if row else None

    def delete_session(self, token):
        with self.lock, self.db:
            self.db.execute("DELETE FROM sessions WHERE token = ?", (token,))

    # --- Jetons d'accès à l'API (Home Assistant...) : lecture seule, seul leur empreinte est gardée ---

    def instance_id(self):
        """Identifiant stable de cette installation (sert à Home Assistant à la reconnaître)."""
        with self.lock, self.db:
            row = self.db.execute("SELECT value FROM settings WHERE key = 'instance_id'").fetchone()
            if row:
                return row["value"]
            value = secrets.token_hex(8)
            self.db.execute("INSERT INTO settings VALUES ('instance_id', ?)", (value,))
            return value

    def create_token(self, name):
        token = "mon_" + secrets.token_urlsafe(32)
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT INTO api_tokens (name, token_hash, hint, created_at) VALUES (?, ?, ?, ?)",
                (name, hashlib.sha256(token.encode()).hexdigest(), token[-4:], time.time()))
        return {"id": cur.lastrowid, "token": token}

    def list_tokens(self):
        with self.lock:
            rows = self.db.execute(
                "SELECT id, name, hint, created_at, last_used FROM api_tokens ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    def delete_token(self, tid):
        with self.lock, self.db:
            self.db.execute("DELETE FROM api_tokens WHERE id = ?", (tid,))

    def token_client(self, token):
        """Renvoie le jeton correspondant (et note son utilisation), ou None."""
        if not token:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock, self.db:
            row = self.db.execute("SELECT id, name, last_used FROM api_tokens WHERE token_hash = ?",
                                  (digest,)).fetchone()
            if not row:
                return None
            if not row["last_used"] or row["last_used"] < time.time() - 60:
                self.db.execute("UPDATE api_tokens SET last_used = ? WHERE id = ?", (time.time(), row["id"]))
        return {"id": row["id"], "name": row["name"]}

    # --- Sauvegarde : export et import des sondes (et de leur historique) ---

    def export_data(self, with_history=False, password=None):
        """Sondes et, au choix, leur historique. Ni comptes ni jetons.

        Avec un mot de passe d'export, les mots de passe des sondes sont rechiffrés avec une clé
        dérivée de celui-ci (lisible par une autre installation) ; sans, ils ne sont pas exportés.
        Renvoie (sondes, description du chiffrement ou None).
        """
        box, encryption = export_box(password) if password else (None, None)
        if encryption:
            encryption["check"] = box.check_value()
        with self.lock:
            rows = self.db.execute("SELECT * FROM probes ORDER BY grp, position, id").fetchall()
            probes = []
            for r in rows:
                p = self._probe(r, with_secret=True)
                secret = p.pop("secret", None)
                p.pop("secret_error", None)
                del p["has_secret"]
                if box and secret:
                    p["secret_enc"] = box.encrypt(secret)
                if with_history:
                    p["history"] = [
                        {**dict(h), "details": json.loads(h["details"] or "{}")}
                        for h in self.db.execute(
                            "SELECT ts, status, value, duration_ms, summary, details FROM results"
                            " WHERE probe_id = ? ORDER BY ts", (r["id"],))]
                del p["id"]
                probes.append(p)
        return probes, encryption

    def import_data(self, probes, replace=False):
        """Ajoute des sondes déjà validées ; replace=True supprime d'abord les sondes existantes.

        Tout se fait en une seule transaction : en cas d'erreur, la base reste inchangée.
        """
        with self.lock, self.db:
            if replace:
                self.db.execute("DELETE FROM results")
                self.db.execute("DELETE FROM probes")
            now = time.time()
            for p in probes:
                cur = self.db.execute(
                    "INSERT INTO probes (name, type, grp, enabled, interval_s, config, secret, position, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (p["name"], p["type"], p["group"], int(p["enabled"]), p["interval"],
                     json.dumps(p["config"]), self._seal(p.get("secret")), p.get("position", 0), now))
                history = p.get("history") or []
                self.db.executemany(
                    "INSERT INTO results (probe_id, ts, status, value, duration_ms, summary, details)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [(cur.lastrowid, h["ts"], h["status"], h.get("value"), h.get("duration_ms"),
                      h.get("summary"), json.dumps(h.get("details") or {}, ensure_ascii=False))
                     for h in history[-HISTORY_KEEP:]])
        return len(probes)
