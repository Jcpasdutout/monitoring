"""Sonde SNMP (v2c) : CPU, mémoire, disques… d'une machine distante.

Client SNMP minimal écrit avec la bibliothèque standard (UDP + encodage BER).
Ajouter un indicateur : écrire une fonction `fetch(client, cfg) -> list[gauge]` et
l'enregistrer dans INDICATORS ; elle apparaît automatiquement dans le formulaire.
Une jauge : {"key", "label", "pct" (0-100 ou None), "text"}.
"""
import random
import socket

TYPE = "snmp"
LABEL = "Machine distante (SNMP)"
DESCRIPTION = "Lit l'utilisation du processeur, de la mémoire et des disques d'une machine via SNMP v2c."
SECRET = "Communauté SNMP (par défaut : public)"

# --- Encodage / décodage BER -------------------------------------------------

def _len(n):
    if n < 0x80:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b


def _tlv(tag, value):
    return bytes([tag]) + _len(len(value)) + value


def _int(n):
    return _tlv(0x02, n.to_bytes(max(1, (n.bit_length() + 8) // 8), "big", signed=True))


def _oid(oid):
    parts = [int(x) for x in oid.strip(".").split(".")]
    out = bytearray([40 * parts[0] + parts[1]])
    for p in parts[2:]:
        chunk = [p & 0x7F]
        p >>= 7
        while p:
            chunk.append(0x80 | (p & 0x7F))
            p >>= 7
        out += bytes(reversed(chunk))
    return _tlv(0x06, bytes(out))


def _parse(data, pos=0):
    tag = data[pos]
    length = data[pos + 1]
    pos += 2
    if length & 0x80:
        n = length & 0x7F
        length = int.from_bytes(data[pos:pos + n], "big")
        pos += n
    return tag, data[pos:pos + length], pos + length


def _children(data):
    pos, out = 0, []
    while pos < len(data):
        tag, value, pos = _parse(data, pos)
        out.append((tag, value))
    return out


def _decode_oid(v):
    parts = [v[0] // 40, v[0] % 40]
    n = 0
    for b in v[1:]:
        n = (n << 7) | (b & 0x7F)
        if not b & 0x80:
            parts.append(n)
            n = 0
    return ".".join(map(str, parts))


def _decode_value(tag, v):
    if tag == 0x02:
        return int.from_bytes(v, "big", signed=True)
    if tag in (0x41, 0x42, 0x43, 0x46):  # Counter32, Gauge32, TimeTicks, Counter64
        return int.from_bytes(v, "big")
    if tag == 0x04:
        return v.decode("utf-8", "replace")
    if tag == 0x06:
        return _decode_oid(v)
    if tag == 0x40:
        return ".".join(map(str, v))
    return None  # NULL, noSuchObject, noSuchInstance, endOfMibView


END_OF_MIB = 0x82


class SnmpError(Exception):
    pass


class Client:
    def __init__(self, host, port=161, community="public", timeout=2, retries=1):
        self.addr = (host, port)
        self.community = community.encode()
        self.timeout = timeout
        self.retries = retries

    def _request(self, pdu_tag, oids, a=0, b=0):
        rid = random.randint(1, 2**31 - 1)
        varbinds = b"".join(_tlv(0x30, _oid(o) + b"\x05\x00") for o in oids)
        pdu = _tlv(pdu_tag, _int(rid) + _int(a) + _int(b) + _tlv(0x30, varbinds))
        msg = _tlv(0x30, _int(1) + _tlv(0x04, self.community) + pdu)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(self.timeout)
            for _ in range(self.retries + 1):
                s.sendto(msg, self.addr)
                try:
                    while True:
                        data, _ = s.recvfrom(65535)
                        result = self._response(data, rid)
                        if result is not None:
                            return result
                except socket.timeout:
                    continue
        raise SnmpError("pas de réponse (machine injoignable, SNMP désactivé ou mauvaise communauté)")

    @staticmethod
    def _response(data, rid):
        _, msg, _ = _parse(data)
        version, community, pdu = _children(msg)
        _, body = pdu
        fields = _children(body)
        if _decode_value(*fields[0]) != rid:
            return None
        if _decode_value(*fields[1]):
            raise SnmpError(f"erreur SNMP {_decode_value(*fields[1])}")
        out = []
        for _, vb in _children(fields[3][1]):
            (otag, oval), (vtag, vval) = _children(vb)
            out.append((_decode_oid(oval), vtag, _decode_value(vtag, vval)))
        return out

    def get(self, *oids):
        """Valeurs des OID demandés (None si absents)."""
        return {oid: (val if tag not in (0x80, 0x81, 0x82) else None)
                for oid, tag, val in self._request(0xA0, list(oids))}

    def walk(self, base):
        """Parcourt une branche : {oid: valeur}."""
        base = base.strip(".")
        out, current = {}, base
        while True:
            rows = self._request(0xA5, [current], 0, 25)  # GetBulk
            for oid, tag, val in rows:
                if tag == END_OF_MIB or not oid.startswith(base + "."):
                    return out
                out[oid] = val
                current = oid
            if not rows:
                return out


# --- Indicateurs -------------------------------------------------------------

HR_PROCESSOR_LOAD = "1.3.6.1.2.1.25.3.3.1.2"
HR_STORAGE = "1.3.6.1.2.1.25.2.3.1"
HR_STORAGE_RAM = "1.3.6.1.2.1.25.2.1.2"
HR_STORAGE_DISK = "1.3.6.1.2.1.25.2.1.4"
UCD_MEM = "1.3.6.1.4.1.2021.4"
UCD_CPU_IDLE = "1.3.6.1.4.1.2021.11.11.0"


def _human(n):
    for unit in ("o", "Ko", "Mo", "Go", "To"):
        if n < 1024 or unit == "To":
            return f"{n:.0f} {unit}" if unit == "o" else f"{n:.1f} {unit}".replace(".", ",")
        n /= 1024


def _storage(client):
    """Table hrStorage : liste de {type, descr, size, used} en octets."""
    rows = {}
    for oid, val in client.walk(HR_STORAGE).items():
        col, idx = oid[len(HR_STORAGE) + 1:].split(".", 1)
        rows.setdefault(idx, {})[int(col)] = val
    out = []
    for r in rows.values():
        unit = r.get(4) or 1
        if r.get(5):
            out.append({"type": r.get(2), "descr": r.get(3) or "", "size": r[5] * unit, "used": (r.get(6) or 0) * unit})
    return out


def fetch_cpu(client, cfg):
    loads = [v for v in client.walk(HR_PROCESSOR_LOAD).values() if isinstance(v, int)]
    if not loads:
        # Repli Linux (UCD-SNMP-MIB) : pourcentage d'inactivité du processeur.
        idle = client.get(UCD_CPU_IDLE).get(UCD_CPU_IDLE)
        if not isinstance(idle, int):
            raise SnmpError("charge processeur non fournie par la machine")
        return [{"key": "cpu", "label": "CPU", "pct": float(100 - idle), "text": "moyenne"}]
    pct = sum(loads) / len(loads)
    return [{"key": "cpu", "label": "CPU", "pct": round(pct, 1),
             "text": f"{len(loads)} cœur{'s' if len(loads) > 1 else ''}"}]


def fetch_ram(client, cfg):
    # Linux (net-snmp) : UCD-SNMP-MIB permet d'exclure le cache et les tampons.
    ucd = client.get(*(f"{UCD_MEM}.{i}.0" for i in (5, 6, 14, 15)))
    total, avail, buf, cached = (ucd.get(f"{UCD_MEM}.{i}.0") for i in (5, 6, 14, 15))
    if isinstance(total, int) and total and isinstance(avail, int):
        used = total - avail - (buf or 0) - (cached or 0)
        used = max(0, used) * 1024
        total *= 1024
    else:
        ram = [s for s in _storage(client) if s["type"] == HR_STORAGE_RAM]
        if not ram:
            raise SnmpError("mémoire non fournie par la machine")
        used, total = ram[0]["used"], ram[0]["size"]
    return [{"key": "ram", "label": "RAM", "pct": round(100 * used / total, 1),
             "text": f"{_human(used)} / {_human(total)}"}]


def fetch_disk(client, cfg):
    wanted = [d.strip() for d in cfg.get("disks") or [] if d.strip()]
    disks = [s for s in _storage(client) if s["type"] == HR_STORAGE_DISK]
    if wanted:
        disks = [d for d in disks if d["descr"] in wanted or d["descr"].split(" ")[0] in wanted]
    else:  # par défaut : ignorer les pseudo-systèmes de fichiers
        disks = [d for d in disks if not d["descr"].startswith(("/run", "/dev", "/sys", "/proc", "/snap", "/boot/efi"))]
    if not disks:
        raise SnmpError("aucun disque trouvé" + (f" parmi : {', '.join(wanted)}" if wanted else ""))
    return [{"key": "disk", "label": f"Disque {d['descr']}", "pct": round(100 * d["used"] / d["size"], 1),
             "text": f"{_human(d['size'] - d['used'])} libres sur {_human(d['size'])}"} for d in disks]


def fetch_custom(client, cfg):
    oid = (cfg.get("custom_oid") or "").strip()
    if not oid:
        return []
    val = client.get(oid).get(oid.strip("."))
    if val is None:
        raise SnmpError(f"OID {oid} introuvable")
    return [{"key": "custom", "label": cfg.get("custom_label") or oid, "pct": None, "text": str(val), "raw": val}]


INDICATORS = {
    "cpu": ("Processeur (CPU)", fetch_cpu),
    "ram": ("Mémoire (RAM)", fetch_ram),
    "disk": ("Espace disque", fetch_disk),
}

FIELDS = [
    {"key": "host", "label": "Machine", "kind": "text", "required": True,
     "help": "Nom ou adresse IP, ex. 192.168.1.10"},
    {"key": "indicators", "label": "Indicateurs", "kind": "multiselect", "default": ["cpu", "ram", "disk"],
     "options": [{"value": k, "label": v[0]} for k, v in INDICATORS.items()]},
    {"key": "disks", "label": "Disques à surveiller", "kind": "list",
     "help": "Points de montage séparés par des virgules, ex. /, /home (vide = tous) ; sous Windows : C:\\"},
    {"key": "warn_pct", "label": "Alerte au-delà de (%)", "kind": "number", "default": 80},
    {"key": "error_pct", "label": "Erreur au-delà de (%)", "kind": "number", "default": 95},
    {"key": "port", "label": "Port", "kind": "number", "default": 161, "advanced": True},
    {"key": "timeout", "label": "Délai max (s)", "kind": "number", "default": 3, "advanced": True},
    {"key": "custom_oid", "label": "OID personnalisé", "kind": "text", "advanced": True,
     "help": "Valeur supplémentaire à afficher, ex. 1.3.6.1.2.1.1.5.0"},
    {"key": "custom_label", "label": "Nom de cette valeur", "kind": "text", "advanced": True},
]


def run(cfg, secret):
    client = Client(cfg["host"], int(cfg["port"]), secret or "public", timeout=cfg["timeout"])
    sysname, uptime = (client.get("1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.3.0") or {}).values()

    gauges, problems = [], []
    for key in cfg.get("indicators") or []:
        if key in INDICATORS:
            try:
                gauges += INDICATORS[key][1](client, cfg)
            except SnmpError as e:
                problems.append(str(e))
    gauges += fetch_custom(client, cfg)
    if not gauges:
        raise SnmpError(" ; ".join(problems) or "aucun indicateur sélectionné")

    warn, err = cfg.get("warn_pct"), cfg.get("error_pct")
    status = "warning" if problems else "ok"
    for g in gauges:
        pct = g["pct"]
        if pct is None:
            g["level"] = "ok"
        elif err is not None and pct >= err:
            g["level"] = "error"
        elif warn is not None and pct >= warn:
            g["level"] = "warning"
        else:
            g["level"] = "ok"
        if g["level"] == "error" or (g["level"] == "warning" and status == "ok"):
            status = g["level"]

    main = next((g for g in gauges if g["pct"] is not None), gauges[0])
    summary = " · ".join(f"{g['label']} {str(g['pct']).replace('.', ',')} %" if g["pct"] is not None
                         else f"{g['label']} {g['text']}" for g in gauges)
    if problems:
        summary += " · " + " ; ".join(problems)
    days = uptime // 8640000 if isinstance(uptime, int) else None
    return {
        "status": status,
        "value": main["pct"] if main["pct"] is not None else main.get("raw"),
        "unit": "% " + main["label"] if main["pct"] is not None else "",
        "summary": summary,
        "details": {"gauges": gauges, "sysname": sysname,
                    "uptime_days": days},
    }
