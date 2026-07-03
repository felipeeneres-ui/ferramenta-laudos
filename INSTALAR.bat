@echo off
title Instalacao - Ferramenta de Laudos
cd /d "%~dp0"
echo ============================================
echo   Ferramenta de Auxilio em Laudos - CRAFT
echo   Instalacao / atualizacao de dependencias
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado.
  echo.
  echo Instale o Node.js LTS primeiro (site vai abrir agora),
  echo depois rode este INSTALAR.bat de novo.
  start https://nodejs.org/pt/download
  pause
  exit /b 1
)

echo [1/2] Instalando dependencias (pode demorar alguns minutos)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERRO] A instalacao falhou. Verifique a internet e tente de novo.
  pause
  exit /b 1
)

echo.
echo [2/2] Criando atalho "Abrir Laudos" na Area de Trabalho...
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESK=%%D"
(
  echo @echo off
  echo call "%~dp0Abrir Laudos.bat"
) > "%DESK%\Abrir Laudos.bat"

echo.
echo ============================================
echo   Pronto! Para usar, de dois cliques em
echo   "Abrir Laudos" na Area de Trabalho.
echo ============================================
pause
