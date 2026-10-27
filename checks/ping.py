"""Sonde ping : ICMP (commande ping du système) ou connexion TCP sur un port."""
import platform
import re
import socket
import subprocess
import time

TYPE = "ping"
LABEL = "Ping / port TCP"
DESCRIPTION = "Vérifie qu'une machine répond, par ping ou en ouvrant une connexion sur un port."
SECRET = None
FIELDS = [
    {"key": "host", "label": "Machine", "kind": "text", "required": True,
     "help": "Nom ou adresse IP, ex. 192.168.1.1"},
    {"key": "port", "label": "Port TCP", "kind": "number",
     "help": "Laisser vide pour un ping classique ; ex. 22, 443 pour tester un service"},
    {"key": "count", "label": "Nombre d'essais", "kind": "number", "default": 3, "advanced": True},
    {"key": "timeout", "label": "Délai max par essai (s)", "kind": "number", "default": 2, "advanced": True},
    {"key": "warn_ms", "label": "Alerte si plus lent que (ms)", "kind": "number", "default": 200},
]

_RTT = re.compile(r"(?:time|temps|zeit)\s*[=<]\s*([\d.,]+)\s*ms", re.I)


def _icmp(host, count, timeout):
    if platform.system() == "Windows":
        cmd = ["ping", "-n", str(count), "-w", str(int(timeout * 1000)), host]
    else:
        cmd = ["ping", "-n", "-c", str(count), "-W", str(max(1, int(timeout))), host]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=count * (timeout + 1) + 5)
    except FileNotFoundError:
        raise RuntimeError("commande ping absente (installez iputils-ping)") from None
    text = out.stdout.decode(errors="replace")
    return [float(x.replace(",", ".")) for x in _RTT.findall(text)]


def _tcp(host, port, count, timeout):
    times = []
    for _ in range(count):
        start = time.monotonic()
        try:
            with socket.create_connection((host, port), timeout=timeout):
                times.append((time.monotonic() - start) * 1000)
        except OSError:
            pass
    return times


def run(cfg, secret):
    host, count, timeout = cfg["host"], max(1, int(cfg["count"])), cfg["timeout"]
    port = cfg.get("port")
    times = _tcp(host, int(port), count, timeout) if port else _icmp(host, count, timeout)
    target = f"{host}:{int(port)}" if port else host
    if not times:
        return {"status": "error", "summary": f"{target} ne répond pas",
                "details": {"sent": count, "received": 0}}
    avg = round(sum(times) / len(times), 1)
    loss = round(100 * (count - len(times)) / count)
    status = "ok"
    if loss or (cfg.get("warn_ms") and avg > cfg["warn_ms"]):
        status = "warning"
    summary = f"{avg} ms" + (f" · {loss} % de pertes" if loss else "")
    return {"status": status, "value": avg, "unit": "ms", "summary": summary,
            "details": {"sent": count, "received": len(times), "loss_pct": loss}}
