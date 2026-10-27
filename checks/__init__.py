"""Registre des types de sondes.

Chaque module expose :
    TYPE   : identifiant (ex. "imap")
    LABEL  : nom affiché
    SECRET : libellé du champ secret (mot de passe, jeton...) ou None
    FIELDS : description des champs du formulaire (voir ci-dessous)
    run(cfg: dict, secret: str | None) -> dict
        {"status": "ok" | "warning" | "error", "summary": str,
         "value": nombre (optionnel), "unit": str (optionnel), "details": dict (optionnel)}

Champ : {"key", "label", "kind": text|number|bool|list|select|multiselect|textarea,
         "default", "required", "help", "options" (pour select),
         "advanced": True pour ranger le champ dans « Options avancées »}
L'interface construit les formulaires à partir de FIELDS : ajouter un type de sonde
revient à créer un module ici et à l'ajouter à MODULES.
"""
from . import http, imap, ping, snmp

MODULES = [imap, http, ping, snmp]
CHECKS = {m.TYPE: m for m in MODULES}


def describe():
    return [
        {"type": m.TYPE, "label": m.LABEL, "description": m.DESCRIPTION,
         "secret": m.SECRET, "fields": m.FIELDS}
        for m in MODULES
    ]


def normalize(type_, cfg):
    """Applique les valeurs par défaut et convertit les types des champs."""
    mod = CHECKS[type_]
    out = {}
    for f in mod.FIELDS:
        v = cfg.get(f["key"], f.get("default"))
        kind = f["kind"]
        if v in ("", None):
            v = f.get("default")
        if v is None:
            if f.get("required"):
                raise ValueError(f"le champ « {f['label']} » est obligatoire")
            out[f["key"]] = None
            continue
        if kind == "number":
            try:
                v = float(v)
                v = int(v) if v.is_integer() else v
            except (TypeError, ValueError):
                raise ValueError(f"« {f['label']} » doit être un nombre") from None
        elif kind == "bool":
            v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "oui", "on")
        elif kind == "list":
            if isinstance(v, str):
                v = [x.strip() for x in v.split(",")]
            v = [str(x).strip() for x in v if str(x).strip()]
        elif kind == "multiselect":
            if isinstance(v, str):
                v = [x.strip() for x in v.split(",")]
            allowed = [o["value"] for o in f["options"]]
            v = [x for x in allowed if x in v]
        elif kind == "select":
            if v not in [o["value"] for o in f["options"]]:
                raise ValueError(f"valeur invalide pour « {f['label']} »")
        else:
            v = str(v).strip() if kind == "text" else str(v)
        out[f["key"]] = v
    return out
