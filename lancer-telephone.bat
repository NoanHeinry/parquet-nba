@echo off
setlocal
cd /d "%~dp0"
title Parquet - acces depuis le telephone

rem Recherche de Python (lanceur "py" installe avec Python, sinon "python").
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY goto :nopython

if not exist ".venv\Scripts\python.exe" (
  echo Premiere installation : preparation de l'environnement Python...
  %PY% -m venv .venv
  if errorlevel 1 goto :nopython
)

echo Verification des dependances...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 goto :piperror

".venv\Scripts\python.exe" run.py --lan %*
goto :eof

:nopython
echo.
echo Python est introuvable ou ne fonctionne pas.
echo Installe-le depuis https://www.python.org/downloads/
echo (pendant l'installation, coche la case "Add python.exe to PATH"),
echo puis relance ce fichier.
echo.
pause
exit /b 1

:piperror
echo.
echo L'installation des dependances a echoue. Verifie ta connexion Internet puis relance ce fichier.
echo.
pause
exit /b 1
