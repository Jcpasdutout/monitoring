"""Monitoring — serveur web + planificateur de sondes (bibliothèque standard uniquement).

Usage : python server.py [chemin/config.toml] [--reset-admin]

Les sondes se gèrent depuis l'interface web et sont enregistrées dans data/monitoring.db.
"""
import json
import os
import re
import sys
import threading
import time
import tomllib
from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import checks
from store import Store

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
MIN_INTERVAL = 10
VERSION = "2.7.0"
# Version de l'add-on Home Assistant, transmise par son Dockerfile (vide hors add-on).
ADDON_VERSION = os.environ.get("MONITORING_ADDON_VERSION", "")
COOKIE = "monitoring_session"


def load_env_file(path):
    """Charge un fichier NOM=valeur (comme secrets.env) sans écraser l'environnement existant."""
    if not path.exists():
        alt = path.with_name(path.name + ".txt")
        if alt.exists():
            print(f"Attention : trouvé {alt.name}, renommez-le en {path.name}")
        return
    loaded = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)
        loaded.append(key.strip())
    print(f"Variables lues dans {path} : {', '.join(loaded) or 'aucune'}")


def validate(body, existing=None):
    """Vérifie et normalise une sonde envoyée par l'interface."""
    type_ = body.get("type") or (existing or {}).get("type")
    if type_ not in checks.CHECKS:
        raise ValueError("type de sonde inconnu")
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("le nom est obligatoire")
    try:
        interval = int(body.get("interval") or 120)
    except (TypeError, ValueError):
        raise ValueError("l'intervalle doit être un nombre de secondes") from None
    return {
        "name": name,
        "type": type_,
        "group": str(body.get("group") or "").strip(),
        "enabled": bool(body.get("enabled", True)),
        "interval": max(MIN_INTERVAL, interval),
        "config": checks.normalize(type_, body.get("config") or {}),
    }


class Monitor:
    """Lance les sondes à leur rythme et garde leurs résultats."""

    def __init__(self, store):
        self.store = store
        self.pool = ThreadPoolExecutor(max_workers=8)
        self.next_run = {}
        self.running = set()
        self.lock = threading.Lock()

    def execute(self, probe):
        """Exécute une sonde (enregistrée ou non) et renvoie le résultat."""
        started = time.monotonic()
        try:
            res = checks.CHECKS[probe["type"]].run(probe["config"], probe.get("secret"))
        except Exception as e:  # une sonde en échec ne doit pas bloquer les autres
            res = {"status": "error", "summary": str(e) or e.__class__.__name__}
        res["duration_ms"] = round((time.monotonic() - started) * 1000)
        res["ts"] = time.time()
        if res.get("unit"):
            res.setdefault("details", {})["unit"] = res["unit"]
        return res

    def run_probe(self, pid):
        try:
            probe = self.store.get_probe(pid, with_secret=True)
            if probe:
                res = self.execute(probe)
                self.store.add_result(pid, res["ts"], res)
                return res
        finally:
            with self.lock:
                self.running.discard(pid)

    def trigger(self, pid=None):
        with self.lock:
            if pid is None:
                self.next_run.clear()
            else:
                self.next_run[pid] = 0

    def loop(self):
        while True:
            now = time.time()
            for p in self.store.list_probes():
                if not p["enabled"]:
                    continue
                with self.lock:
                    if p["id"] in self.running or self.next_run.get(p["id"], 0) > now:
                        continue
                    self.running.add(p["id"])
                    self.next_run[p["id"]] = now + p["interval"]
                self.pool.submit(self.run_probe, p["id"])
            time.sleep(1)


PRIVATE_DETAILS = ("messages",)  # contenu réservé à l'administrateur (aperçu des mails)


def public_result(res, admin):
    """Retire d'un résultat ce qu'un visiteur non connecté ne doit pas voir."""
    if admin or not res or not res.get("details"):
        return res
    res = dict(res)
    res["details"] = {k: v for k, v in res["details"].items() if k not in PRIVATE_DETAILS}
    return res


PRIVATE_CONFIG = ("headers", "body")  # peuvent contenir une clé d'API : réservés à l'administrateur


