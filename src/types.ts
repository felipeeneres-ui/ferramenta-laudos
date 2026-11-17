// Modelo de dados do projeto de croqui.
// Um "projeto" = um imóvel. Cada imóvel tem vários pavimentos (Floor).

export type ToolId =
  | 'select'
  | 'wall'
  | 'projection'
  | 'limit'
  | 'door'
  | 'window'
  | 'stairs'
  | 'room'
  | 'point'
  | 'trace' // traçado colorido (polilinha grossa sobre satélite/planta)
  | 'flabel' // texto livre (com rotação)
  | 'pan';

// Tipo da linha desenhada:
//  wall = parede (linha grossa) · projection = projeção (pontilhada) ·
//  limit = limite não físico (linha fina cheia)
export type LineKind = 'wall' | 'projection' | 'limit';

// O LOCAL da anomalia define a COR do ponto.
export type Local = 'parede' | 'piso' | 'teto';

export const LOCAL_COLORS: Record<Local, string> = {
  parede: '#378ADD', // azul
  piso: '#BA7517', // âmbar
  teto: '#7F77DD', // roxo
};

export const LOCAL_LABEL: Record<Local, string> = {
  parede: 'Parede',
  piso: 'Piso',
  teto: 'Teto',
};

export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind?: LineKind; // ausente = 'wall' (compatibilidade)
}

export type OpeningKind = 'door' | 'window' | 'stairs';

// Abertura ancorada numa parede. `t` = posição do centro ao longo da parede (0..1).
// `width` em unidades de mundo. Portas e janelas podem ser movidas (t) e
// redimensionadas (width). Escada usa o mesmo modelo.
export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  t: number;
  width: number;
  flip: boolean; // lado de abertura da porta
}

export interface RoomLabel {
  id: string;
  x: number;
  y: number;
  nome: string;
  fontSize?: number; // tamanho do rótulo (ausente = 13)
}

export const DEFAULT_ROOM_FONT = 13;

// Tipo de anomalia: define o PREFIXO/letra da nomenclatura (F, U, CE...).
export interface AnomalyType {
  id: string;
  prefix: string;
  nome: string;
}

// Ponto de anomalia — agora é do PROJETO (não mais "do croqui"). Pode ser
// criado numa foto ou no croqui e posicionado em ambos. Vincula-se a fotos
// (para a tabela) via Photo.pointIds.
export interface Point {
  id: string;
  typeId: string;
  numero: number; // numeração contínua por tipo no projeto inteiro
  local: Local;
  comodo: string; // cômodo do croqui (compõe a tabela por cômodo)
  descricao: string;
  floorId: string | null; // posição no croqui; null = ainda não posicionado
  x: number;
  y: number;
  // linha de chamada: rótulo afastado apontando para (x,y). Ausente = rótulo no local.
  lx?: number;
  ly?: number;
}

// Imagem de fundo do pavimento (satélite/planta). O blob fica no IndexedDB
// (chave bg:<floorId>); aqui só a geometria/apresentação.
export interface FloorBg {
  x: number;
  y: number;
  w: number; // dimensões naturais da imagem (px)
  h: number;
  scale: number; // multiplicador (unidades de mundo por px da imagem)
  opacity: number; // 0..1
  locked: boolean;
  rev: number; // muda a cada troca de imagem (recarrega o blob)
  rot?: number; // giro em graus, em torno do centro da imagem (ausente = 0)
}

// Traçado colorido (polilinha grossa) — marcação gráfica sobre satélite/planta.
export interface Trace {
  id: string;
  pts: { x: number; y: number }[];
  color: string;
  width: number;
  dashed?: boolean;
}

// Texto livre do croqui, com rotação (ex.: "01 - Calçada Av. Atlântica").
export interface FreeLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
  rotation: number; // graus (sentido horário)
  bg?: boolean; // caixa branca com borda da cor do texto
}

export interface Floor {
  id: string;
  nome: string;
  walls: Wall[];
  openings: Opening[];
  rooms: RoomLabel[];
  traces?: Trace[];
  labels?: FreeLabel[];
  bg?: FloorBg | null;
  // imagem de satélite, desenhada POR BAIXO do fundo (blob em bg:<floorId>_sat)
  sat?: FloorBg | null;
}

// Janela do desenho gerado pelo "Croqui de rua": permite encaixar a imagem de
// satélite no mesmo enquadramento. Coordenadas em metros, a partir de (lat, lon).
export interface CroquiGeo {
  lat: number;
  lon: number;
  cx: number;
  cy: number;
  rot: number; // graus, anti-horário
  larg: number; // m
  alt: number; // m
}

