@echo off
title Atualizacao - Ferramenta de Laudos
cd /d "%~dp0"
echo ============================================
echo   Ferramenta de Laudos - Atualizacao
echo ============================================
echo.

REM --- Garante o Node.js no PATH (mesmo se ainda nao propagou) ---
where node >nul 2>nul && goto :ok
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%" & goto :ok
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%" & goto :ok
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%" & goto :ok
echo [ERRO] Node.js nao encontrado. Rode o INSTALAR.bat primeiro.
goto :fim

:ok
echo Baixando a versao mais recente...
git pull
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel atualizar.
  echo Feche o app (janela preta) se estiver aberto e tente de novo.
  goto :fim
)
echo.
echo Ajustando dependencias...
call npm install
echo.
echo ============================================
echo   Atualizado! Pode abrir o app normalmente.
echo   (seus projetos e fotos nao sao afetados)
echo ============================================

:fim
echo.
pause
