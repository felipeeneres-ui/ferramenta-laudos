@echo off
title Ferramenta de Laudos  -  mantenha esta janela aberta
cd /d "%~dp0"
echo.
echo   Iniciando a Ferramenta de Laudos...
echo   O navegador vai abrir sozinho em alguns segundos.
echo.
echo   *** NAO FECHE esta janela enquanto estiver usando o app. ***
echo   (para encerrar, feche esta janela)
echo.
start "" /min cmd /c "timeout /t 5 >nul && start http://localhost:5173"
call npm run dev
pause