// ----- Fotos -----

// Classificação do novo fluxo:
//  'laudo'  = foto editada visualmente; entra no laudo e automaticamente na tabela
//  'tabela' = só referência na tabela, sem edição
//  null     = não utilizada
export type Classification = 'laudo' | 'tabela' | null;

export type AnnotationKind =
  | 'arrow'
  | 'line' // linha reta sem ponta
  | 'draw' // desenho livre (lápis)
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'point' // marcador de ponto de anomalia (vinculado a um Point do projeto)
  | 'magnify' // lente de detalhe: círculo na anomalia + inset ampliado
  | 'measure' // cota: linha com travessões e texto de medida
  | 'highlight'
  | 'blur';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

// Geometria em pixels da imagem original.
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  x2: number;
  y2: number;
  text?: string;
  align?: TextAlign; // quando kind === 'text' (ausente = 'left')
  points?: { x: number; y: number }[]; // quando kind === 'draw'
  dashed?: boolean; // traço tracejado (arrow/line/rect/ellipse)
  doubleHead?: boolean; // seta com duas pontas (arrow)
  filled?: boolean; // retângulo/elipse preenchido
  color: string;
  strokeWidth: number;
  pointId?: string; // quando kind === 'point'
  // linha de chamada do marcador de ponto: rótulo em (lx,ly) apontando para (x,y)
  lx?: number;
  ly?: number;
  // lente de detalhe (magnify): fonte em (x,y) raio r; inset em (x2,y2) raio r*zoom
  r?: number;
  zoom?: number;
}

export interface Photo {
  id: string;
  nome: string; // nome original do arquivo (ex.: IMG_7752.JPG)
  classification: Classification;
  reviewed: boolean; // já analisada na triagem (borda verde)
  descricao: string;
  pointIds: string[]; // pontos que esta foto documenta (compõe a coluna Arquivos da tabela)
  width: number;
  height: number;
  annotations: Annotation[];
  crop: { x: number; y: number; w: number; h: number } | null;
  border: boolean; // borda preta padrão (pronta para o Word)
  adjust?: { brightness: number; contrast: number }; // 100 = neutro (%)
  rotate?: number; // rotação em passos de 90° (0/90/180/270); width/height já refletem
  straighten?: number; // endireitar fino em graus (gira a base sob as anotações)
  edited: boolean;
  // camada (pavimento ou rua) a que a foto pertence; ausente = foto antiga, sem camada
  floorId?: string;
  // subpasta dentro da pasta da camada (ex.: "1 - Calçada Sul"); '' ou ausente = na raiz
  subpasta?: string;
  // Vista: a foto marcada no croqui como "olhar daqui" (um ponto simples). Não é ponto
  // de análise: não entra na tabela. No croqui interativo, clicar no ponto abre a foto.
  vista?: PhotoVista;
}

export interface PhotoVista {
  floorId: string | null; // camada do desenho; null = ainda não posicionada
  x: number;
  y: number;
  ang: number; // sem uso (a vista já teve um leque de direção); mantido por compatibilidade
}

export type AppView = 'croqui' | 'fotos' | 'split' | 'tabela' | 'laudo' | 'cliente';

export interface Project {
  id: string;
  nome: string;
  floors: Floor[];
  activeFloorId: string;
  anomalyTypes: AnomalyType[];
  points: Point[];
  photos: Photo[];
  croquiPointSize?: number; // tamanho dos pinos de anomalia no croqui (ausente = 18)
  // Croqui único (vistoria de rua): um desenho só, guardado na primeira camada.
  // As camadas viram "ruas": grupos de fotos e de pontos, sem desenho próprio.
  croquiUnico?: boolean;
  croquiGeo?: CroquiGeo;
  vistasNoExport?: boolean; // mostrar as vistas também no PNG e no PDF (ausente = só no interativo)
  vistaSize?: number; // diâmetro do ponto das vistas (ausente = TAM_VISTA)
  // Croqui único: ruas (ids de camada) com os pontos e as vistas escondidos no croqui
  // da tela e no PNG. A tabela, o PDF e o croqui interativo continuam com tudo.
  ruasOcultas?: string[];
}

// Rua (camada) de um ponto no croqui único: a camada cujo nome é o "cômodo" do ponto.
function ruaDoPonto(project: Project, pt: Point): string | undefined {
  const nome = pt.comodo.trim();
  return nome ? project.floors.find((f) => f.nome.trim() === nome)?.id : undefined;
}

