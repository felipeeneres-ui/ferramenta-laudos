# Ferramenta de Auxílio em Laudos — Instalação

App local para elaboração de laudos (croqui, fotos, tabelas). Roda 100% no seu
computador: os projetos ficam no seu navegador e as fotos nas suas pastas —
nada é enviado para a internet.

## Instalar (uma vez só)

1. **Node.js LTS** — baixe e instale: https://nodejs.org/pt/download
   (instalação padrão, só "Avançar")
2. **Git** — baixe e instale: https://git-scm.com/download/win
   (instalação padrão)
3. Abra o **Prompt de Comando** (menu Iniciar → digite `cmd`) e cole:

   ```
   git clone https://github.com/felipeeneres-ui/ferramenta-laudos.git %USERPROFILE%\ferramenta-laudos
   ```

4. Abra a pasta `ferramenta-laudos` (fica em Usuários → seu nome) e dê dois
   cliques em **`INSTALAR.bat`**. Ele instala as dependências e cria o atalho
   **"Abrir Laudos"** na Área de Trabalho.

## Usar

- Dois cliques em **"Abrir Laudos"** (Área de Trabalho). Uma janela preta abre
  (é o motor do app — deixe aberta) e o navegador entra sozinho no app.
- Para fechar, feche a janela preta.
- **Use sempre o mesmo navegador** (recomendado: Chrome ou Edge) — os projetos
  ficam salvos nele, automaticamente, a cada alteração.

## Atualizar (quando houver versão nova)

- Feche o app (janela preta) e dê dois cliques em **`ATUALIZAR.bat`** na pasta
  do programa. Pronto — seus projetos e fotos **não** são afetados.

## Trocar projetos entre colegas

- Na tela inicial, cada projeto tem um botão de **baixar backup (.json)**.
- Envie o arquivo ao colega; ele usa **Importar (.json)** na tela inicial.
- As fotos originais não vão no backup: quem recebe aponta a própria pasta de
  fotos (botão "Escolher pasta" na aba Fotos), se precisar reeditar imagens.

## Problemas comuns

- **"Porta 5173 em uso"**: já existe uma janela preta aberta — feche-a e abra
  de novo.
- **Fotos sem miniatura após reabrir**: clique em qualquer foto/edição e o
  navegador pedirá permissão para acessar a pasta — aceite.
- **Projeto sumiu**: confira se está no mesmo navegador de sempre e no
  endereço `http://localhost:5173`.
