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

### Atalhos
`V` selecionar · `W` parede · `P` ponto · `Delete` excluir · `Esc` volta para selecionar.

## Próximas fases
2. Editor de fotos (setas, caixas de texto, desfoque automático de rostos/placas).
3. Integração croqui ↔ fotos ↔ tabela de manifestações patológicas.