// O ponto aparece no croqui da tela e no PNG? (sempre, fora do croqui único)
export function pontoVisivel(project: Project, pt: Point): boolean {
  const ocultas = project.croquiUnico ? project.ruasOcultas : undefined;
  if (!ocultas?.length) return true;
  const rua = ruaDoPonto(project, pt);
  return !rua || !ocultas.includes(rua);
}

export function vistaVisivel(project: Project, ph: Photo): boolean {
  const ocultas = project.croquiUnico ? project.ruasOcultas : undefined;
  return !ocultas?.length || !ph.floorId || !ocultas.includes(ph.floorId);
}

// Vistas posicionadas numa camada do desenho, no formato usado pelas exportações.
// soVisiveis: respeita as ruas escondidas (croqui da tela e PNG).
export function vistasDaCamada(project: Project, floorId: string, soVisiveis = false) {
  return project.photos
    .filter((ph) => ph.vista && ph.vista.floorId === floorId)
    .filter((ph) => !soVisiveis || vistaVisivel(project, ph))
    .map((ph) => ({ id: ph.id, x: ph.vista!.x, y: ph.vista!.y }));
}

// Camada que guarda o desenho em uso: a ativa ou, no croqui único, sempre a primeira.
export function drawFloorId(project: Project): string {
  return project.croquiUnico ? project.floors[0].id : project.activeFloorId;
}

export const DEFAULT_CROQUI_POINT = 18;

// Uma camada sem rótulos de cômodo (ex.: "Rua X" sobre imagem de satélite, em
// vistoria de rua) funciona ela mesma como "cômodo": os pontos são agrupados
// na tabela pelo nome da camada.
export function floorAsComodo(project: Project, floorId: string | null | undefined): string {
  if (!floorId) return '';
  const f = project.floors.find((x) => x.id === floorId);
  if (!f) return '';
  if (project.croquiUnico) return f.nome.trim(); // no croqui único, a camada É a rua
  if (project.floors.length < 2 || f.rooms.some((r) => r.nome.trim())) return '';
  return f.nome.trim();
}

// Opções de cômodo: rótulos de cômodo dos croquis + camadas que valem como cômodo.
export function comodoOptions(project: Project): string[] {
  const out = new Set<string>();
  for (const f of project.floors) {
    for (const r of f.rooms) if (r.nome.trim()) out.add(r.nome.trim());
    const own = floorAsComodo(project, f.id);
    if (own) out.add(own);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b, 'pt'));
}

// Ordem das fotos nas saídas: pela ordem das camadas e, dentro de cada uma, pelo nome.
export function comparePhotos(project: Project): (a: Photo, b: Photo) => number {
  const idx = new Map(project.floors.map((f, i) => [f.id, i]));
  const pos = (p: Photo) => (p.floorId != null ? (idx.get(p.floorId) ?? -1) : -1);
  const sub = (p: Photo) => p.subpasta ?? '';
  return (a, b) =>
    pos(a) - pos(b) ||
    sub(a).localeCompare(sub(b), undefined, { numeric: true }) ||
    a.nome.localeCompare(b.nome, undefined, { numeric: true });
}

// Paleta: cores da marca CRAFT (azul-marinho, ardósia, cinzas) extraídas do
// cabeçalho/rodapé do laudo, mais as cores essenciais de marcação.
export const ANNOTATION_COLORS = [
  '#000000', // preto (padrão do laudo)
  '#FFFFFF', // branco
  '#0F1E3C', // azul-marinho CRAFT
  '#46536B', // azul-ardósia CRAFT
  '#A2A4A8', // cinza CRAFT
  '#C00000', // vermelho-escuro
  '#FF0000', // vermelho
  '#FFC000', // dourado
  '#FFFF00', // amarelo
  '#00B050', // verde
  '#0070C0', // azul
  '#7030A0', // roxo
];

export const DEFAULT_TYPES: AnomalyType[] = [
  { id: 'F', prefix: 'F', nome: 'Fissura' },
  { id: 'U', prefix: 'U', nome: 'Umidade' },
  { id: 'CE', prefix: 'CE', nome: 'Cerâmica' },
  { id: 'D', prefix: 'D', nome: 'Desplacamento' },
];

export type Selection =
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'point'; id: string }
  | { kind: 'trace'; id: string }
  | { kind: 'flabel'; id: string }
  | { kind: 'vista'; id: string } // id da foto
  | null;
