# Monitoring — tableau de bord sur mesure

Surveillez vos boîtes mail, vos API et vos machines depuis une seule page web, et gérez vos sondes directement dans l'interface.

- **Tableau de bord** : chiffres clés (OK / alertes / erreurs / mails non lus), une carte par sonde avec sa valeur, sa courbe et l'historique de ses dernières vérifications, regroupées par groupe.
- **Sondes** : ajouter, modifier, dupliquer, désactiver ou supprimer une sonde, et la **tester** avant de l'enregistrer. Cette page est **réservée à l'administrateur** (identifiant + mot de passe) ; le tableau de bord reste consultable sans connexion, sans afficher les adresses ni les URL.
- **Thème clair / sombre** et filtre **« Alertes et erreurs »** : vos choix sont mémorisés par le navigateur.

Types de sondes disponibles :

| Type | Ce qu'elle vérifie |
|---|---|
| Boîte mail (IMAP) | nombre de mails non lus et aperçu des derniers (sans les marquer comme lus) ; une fois connecté, un bouton au survol de chaque mail le déplace dans la corbeille (jamais de suppression définitive) |
| API / site web (HTTP) | code de retour, temps de réponse, texte attendu, valeur extraite d'une réponse JSON |
| Ping / port TCP | la machine répond-elle, en combien de temps, avec quelles pertes |
| Machine distante (SNMP) | utilisation du processeur, de la mémoire et de l'espace disque, avec seuils d'alerte et d'erreur (SNMP v2c) |

### Activer SNMP sur une machine à surveiller

- **Linux (Debian, Ubuntu, Proxmox…)** :
  ```sh
  apt install snmpd
  nano /etc/snmp/snmpd.conf
  #   remplacer la ligne « agentaddress ... » par :   agentaddress udp:161
  #   ajouter :                                        rocommunity MaCommunaute 192.168.1.0/24
  systemctl restart snmpd
  ```
  (adaptez le réseau `192.168.1.0/24` au vôtre, et choisissez une communauté autre que `public`.)
- **Windows** : Paramètres → Fonctionnalités facultatives → ajouter « SNMP (Simple Network Management Protocol) », puis dans les Services, propriétés de « Service SNMP » → onglet Sécurité : ajouter la communauté (lecture seule) et l'adresse du conteneur de monitoring.
- **NAS Synology / QNAP, routeurs…** : option SNMP dans le panneau de configuration (activer SNMPv1/v2c et définir la communauté).

Dans la sonde, la communauté se saisit dans le champ « Communauté SNMP ». Seul SNMP v2c est pris en charge pour l'instant.

## Architecture

```
navigateur ──HTTP──▶ server.py ── API /api/... ──▶ store.py (SQLite : sondes, mots de passe, historique)
   (React)              │
                        └─ planificateur ──▶ checks/imap.py, http.py, ping.py ──▶ vos services
```

- **Serveur** : Python 3.11+, **bibliothèque standard uniquement** (aucune dépendance à installer).
- **Interface** : React, déjà compilée dans `static/`. **Node n'est pas nécessaire** pour l'utiliser ; il ne sert que si vous voulez modifier l'interface (voir plus bas).
- **Données** : `data/monitoring.db` (base SQLite). Les mots de passe des sondes y sont stockés, ne sont jamais renvoyés à la page, et le fichier n'est lisible que par le service.
- **Extensible** : un nouveau type de sonde = un module dans `checks/` qui décrit ses champs. Le formulaire de l'interface se construit tout seul à partir de cette description.

## Fichiers

