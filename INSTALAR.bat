@echo off
title Instalacao - Ferramenta de Laudos
cd /d "%~dp0"
echo ============================================
echo   Ferramenta de Auxilio em Laudos - CRAFT
echo   Instalacao / atualizacao de dependencias
echo ============================================
echo.

REM --- Detecta o Node.js: primeiro no PATH, depois nas pastas padrao ---
where node >nul 2>nul && goto :node_ok
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%" & goto :node_ok
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%" & goto :node_ok
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%" & goto :node_ok

echo Node.js nao foi encontrado neste computador.
echo.
echo   - Se voce ACABOU de instalar o Node.js: feche esta janela,
echo     REINICIE o computador e rode este INSTALAR.bat de novo.
echo   - Se ainda nao instalou: baixe o Node.js LTS e instale.
echo.
choice /c SN /n /m "Abrir a pagina de download do Node.js agora? (S/N): "
if errorlevel 2 goto :fim
start https://nodejs.org/pt/download
goto :fim

:node_ok
for /f "delims=" %%V in ('node --version 2^>nul') do echo Node.js encontrado: %%V
echo.
echo [1/2] Instalando dependencias (pode demorar alguns minutos)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERRO] A instalacao falhou. Verifique a internet e tente de novo.
  goto :fim
)

echo.
echo [2/2] Criando atalho "Abrir Laudos" na Area de Trabalho...
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESK=%%D"
> "%DESK%\Abrir Laudos.bat" echo @echo off
>> "%DESK%\Abrir Laudos.bat" echo call "%~dp0Abrir Laudos.bat"

echo.
echo ============================================
echo   Pronto! Para usar, de dois cliques em
echo   "Abrir Laudos" na Area de Trabalho.
echo ============================================

:fim
echo.
pause
