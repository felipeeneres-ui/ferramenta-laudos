# Ferramenta de Auxílio em Laudos — Editor de Croqui

App web local para auxiliar a elaboração de laudos de **Vistoria Cautelar de Vizinhança (VCV)**.
Esta primeira parte é o **editor de croqui** (planta baixa esquemática), que substitui o uso do Revit.

## Como rodar

```bash
npm install      # só na primeira vez
npm run dev      # abre em http://localhost:5173
```

## O que já dá pra fazer

- **Desenhar paredes** com snap na grade (ferramenta Parede; clique para encadear pontos, botão direito encerra).
- **Inserir porta, janela e escada** clicando sobre uma parede. Todas são **móveis** (arraste / posição no painel) e **redimensionáveis** (alças nas pontas / largura no painel).
- **Rótulos de cômodo** (Garagem, Sala, Quarto 1…).
- **Pontos de anomalia**: a **cor** indica o local (parede = azul, piso = âmbar, teto = roxo) e a **letra** indica o tipo (F, U, CE, D…). Numeração contínua por tipo no imóvel inteiro. Tipos editáveis + "Novo tipo".
- **Vários pavimentos** por imóvel (abas Térreo / 2º / …).
- **Pan** (ferramenta de mão ou botão do meio do mouse) e **zoom** (roda do mouse).
- **Salvar/abrir** projeto como `.json` e **exportar PNG** do pavimento (para colar no Word). Salvamento automático no navegador.

### Onde os projetos ficam salvos

Os projetos são gravados automaticamente numa pasta do computador, a cada alteração. O navegador guarda só uma cópia de trabalho, então o mesmo projeto aparece em qualquer navegador e não se perde ao limpar os dados de navegação.

- **Pasta**: definida em `dados.config.json`, na pasta do sistema (ex.: `{"pasta": "C:\\Users\\voce\\OneDrive\\Laudos"}`). Sem esse arquivo, vai para `projetos-dados/` dentro da pasta do sistema. Mudou a pasta, feche e abra o sistema.
- **Cada projeto é uma pasta** `Nome do projeto (id)`, com `projeto.json`, `fundos/` (imagens de fundo das camadas), `miniaturas/` (galeria de fotos) e `backups/` (uma cópia por dia do `projeto.json`, as 15 últimas).
- **Excluir** um projeto move a pasta dele para `_lixeira/`. Para recuperar, mova a pasta de volta e abra o sistema.
- **Fotos originais** continuam na pasta da vistoria; o sistema guarda só o vínculo. Ao abrir o projeto em outro navegador, escolha de novo a pasta de fotos de cada camada para religar os originais.
- A tela inicial mostra a pasta em uso, e o topo do projeto mostra "Salvo na pasta às HH:MM".
- Com o projeto aberto em dois navegadores ao mesmo tempo, vale a última gravação. Use um por vez.

### Vistoria de rua (croqui sobre imagem de satélite)

Serve para vistoria cautelar de vizinhança feita na rua, por exemplo as quatro ruas em volta de uma quadra.

- **Croqui de rua** (botão na barra do croqui): cole a coordenada de um ponto dentro da quadra da obra (como o Google Maps copia) e clique em **Buscar quadra**. O sistema consulta o OpenStreetMap e mostra a quadra e as ruas em volta. Precisa de internet.
  - **Croqui único** (padrão): um desenho só, com a quadra inteira alinhada à folha no giro mais próximo do norte, sem edificações. Cada rua vira um grupo: recebe a sua pasta de fotos, e os pontos ficam registrados na rua (a tabela sai agrupada por rua), mesmo aparecendo todos no mesmo croqui. A aba da rua ativa define em qual rua entram os pontos criados direto no croqui; ponto criado a partir de uma foto já entra na rua da foto. Numeração contínua e pino de uma cor só.
  - **Uma base por rua**: cada rua vira uma camada com desenho próprio, girado para a rua ficar na horizontal.
  - Dá para ajustar a largura da pista de cada rua e o entorno desenhado, e baixar o desenho em PNG. O crédito "© colaboradores do OpenStreetMap" sai no desenho porque a licença exige.
- **Imagem de satélite por baixo do desenho**: no croqui único, o painel da direita tem os blocos "Desenho da quadra" e "Imagem de satélite", cada um com a sua opacidade. **Baixar automática, já alinhada** busca a imagem da Esri e encaixa no desenho (o crédito sai na imagem). Para usar um recorte do Google Maps, copie e cole com `Ctrl+V`; depois destrave para mover, redimensionar e girar até encaixar.
- **Camadas**: cada aba do croqui é uma camada (pavimento ou rua). O botão `+` cria outra; clique duplo na aba renomeia (ex.: "Rua das Palmeiras").
- **Imagem de fundo**: botão **Fundo**, ou copie um recorte do satélite do Google Maps e cole com `Ctrl+V` no croqui. No painel da imagem, **Usar em todas as camadas** repete a mesma imagem, na mesma posição e escala, nas outras camadas.
- **Fotos por rua**: com mais de uma camada, a tela Fotos ganha uma aba por camada. Escolha a camada e depois **Escolher pasta de (camada)**: cada rua fica com a sua pasta, e a cópia editada de cada foto volta para a pasta da própria rua. O mesmo nome de arquivo pode existir em ruas diferentes.
- **Tabela**: numa camada sem rótulos de cômodo, os pontos são agrupados pelo nome da camada (a rua).
- **Linhas de chamada**: selecione um ponto e arraste a alça ao lado dele (ou `Alt` + arrastar o ponto) para puxar o rótulo; o local fica marcado e ligado por uma linha. Solte o rótulo sobre o local para recolher. **Organizar rótulos** afasta de uma vez os que estão sobrepostos.

### Atalhos
`V` selecionar · `W` parede · `P` ponto · `Delete` excluir · `Esc` volta para selecionar.

## Próximas fases
2. Editor de fotos (setas, caixas de texto, desfoque automático de rostos/placas).
3. Integração croqui ↔ fotos ↔ tabela de manifestações patológicas.
