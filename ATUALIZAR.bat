@echo off
title Atualizacao - Ferramenta de Laudos
cd /d "%~dp0"
echo ============================================
echo   Ferramenta de Laudos - Atualizacao
echo ============================================
echo.
echo Baixando a versao mais recente...
git pull
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel atualizar.
  echo Feche o app (janela preta) se estiver aberto e tente de novo.
  pause
  exit /b 1
)
echo.
echo Ajustando dependencias...
call npm install
echo.
echo ============================================
echo   Atualizado! Pode abrir o app normalmente.
echo   (seus projetos e fotos nao sao afetados)
echo ============================================
pause