| Fichier | Rôle |
|---|---|
| `server.py` | serveur web, API (jetons d'accès pour Home Assistant inclus), planification des sondes |
| `store.py` | base SQLite |
| `checks/` | un module par type de sonde (`snmp.py` contient un petit client SNMP ; un nouvel indicateur s'ajoute dans `INDICATORS`) |
| `static/` | interface compilée (générée depuis `web/`) |
| `web/` | code source React de l'interface |
| `config.example.toml` | réglages du serveur (adresse, port, dossier des données) |
| `deploy/` | installation dans un conteneur LXC Proxmox |

---

## Tester sur votre PC

Il suffit de Python 3.11 ou plus récent (`py --version` sous Windows, `python3 --version` ailleurs).

```sh
tar xzf monitoring.tar.gz
cd monitoring
py server.py          # Windows   (python3 server.py sous macOS / Linux)
```

Ouvrez http://127.0.0.1:8080 et allez dans **Sondes**. À la première visite, la page vous demande de **créer le compte administrateur** (identifiant + mot de passe de 8 caractères minimum). Ensuite, **Nouvelle sonde** et ajoutez votre boîte Free (identifiant = adresse complète, mot de passe de la boîte). Cliquez **Tester** pour vérifier, puis **Enregistrer**. `Ctrl+C` dans le terminal arrête le serveur.

Vous aviez la première version avec des blocs `[[check]]` dans `config.toml` et un `secrets.env` ? Gardez-les dans le dossier : au premier lancement, les boîtes sont importées automatiquement comme sondes, avec leur mot de passe.

---

# Déploiement sur Proxmox (conteneur LXC)

Comptez 10 à 15 minutes. Les commandes `pct` / `pveam` se tapent dans le **Shell du nœud Proxmox** (interface web → cliquez sur le nom du nœud → *Shell*), ou en SSH sur le Proxmox.

## 1. Télécharger un modèle Debian

Interface web : *local* (stockage) → *CT Templates* → bouton *Templates* → choisir `debian-12-standard` (ou `debian-13-standard`) → *Download*.

Ou en ligne de commande :

```sh
pveam update
pveam available --section system | grep debian
pveam download local debian-12-standard_12.12-1_amd64.tar.zst   # nom exact affiché par la commande précédente
```

## 2. Créer le conteneur

Interface web : bouton bleu **Create CT** en haut à droite, puis :

| Onglet | Valeur conseillée |
|---|---|
| General | Hostname `monitoring`, *Unprivileged container* coché, mot de passe root de votre choix |
| Template | le modèle Debian téléchargé |
| Disks | 4 Go |
| CPU | 1 cœur |
| Memory | 512 Mo (swap 512) |
| Network | bridge `vmbr0`, IPv4 *DHCP* (ou une IP fixe, plus pratique pour un favori) |
| DNS | laisser par défaut |
| Confirm | cocher *Start after created* |

Ensuite, dans *Options* du conteneur, mettez **Start at boot = Yes**.

Équivalent en une commande (remplacez `120` par un numéro libre et le nom du modèle) :

```sh
pct create 120 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
  --hostname monitoring --cores 1 --memory 512 --swap 512 \
  --rootfs local-lvm:4 --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 --features nesting=1 --onboot 1 --password
pct start 120
```

## 3. Copier l'application dans le conteneur

```sh
# sur votre PC
scp monitoring.tar.gz root@IP_DU_PROXMOX:/root/

# sur le Proxmox
pct push 120 /root/monitoring.tar.gz /root/monitoring.tar.gz
```

## 4. Installer

```sh
# sur le Proxmox : ouvrir un shell dans le conteneur
pct enter 120

# dans le conteneur
cd /root
tar xzf monitoring.tar.gz
sh monitoring/deploy/install.sh
```

Le script installe Python, crée un utilisateur système `monitoring`, copie l'application dans `/opt/monitoring`, place la base dans `/var/lib/monitoring` et déclare le service pour qu'il démarre tout seul.

## 5. Ouvrir le tableau de bord

`http://IP_DU_CONTENEUR:8080` (l'IP est affichée à la fin de l'installation, ou dans l'onglet *Summary* du conteneur dans Proxmox), puis allez dans **Sondes** : créez tout de suite le compte administrateur (le premier venu peut le créer), puis ajoutez vos sondes.

## Au quotidien

```sh
systemctl status monitoring        # le service tourne-t-il ?
journalctl -u monitoring -f        # journaux en direct
```

**Mise à jour** : recopier la nouvelle archive (étape 3), la décompresser et relancer `sh monitoring/deploy/install.sh`. Vos sondes, leur historique et vos réglages sont conservés.

**Sauvegarde** : tout est dans `/var/lib/monitoring/monitoring.db` (ou utilisez les sauvegardes Proxmox du conteneur).

## Mot de passe administrateur oublié

Arrêtez le serveur puis relancez-le une fois avec `--reset-admin` : le compte est supprimé (les sondes sont conservées) et la page **Sondes** propose d'en créer un nouveau.

```sh
py server.py --reset-admin                       # sur votre PC
# sur le conteneur :
systemctl stop monitoring
runuser -u monitoring -- python3 /opt/monitoring/server.py /etc/monitoring/config.toml --reset-admin   # puis Ctrl+C
systemctl start monitoring
```

## Home Assistant

L'intégration [ha-monitoring](https://github.com/jcpasdutout/ha-monitoring) (installable avec HACS) affiche chaque sonde comme un appareil dans Home Assistant.
Elle se connecte avec un **jeton d'accès** : menu de votre compte (en haut à droite) → **Jetons d'accès (Home Assistant)** → **Créer**, puis copiez le jeton (il n'est affiché qu'une fois).
Un jeton permet seulement de lire l'état des sondes et de les relancer, jamais de les modifier ; supprimez-le pour couper l'accès.

## Sécurité

- Gardez la page sur votre réseau local : pas de redirection de port sur la Freebox. Pour un accès à distance, passez par un VPN (WireGuard de la Freebox, Tailscale…).
- Si une boîte mail affiche « connexion refusée par le serveur », vérifiez l'identifiant (adresse complète `xxx@free.fr`) et le mot de passe.

## Modifier l'interface (optionnel, nécessite Node.js 20+)

```sh
cd web
npm install
npm run dev      # interface de développement sur http://localhost:5173 (le serveur Python doit tourner)
npm run build    # régénère static/
```
