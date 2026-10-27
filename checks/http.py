"""Sonde HTTP : appel d'une URL / API, code de retour, temps de réponse, contenu attendu."""
import json
import ssl
import time
import urllib.error
import urllib.request

TYPE = "http"
LABEL = "API / site web (HTTP)"
DESCRIPTION = "Appelle une URL et vérifie le code de retour, le temps de réponse et éventuellement le contenu."
SECRET = "En-tête Authorization (optionnel)"
FIELDS = [
    {"key": "url", "label": "URL", "kind": "text", "required": True,
     "help": "ex. https://api.exemple.fr/health"},
    {"key": "method", "label": "Méthode", "kind": "select", "default": "GET",
     "options": [{"value": m, "label": m, "advanced": True} for m in ("GET", "HEAD", "POST", "PUT")]},
    {"key": "expected_status", "label": "Codes attendus", "kind": "text", "default": "200-399",
     "help": "ex. 200, ou 200-299, ou 200,204"},
    {"key": "contains", "label": "Le corps doit contenir", "kind": "text",
     "help": "Texte attendu dans la réponse (optionnel)"},
    {"key": "json_path", "label": "Valeur JSON à afficher", "kind": "text",
     "help": "Chemin pointé, ex. data.count (optionnel)"},
    {"key": "headers", "label": "En-têtes", "kind": "textarea",
     "help": "Un par ligne, ex. Accept: application/json", "advanced": True},
    {"key": "body", "label": "Corps de la requête", "kind": "textarea", "advanced": True},
    {"key": "timeout", "label": "Délai max (s)", "kind": "number", "default": 10, "advanced": True},
    {"key": "warn_ms", "label": "Alerte si plus lent que (ms)", "kind": "number", "default": 2000},
    {"key": "verify_ssl", "label": "Vérifier le certificat SSL", "kind": "bool", "default": True, "advanced": True},
]


def _status_ok(code, spec):
    for part in str(spec or "200-399").replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= code <= int(hi):
                return True
        elif part.lower().endswith("xx"):
            if str(code)[0] == part[0]:
                return True
        elif int(part) == code:
            return True
    return False


def _json_path(data, path):
    for key in path.split("."):
        if isinstance(data, list):
            data = data[int(key)]
        else:
            data = data[key]
    return data


def run(cfg, secret):
    headers = {"User-Agent": "monitoring/1.0"}
    for line in (cfg.get("headers") or "").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip()] = v.strip()
    if secret:
        headers["Authorization"] = secret
    body = cfg.get("body")
    data = body.encode() if body and cfg["method"] in ("POST", "PUT") else None
    req = urllib.request.Request(cfg["url"], data=data, method=cfg["method"], headers=headers)
    ctx = ssl.create_default_context()
    if not cfg["verify_ssl"]:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    start = time.monotonic()
    try:
        resp = urllib.request.urlopen(req, timeout=cfg["timeout"], context=ctx)
    except urllib.error.HTTPError as e:
        resp = e
    except urllib.error.URLError as e:
        raise RuntimeError(f"injoignable : {e.reason}") from None
    with resp:
        content = resp.read(1_000_000) if cfg["method"] != "HEAD" else b""
        code = resp.status if hasattr(resp, "status") else resp.code
    ms = round((time.monotonic() - start) * 1000)

    details = {"http_status": code, "latency_ms": ms}
    problems = []
    if not _status_ok(code, cfg.get("expected_status")):
        problems.append(f"code {code} inattendu")
    text = content.decode("utf-8", "replace")
    if cfg.get("contains") and cfg["contains"] not in text:
        problems.append(f"« {cfg['contains']} » absent de la réponse")
    if cfg.get("json_path"):
        try:
            details["json_value"] = _json_path(json.loads(text), cfg["json_path"])
        except Exception:
            problems.append(f"chemin JSON {cfg['json_path']} introuvable")

    if problems:
        return {"status": "error", "value": ms, "unit": "ms",
                "summary": " ; ".join(problems), "details": details}
    slow = cfg.get("warn_ms") and ms > cfg["warn_ms"]
    summary = f"HTTP {code} en {ms} ms"
    if "json_value" in details:
        summary += f" · {cfg['json_path']} = {details['json_value']}"
    return {"status": "warning" if slow else "ok", "value": ms, "unit": "ms",
            "summary": summary + (" (lent)" if slow else ""), "details": details}
