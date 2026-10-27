"""Sonde IMAP : nombre de mails non lus (+ aperçu des derniers)."""
import email
import imaplib
import re
import ssl
from email.header import decode_header, make_header
from email.utils import parseaddr, parsedate_to_datetime

TYPE = "imap"
LABEL = "Boîte mail (IMAP)"
DESCRIPTION = "Compte les mails non lus, sans les marquer comme lus."
SECRET = "Mot de passe"
FIELDS = [
    {"key": "user", "label": "Identifiant", "kind": "text", "required": True,
     "help": "Adresse complète, ex. prenom.nom@free.fr"},
    {"key": "host", "label": "Serveur IMAP", "kind": "text", "default": "imap.free.fr", "advanced": True},
    {"key": "port", "label": "Port", "kind": "number", "default": 993, "advanced": True},
    {"key": "ssl", "label": "Connexion chiffrée (SSL)", "kind": "bool", "default": True, "advanced": True},
    {"key": "folders", "label": "Dossiers", "kind": "list", "default": ["INBOX"],
     "help": "Séparés par des virgules, ex. INBOX, Spam"},
    {"key": "preview", "label": "Aperçu des derniers non lus", "kind": "number", "default": 5, "advanced": True},
    {"key": "warn_above", "label": "Alerte au-delà de N non lus", "kind": "number",
     "help": "Laisser vide pour ne jamais alerter"},
    {"key": "trash_folder", "label": "Dossier corbeille", "kind": "text", "advanced": True,
     "help": "Pour le bouton de suppression ; vide = détection automatique"},
]


def _decode(value):
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _connect(cfg, secret):
    if not secret:
        raise RuntimeError("mot de passe non renseigné")
    host, port = cfg["host"], int(cfg["port"])
    if cfg["ssl"]:
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=20)
    else:
        conn = imaplib.IMAP4(host, port, timeout=20)
    try:
        conn.login(cfg["user"], secret)
    except imaplib.IMAP4.error as e:
        conn.shutdown()
        raise RuntimeError(f"connexion refusée par le serveur ({e})") from None
    return conn


def run(cfg, secret):
    preview = int(cfg.get("preview") or 0)
    conn = _connect(cfg, secret)
    try:
        total = 0
        per_folder = {}
        messages = []
        for folder in cfg["folders"] or ["INBOX"]:
            typ, _ = conn.select(f'"{folder}"', readonly=True)
            if typ != "OK":
                per_folder[folder] = None
                continue
            # UID : identifiant stable d'un message, utilisé par le bouton de suppression.
            typ, data = conn.uid("SEARCH", None, "UNSEEN", "UNDELETED")
            ids = data[0].split() if typ == "OK" and data and data[0] else []
            per_folder[folder] = len(ids)
            total += len(ids)
            # Aperçu des plus récents, sans les marquer comme lus (BODY.PEEK).
            for mid in reversed(ids[-preview:] if preview else []):
                typ, msg_data = conn.uid("FETCH", mid, "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])")
                if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                    continue
                hdr = email.message_from_bytes(msg_data[0][1])
                name, addr = parseaddr(_decode(hdr.get("From")))
                try:
                    date = parsedate_to_datetime(hdr.get("Date")).isoformat()
                except Exception:
                    date = None
                messages.append({
                    "uid": mid.decode(),
                    "folder": folder,
                    "from": name or addr,
                    "subject": _decode(hdr.get("Subject")) or "(sans objet)",
                    "date": date,
                })
        messages.sort(key=lambda m: m["date"] or "", reverse=True)
        warn_above = cfg.get("warn_above")
        status = "warning" if warn_above is not None and total > warn_above else "ok"
        return {
            "status": status,
            "value": total,
            "unit": "non lus" if total > 1 else "non lu",
            "summary": f"{total} non lu{'s' if total > 1 else ''}",
            "details": {"folders": per_folder, "messages": messages[:preview]},
        }
    finally:
        try:
            conn.logout()
        except Exception:
            pass


# --- Actions déclenchées depuis le tableau de bord (réservées à l'administrateur) ---

_LIST_RE = re.compile(r'\((?P<flags>[^)]*)\) (?P<delim>"[^"]*"|NIL) (?P<name>.+)')
TRASH_NAMES = ("trash", "corbeille", "inbox.trash", "inbox.corbeille", "deleted messages", "deleted items")


def _find_trash(conn, cfg):
    if cfg.get("trash_folder"):
        return cfg["trash_folder"]
    typ, data = conn.list()
    folders = []
    for line in data or []:
        m = _LIST_RE.match(line.decode(errors="replace") if isinstance(line, bytes) else str(line))
        if not m:
            continue
        name = m["name"].strip()
        if name.startswith('"') and name.endswith('"'):
            name = name[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        if "\\trash" in m["flags"].lower():
            return name
        folders.append(name)
    for wanted in TRASH_NAMES:
        for name in folders:
            if name.lower() == wanted:
                return name
    raise RuntimeError("dossier corbeille introuvable : indiquez-le dans les options avancées de la sonde")


def delete_mail(cfg, secret, folder="INBOX", uid=""):
    """Déplace un message vers la corbeille (jamais de suppression définitive)."""
    uid = str(uid)
    if not uid.isdigit():
        raise ValueError("identifiant de message invalide")
    if folder not in (cfg.get("folders") or ["INBOX"]):
        raise ValueError("dossier non surveillé par cette sonde")
    conn = _connect(cfg, secret)
    try:
        trash = _find_trash(conn, cfg)
        if trash == folder:
            raise ValueError("ce message est déjà dans la corbeille")
        typ, _ = conn.select(f'"{folder}"')
        if typ != "OK":
            raise RuntimeError(f"dossier {folder} inaccessible")
        typ, data = conn.uid("SEARCH", None, "UID", uid)
        if typ != "OK" or not data or uid.encode() not in (data[0] or b"").split():
            raise ValueError("message introuvable (déjà supprimé ?)")
        caps = conn.capabilities
        if "MOVE" in caps:
            typ, data = conn.uid("MOVE", uid, f'"{trash}"')
        else:
            typ, data = conn.uid("COPY", uid, f'"{trash}"')
            if typ == "OK":
                conn.uid("STORE", uid, "+FLAGS", "(\\Deleted)")
                if "UIDPLUS" in caps:
                    conn.uid("EXPUNGE", uid)
        if typ != "OK":
            raise RuntimeError(f"le serveur a refusé le déplacement ({data})")
        return {"ok": True, "trash": trash}
    finally:
        try:
            conn.logout()
        except Exception:
            pass


ACTIONS = {"delete_mail": delete_mail}
