#!/usr/bin/env bash
# Inicia o Sistema de Grade Horária (Linux / macOS).
set -e
cd "$(dirname "$0")/backend"
PY=$(command -v python3 || command -v python || true)
if [ -z "$PY" ]; then
  echo "Python 3.10+ não encontrado. Instale em https://www.python.org/downloads/"; exit 1
fi
if [ ! -x .venv/bin/python ]; then
  echo "Preparando o sistema pela primeira vez (pode levar alguns minutos)..."
  "$PY" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt
fi
URL="http://127.0.0.1:8000"
echo "Sistema iniciado em $URL  (Ctrl+C para encerrar)"
( sleep 2; (xdg-open "$URL" || open "$URL") >/dev/null 2>&1 || true ) &
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