def probe_view(store, p, history=40, admin=False, token=False):
    p = dict(p)
    if not admin:  # visiteurs non connectés : pas d'identifiants, d'URL ni d'aperçu des mails
        p["config"] = {}
    elif token:  # jeton d'accès : configuration visible sauf ce qui peut cacher un secret
        p["config"] = {k: v for k, v in p["config"].items() if k not in PRIVATE_CONFIG}
    p["last"] = public_result(store.last_result(p["id"]), admin)
    p["history"] = store.history(p["id"], history)
    return p


def make_handler(store, monitor):
    routes = []

    def route(method, pattern, admin=False):
        def deco(fn):
            routes.append((method, re.compile(f"^{pattern}$"), fn, admin))
            return fn
        return deco

    def credentials(body):
        login = str(body.get("login") or "").strip()
        password = str(body.get("password") or "")
        if not login:
            raise ValueError("l'identifiant est obligatoire")
        if len(password) < 8:
            raise ValueError("le mot de passe doit faire au moins 8 caractères")
        return login, password

    def full_view(h):
        """L'administrateur et les jetons d'accès voient le détail des sondes (jamais les mots de passe)."""
        return bool(h.user or h.api)

    @route("GET", "/api/auth")
    def auth_state(h):
        return {"setup_needed": not store.has_users(),
                "user": h.user["login"] if h.user else None,
                "api_token": h.api["name"] if h.api else None,
                "instance_id": store.instance_id(), "version": VERSION,
                "addon_version": ADDON_VERSION or None}

    @route("POST", "/api/auth/setup")
    def auth_setup(h):
        if store.has_users():
            return h.fail(403, "un compte administrateur existe déjà")
        login, password = credentials(h.body())
        store.set_user(login, password)
        h.start_session(store.authenticate(login, password))
        return {"user": login}

    @route("POST", "/api/auth/login")
    def auth_login(h):
        body = h.body()
        uid = store.authenticate(str(body.get("login") or "").strip(), str(body.get("password") or ""))
        if not uid:
            time.sleep(1)  # ralentit les essais en série
            return h.fail(401, "identifiant ou mot de passe incorrect")
        h.start_session(uid)
        return {"user": store.session_user(h.new_token)["login"]}

    @route("POST", "/api/auth/logout")
    def auth_logout(h):
        store.delete_session(h.token)
        h.extra_headers.append(("Set-Cookie", f"{COOKIE}=; Path={h.cookie_path()}; Max-Age=0; HttpOnly; SameSite=Strict"))
        return {"ok": True}

    @route("POST", "/api/auth/password", admin=True)
    def auth_password(h):
        body = h.body()
        if not store.authenticate(h.user["login"], str(body.get("current") or "")):
            return h.fail(400, "mot de passe actuel incorrect")
        login, password = credentials({"login": h.user["login"], "password": body.get("password")})
        store.set_user(login, password)  # ferme aussi les autres sessions
        h.start_session(store.authenticate(login, password))
        return {"ok": True}

    @route("GET", "/api/types")
    def types(h):
        return checks.describe()

    @route("GET", "/api/probes")
    def list_probes(h):
        return [probe_view(store, p, admin=full_view(h), token=not h.user) for p in store.list_probes()]

    @route("POST", "/api/probes", admin=True)
    def create(h):
        body = h.body()
        probe = validate(body)
        probe["secret"] = body.get("secret") or None
        if not probe["secret"] and body.get("copy_secret_from"):
            source = store.get_probe(int(body["copy_secret_from"]), with_secret=True)
            probe["secret"] = source and source.get("secret")
        pid = store.create_probe(probe)
        monitor.trigger(pid)
        return store.get_probe(pid)

    @route("GET", r"/api/probes/(\d+)")
    def get_one(h, pid):
        p = store.get_probe(int(pid))
        return probe_view(store, p, 200, admin=full_view(h), token=not h.user) if p else h.fail(404, "sonde introuvable")

    @route("PUT", r"/api/probes/(\d+)", admin=True)
    def update(h, pid):
        pid = int(pid)
        existing = store.get_probe(pid)
        if not existing:
            return h.fail(404, "sonde introuvable")
        body = h.body()
        probe = validate({**existing, **body}, existing)
        store.update_probe(pid, probe, secret=body.get("secret"), clear_secret=body.get("clear_secret"))
        monitor.trigger(pid)
        return store.get_probe(pid)

    @route("DELETE", r"/api/probes/(\d+)", admin=True)
    def delete(h, pid):
        store.delete_probe(int(pid))
        return {"ok": True}

    @route("POST", r"/api/probes/(\d+)/run")
    def run_now(h, pid):
        pid = int(pid)
        if not store.get_probe(pid):
            return h.fail(404, "sonde introuvable")
        return public_result(monitor.run_probe(pid), full_view(h))

    @route("POST", r"/api/probes/(\d+)/action", admin=True)
    def probe_action(h, pid):
        """Action propre à un type de sonde (ex. supprimer un mail), puis nouvelle vérification."""
        probe = store.get_probe(int(pid), with_secret=True)
        if not probe:
            return h.fail(404, "sonde introuvable")
        body = h.body()
        action = getattr(checks.CHECKS[probe["type"]], "ACTIONS", {}).get(body.get("action"))
        if not action:
            return h.fail(400, "action inconnue")
        params = body.get("params") or {}
        try:
            done = action(probe["config"], probe.get("secret"), **{k: str(v) for k, v in params.items()
                                                                    if k in ("folder", "uid")})
        except (RuntimeError, OSError) as e:
            return h.fail(502, str(e))
        return {"action": done, "result": monitor.run_probe(int(pid))}

    @route("POST", "/api/test", admin=True)
    def test(h):
        """Teste une sonde depuis le formulaire, sans l'enregistrer."""
        body = h.body()
        probe = validate({"name": "test", **body})
        secret = body.get("secret")
        if not secret and body.get("id"):
            saved = store.get_probe(int(body["id"]), with_secret=True)
            secret = saved and saved.get("secret")
        probe["secret"] = secret
        return monitor.execute(probe)

    @route("POST", "/api/refresh")
    def refresh(h):
        monitor.trigger()
        return {"ok": True}

    @route("GET", "/api/tokens", admin=True)
    def list_tokens(h):
        return store.list_tokens()

    @route("POST", "/api/tokens", admin=True)
    def create_token(h):
        name = str(h.body().get("name") or "").strip()
        if not name:
            raise ValueError("donnez un nom au jeton (ex. Home Assistant)")
        return store.create_token(name[:60])  # le jeton n'est affiché qu'une seule fois

    @route("DELETE", r"/api/tokens/(\d+)", admin=True)
    def delete_token(h, tid):
        store.delete_token(int(tid))
        return {"ok": True}

    class Handler(SimpleHTTPRequestHandler):
        cache_control = None  # en-tête Cache-Control des fichiers de l'interface
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(STATIC), **kw)

        def log_message(self, fmt, *args):
            pass

        def cookie_path(self):
            # Derrière l'Ingress de Home Assistant, l'interface vit sous /api/hassio_ingress/<jeton>/ :
            # le cookie est limité à ce préfixe pour ne pas être envoyé au reste de Home Assistant.
            prefix = self.headers.get("X-Ingress-Path", "")
            return prefix.rstrip("/") + "/" if re.fullmatch(r"/[\w/.-]*", prefix) else "/"

        def start_session(self, uid):
            self.new_token = store.create_session(uid)
            self.extra_headers.append(("Set-Cookie", f"{COOKIE}={self.new_token}; Path={self.cookie_path()}; "
                                       f"Max-Age={30 * 86400}; HttpOnly; SameSite=Strict"))

        def body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > 1_000_000:
                raise ValueError("requête trop volumineuse")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                raise ValueError("JSON invalide") from None
            if not isinstance(data, dict):
                raise ValueError("objet JSON attendu")
            return data

        def fail(self, code, message):
            self._json({"error": message}, code)
            return None

        def _json(self, payload, code=200):
            data = json.dumps(payload, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            for k, v in self.extra_headers:
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def dispatch(self, method):
            path = self.path.split("?", 1)[0]
            self.extra_headers = []
            self.cache_control = None
            if path.startswith("/api/"):
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                self.token = cookie[COOKIE].value if COOKIE in cookie else None
                self.user = store.session_user(self.token)
                # Jeton d'accès (Home Assistant...) : lecture seule, n'ouvre pas les routes d'administration.
                self.api = None
                bearer = self.headers.get("Authorization", "")
                if bearer.lower().startswith("bearer "):
                    self.api = store.token_client(bearer[7:].strip())
                    if not self.api:
                        return self.fail(401, "jeton d'accès invalide ou supprimé")
                for m, rx, fn, admin in routes:
                    match = rx.match(path)
                    if m == method and match:
                        if admin and not self.user:
                            return self.fail(401, "connexion administrateur requise")
                        try:
                            result = fn(self, *match.groups())
                        except ValueError as e:
                            return self.fail(400, str(e))
                        except Exception as e:
                            return self.fail(500, f"erreur interne : {e}")
                        if result is not None:
                            self._json(result)
                        return
                return self.fail(404, "route inconnue")
            if method != "GET":
                return self.fail(405, "méthode non autorisée")
            # Application monopage : toute URL inconnue renvoie index.html.
            if "." not in path.rsplit("/", 1)[-1] and not (STATIC / path.lstrip("/")).is_file():
                self.path = "/index.html"
            # index.html toujours revalidé (sinon le navigateur garde l'ancienne interface après une
            # mise à jour) ; les fichiers de assets/ portent une empreinte dans leur nom : cache long.
            self.cache_control = ("public, max-age=31536000, immutable" if path.startswith("/assets/")
                                  else "no-cache")
            return super().do_GET()

        def end_headers(self):
            if self.cache_control:
                self.send_header("Cache-Control", self.cache_control)
            super().end_headers()

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

        def do_PUT(self):
            self.dispatch("PUT")

        def do_DELETE(self):
            self.dispatch("DELETE")

    return Handler


def import_legacy(store, config):
    """Reprend les anciennes sondes [[check]] de config.toml (première version) si la base est vide."""
    legacy = config.get("check", [])
    if not legacy or store.count():
        return
    for i, chk in enumerate(legacy):
        try:
            cfg = {k: v for k, v in chk.items() if k not in ("type", "name", "group", "password", "password_env")}
            probe = validate({"name": chk.get("name") or f"Sonde {i + 1}", "type": chk.get("type"),
                              "group": chk.get("group", ""), "config": cfg,
                              "interval": config.get("server", {}).get("refresh_seconds", 120)})
            probe["secret"] = chk.get("password") or os.environ.get(chk.get("password_env") or "", "") or None
            store.create_probe(probe)
            print(f"Sonde importée depuis config.toml : {probe['name']}")
        except Exception as e:
            print(f"Sonde {i + 1} de config.toml ignorée : {e}")


def provision_token(store, path, name):
    """Garde dans un fichier un jeton d'accès valide (utilisé par l'add-on Home Assistant).

    Le jeton est recréé si le fichier manque ou si le jeton a été supprimé dans l'interface.
    """
    path = Path(path)
    if path.exists() and store.token_client(path.read_text(encoding="utf-8").strip()):
        return
    token = store.create_token(name[:60])["token"]
    path.write_text(token, encoding="utf-8")
    path.chmod(0o600)
    print(f"Jeton d'accès « {name} » créé dans {path}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cfg_path = Path(args[0]) if args else BASE / "config.toml"
    config = {}
    if cfg_path.exists():
        with open(cfg_path, "rb") as f:
            config = tomllib.load(f)
    load_env_file(cfg_path.parent / "secrets.env")
    srv = config.get("server", {})

    data_dir = Path(os.environ.get("MONITORING_DATA") or srv.get("data_dir") or BASE / "data")
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        data_dir.chmod(0o700)  # la base contient les mots de passe
    except OSError:
        pass
    store = Store(str(data_dir / "monitoring.db"))
    import_legacy(store, config)
    if "--reset-admin" in sys.argv:
        store.delete_users()
        print("Compte administrateur supprimé : ouvrez la page Sondes pour en créer un nouveau.")
    if os.environ.get("MONITORING_TOKEN_FILE"):
        provision_token(store, os.environ["MONITORING_TOKEN_FILE"],
                        os.environ.get("MONITORING_TOKEN_NAME") or "Home Assistant")

    if not (STATIC / "index.html").exists():
        sys.exit("Interface absente : le dossier static/ doit contenir index.html (voir README).")

    monitor = Monitor(store)
    threading.Thread(target=monitor.loop, daemon=True).start()
    host = os.environ.get("MONITORING_HOST") or srv.get("host", "127.0.0.1")
    port = int(os.environ.get("MONITORING_PORT") or srv.get("port", 8080))
    print(f"Tableau de bord : http://{host}:{port}")
    if not store.has_users():
        print("Aucun compte administrateur : créez-le depuis la page Sondes.")
    ThreadingHTTPServer((host, port), make_handler(store, monitor)).serve_forever()


if __name__ == "__main__":
    main()
