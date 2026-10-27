#!/bin/sh
# Installation / mise à jour dans un conteneur Debian (LXC Proxmox).
# À lancer en root depuis le dossier décompressé : sh deploy/install.sh
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update -qq
apt-get install -y -qq python3 ca-certificates iputils-ping >/dev/null

id monitoring >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin monitoring

mkdir -p /opt/monitoring /etc/monitoring /var/lib/monitoring
rm -rf /opt/monitoring/static /opt/monitoring/checks
cp -r "$SRC/server.py" "$SRC/store.py" "$SRC/checks" "$SRC/static" /opt/monitoring/
chown monitoring:monitoring /var/lib/monitoring
chmod 700 /var/lib/monitoring

# La configuration et les secrets ne sont jamais écrasés lors d'une mise à jour.
if [ ! -f /etc/monitoring/config.toml ]; then
  cat > /etc/monitoring/config.toml <<'CONF'
[server]
host = "0.0.0.0"
port = 8080
data_dir = "/var/lib/monitoring"
CONF
fi
if [ ! -f /etc/monitoring/secrets.env ]; then
  cp "$SRC/deploy/secrets.env.example" /etc/monitoring/secrets.env
fi
chown root:monitoring /etc/monitoring/config.toml /etc/monitoring/secrets.env
chmod 640 /etc/monitoring/config.toml /etc/monitoring/secrets.env

cp "$SRC/deploy/monitoring.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable monitoring >/dev/null
systemctl restart monitoring

echo
echo "Installé. Ouvrez http://$(hostname -I | awk '{print $1}'):8080, allez dans Sondes et créez le compte administrateur."
