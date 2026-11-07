#!/bin/bash
# Vérifications rapides du code, avant les tests (aussi lancées par GitHub à chaque envoi).
#   bash scripts/verifier-code.sh
# - JavaScript : syntaxe de chaque fichier de web/, lu comme un module (import/export).
#   « node --check fichier.js » seul ne suffit pas : il ne signale rien sur un module ES invalide.
# - Scripts shell : syntaxe (bash -n), plus ShellCheck (erreurs seulement) s'il est installé.
# - Python : compilation de tous les fichiers.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

js=0
while IFS= read -r f; do
  cp "$f" "$tmp/module.mjs"
  if ! out=$(node --check "$tmp/module.mjs" 2>&1); then
    echo "JavaScript invalide : $f"
    echo "$out" | sed -n '1,4p'
    fail=1
  fi
  js=$((js + 1))
done < <(git ls-files 'web/*.js')
echo "JavaScript : $js fichiers vérifiés"

shells="android/parquet installer-android.sh installer-serveur.sh serveur/parquet-serveur scripts/verifier-code.sh"
for f in $shells; do
  bash -n "$f" || { echo "Script shell invalide : $f"; fail=1; }
done
if command -v shellcheck >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  shellcheck -S error $shells || fail=1
  echo "Scripts shell : syntaxe et ShellCheck"
else
  echo "Scripts shell : syntaxe (ShellCheck non installé)"
fi

python3 -m compileall -q parquet run.py tests scripts >/dev/null || { echo "Python : erreur de compilation"; fail=1; }
echo "Python : compilation"

[ "$fail" = 0 ] && echo "Tout est correct." || echo "Des erreurs sont à corriger."
exit "$fail"
