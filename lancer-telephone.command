#!/bin/bash
# Lance Parquet accessible depuis le téléphone (même Wi-Fi), sur macOS ou Linux (double-clic sur Mac, ou « bash lancer.command » dans un terminal).
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 est introuvable. Installe-le depuis https://www.python.org/downloads/ puis relance ce fichier."
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "Première installation : préparation de l'environnement Python…"
  if ! python3 -m venv .venv; then
    echo "Impossible de créer l'environnement Python (sous Linux, installe le paquet python3-venv)."
    read -r -p "Appuie sur Entrée pour fermer…"
    exit 1
  fi
fi

echo "Vérification des dépendances…"
if ! .venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt; then
  echo "L'installation des dépendances a échoué. Vérifie ta connexion Internet puis relance ce fichier."
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
fi

exec .venv/bin/python run.py --lan "$@"
