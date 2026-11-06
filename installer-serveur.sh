#!/bin/bash
# Installe Parquet comme un service permanent sur un Raspberry Pi ou un ordinateur Linux
# (Raspberry Pi OS, Debian, Ubuntu…). Parquet démarre avec la machine, redémarre tout seul en
# cas de problème et se met à jour chaque nuit.
#
# Dans un terminal de la machine (connecté avec ton utilisateur habituel, pas root) :
#   curl -fsSL https://raw.githubusercontent.com/NoanHeinry/parquet-nba/main/installer-serveur.sh | bash
#
# Pour protéger Parquet par un code d'accès dès l'installation :
#   curl -fsSL https://raw.githubusercontent.com/NoanHeinry/parquet-nba/main/installer-serveur.sh | PARQUET_ACCES=MonCodeSecret bash
#
# Le script peut être relancé sans risque : il met à jour ce qui existe déjà.

set -eu
REPO="${PARQUET_REPO:-https://github.com/NoanHeinry/parquet-nba.git}"
APP="${PARQUET_DIR:-$HOME/parquet-nba}"
PORT="${PARQUET_PORT:-8765}"
CODE="${PARQUET_ACCES:-}"
USER_NAME="$(id -un)"

say() { printf '\n\033[1;33m» %s\033[0m\n' "$1"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Lance ce script avec ton utilisateur habituel (pas root, pas sudo) : il demandera le mot de passe quand il le faut."
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1 || ! command -v apt-get >/dev/null 2>&1; then
  echo "Ce script vise Raspberry Pi OS, Debian ou Ubuntu (apt et systemd)."
  echo "Ailleurs, lance simplement : python3 run.py --lan --no-browser"
  exit 1
fi
case "$PORT" in ''|*[!0-9]*) echo "PARQUET_PORT doit être un nombre."; exit 1 ;; esac

say "Installation des outils (Python et Git)"
sudo env DEBIAN_FRONTEND=noninteractive apt-get update -q </dev/null
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q git python3 python3-venv curl </dev/null

say "Téléchargement de Parquet"
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull --ff-only </dev/null
else
  git clone --depth 1 "$REPO" "$APP" </dev/null
fi

say "Installation des bibliothèques Python"
[ -x "$APP/.venv/bin/python" ] || python3 -m venv "$APP/.venv" </dev/null
"$APP/.venv/bin/python" -m pip install --disable-pip-version-check -q -r "$APP/requirements.txt" </dev/null

say "Création du service (démarrage automatique et mise à jour chaque nuit)"
sudo mkdir -p /etc/parquet
printf 'PARQUET_USER=%s\nPARQUET_DIR=%s\nPARQUET_PORT=%s\n' "$USER_NAME" "$APP" "$PORT" | sudo tee /etc/parquet/serveur.conf >/dev/null
sudo touch /etc/parquet/parquet.env
sudo chmod 600 /etc/parquet/parquet.env
sudo install -m 755 "$APP/serveur/parquet-serveur" /usr/local/bin/parquet-serveur

sudo tee /etc/systemd/system/parquet.service >/dev/null <<UNIT
[Unit]
Description=Parquet, tableau de bord NBA
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP
EnvironmentFile=-/etc/parquet/parquet.env
ExecStart=$APP/.venv/bin/python run.py --lan --no-browser --port-fixe --port $PORT
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/parquet-maj.service >/dev/null <<'UNIT'
[Unit]
Description=Mise à jour de Parquet
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/parquet-serveur maj
UNIT

sudo tee /etc/systemd/system/parquet-maj.timer >/dev/null <<'UNIT'
[Unit]
Description=Mise à jour de Parquet chaque nuit

[Timer]
OnCalendar=*-*-* 04:40
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now parquet-maj.timer >/dev/null
sudo systemctl enable parquet >/dev/null

if [ -n "$CODE" ]; then
  parquet-serveur code "$CODE"
else
  sudo systemctl restart parquet
fi

# Attend que Parquet réponde (le premier démarrage d'un Raspberry Pi peut prendre quelques secondes).
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/img/icon.svg"; then break; fi
  sleep 1
done

say "Parquet est installé et tourne en permanence"
parquet-serveur etat || true
cat <<'TXT'

  Commandes utiles :
    parquet-serveur etat         adresses où ouvrir Parquet
    parquet-serveur tailscale    l'ouvrir de partout (4G, travail…), en privé et en HTTPS
    parquet-serveur code XXXXX   protéger Parquet par un code d'accès
    parquet-serveur maj          mise à jour immédiate (sinon : chaque nuit, toute seule)
    parquet-serveur journal      voir ce que fait Parquet
TXT
