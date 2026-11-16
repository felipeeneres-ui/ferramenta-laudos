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

### Vistoria de rua (croqui sobre imagem de satélite)

Serve para vistoria cautelar de vizinhança feita na rua, por exemplo as quatro ruas em volta de uma quadra.

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
