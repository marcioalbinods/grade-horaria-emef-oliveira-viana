@echo off
chcp 65001 >nul
title Grade Horaria - EMEF Oliveira Viana
cd /d "%~dp0backend"
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Python nao foi encontrado neste computador.
  echo  Instale o Python 3.10 ou mais novo em https://www.python.org/downloads/
  echo  e marque a opcao "Add Python to PATH" durante a instalacao.
  echo.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Preparando o sistema pela primeira vez (pode levar alguns minutos)...
  python -m venv .venv || goto erro
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto erro
)
echo.
echo  Sistema de Grade Horaria iniciado.
echo  Abrindo http://127.0.0.1:8000 no navegador...
echo  NAO FECHE esta janela enquanto estiver usando o sistema.
echo.
start "" http://127.0.0.1:8000
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
exit /b 0
:erro
echo.
echo  Ocorreu um erro ao preparar o sistema. Verifique a conexao com a internet e tente novamente.
pause
exit /b 1
