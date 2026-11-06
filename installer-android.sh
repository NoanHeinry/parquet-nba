#!/data/data/com.termux/files/usr/bin/bash
# Installe Parquet sur un téléphone Android, dans l'application Termux, sans ordinateur.
#
# Dans Termux, colle ces deux lignes, l'une après l'autre (la première met tout Termux à jour :
# mettre à jour un seul paquet, comme curl, peut casser les autres) :
#   apt update && apt full-upgrade -y -o Dpkg::Options::=--force-confnew
#   curl -fsSL https://raw.githubusercontent.com/NoanHeinry/parquet-nba/main/installer-android.sh | bash
#
# Le script peut être relancé sans risque : il met à jour ce qui existe déjà.

set -eu
REPO="${PARQUET_REPO:-https://github.com/NoanHeinry/parquet-nba.git}"
APP="${PARQUET_DIR:-$HOME/parquet-nba}"

say() { printf '\n\033[1;33m» %s\033[0m\n' "$1"; }

case "${PREFIX:-}" in
  *com.termux*) ;;
  *)
    echo "Ce script s'utilise dans l'application Termux sur Android."
    echo "Sur un ordinateur, lance plutôt lancer.bat (Windows) ou lancer.command (Mac, Linux)."
    exit 1
    ;;
esac

say "Installation des outils (Python et Git)"
# Non interactif : le script peut être lu depuis un tube (curl | bash), aucune question ne doit lire l'entrée.
export DEBIAN_FRONTEND=noninteractive
APT_OPTS="-y -o Dpkg::Options::=--force-confnew -o Dpkg::Options::=--force-confdef"
apt-get update </dev/null
apt-get $APT_OPTS full-upgrade </dev/null
apt-get $APT_OPTS install python git </dev/null

say "Téléchargement de Parquet"
if [ -d "$APP/.git" ]; then
  git -C "$APP" pull --ff-only </dev/null
else
  git clone --depth 1 "$REPO" "$APP" </dev/null
fi

say "Installation des bibliothèques Python"
# Environnement Python propre à Parquet (comme lancer.command sur ordinateur).
[ -x "$APP/.venv/bin/python" ] || python -m venv "$APP/.venv" </dev/null
"$APP/.venv/bin/python" -m pip install --disable-pip-version-check -q -r "$APP/requirements.txt" </dev/null

say "Création de la commande « parquet » et des raccourcis"
cp "$APP/android/parquet" "$PREFIX/bin/.parquet.new"
chmod 755 "$PREFIX/bin/.parquet.new"
mv -f "$PREFIX/bin/.parquet.new" "$PREFIX/bin/parquet"

# Raccourcis pour le widget Termux:Widget (écran d'accueil du téléphone).
mkdir -p "$HOME/.shortcuts/tasks"
chmod 700 "$HOME/.shortcuts" "$HOME/.shortcuts/tasks"
cat > "$HOME/.shortcuts/Parquet" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
parquet
SH
cat > "$HOME/.shortcuts/tasks/Arrêter Parquet" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
parquet stop
SH
chmod 700 "$HOME/.shortcuts/Parquet" "$HOME/.shortcuts/tasks/Arrêter Parquet"

say "Parquet est installé"
cat <<'TXT'
  Pour lancer Parquet : tape  parquet
  (ou utilise le widget Termux:Widget « Parquet » sur l'écran d'accueil)

  Autres commandes :
    parquet stop         arrêter Parquet
    parquet maj          mettre Parquet à jour
    parquet demo         mode démonstration (données fictives)
    parquet diagnostic   tester l'accès à NBA.com
    parquet serveur      faire de ce téléphone le serveur de tes autres appareils
TXT
