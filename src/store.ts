import { create } from 'zustand';
import {
  type Project,
  type Floor,
  type ToolId,
  type Selection,
  type Local,
  type OpeningKind,
  type Wall,
  type Opening,
  type Point,
  type RoomLabel,
  type AnomalyType,
  type Photo,
  type Classification,
  type AppView,
  type Trace,
  type FreeLabel,
  type FloorBg,
  DEFAULT_TYPES,
  DEFAULT_CROQUI_POINT,
  floorAsComodo,
  drawFloorId,
  type CroquiGeo,
} from './types';
import { uid, pillWidth, spreadLabels } from './geometry';
import { get as idbGet } from 'idb-keyval';
import { deletePhotoBlobs, delBg, delDirHandle, getBg, putBg } from './db';
import {
  agendarGravacao,
  aoSalvar,
  descarregarPendentes,
  excluirDoDisco,
  gravarArquivo,
  gravarNoDisco,
  lerDoDisco,
  listarDisco,
  setProjetoAtivo,
} from './disco';

// Multiprojeto: cada projeto vive em ferramenta-laudos:project:<id>.
const KEY_PREFIX = 'ferramenta-laudos:project:';
const LEGACY_KEY = 'ferramenta-laudos:project'; // formato antigo (projeto único)
const ACTIVE_KEY = 'ferramenta-laudos:active';

export interface ProjectMeta {
  id: string;
  nome: string;
  updatedAt: number;
  pavimentos: number;
  pontos: number;
  fotos: number;
}

interface View {
  tx: number;
  ty: number;
  scale: number;
}

function newFloor(nome: string): Floor {
  return { id: uid('floor'), nome, walls: [], openings: [], rooms: [] };
}

function newProject(): Project {
  const floor = newFloor('Térreo');
  return {
    id: uid('proj'),
    nome: 'Novo imóvel',
    floors: [floor],
    activeFloorId: floor.id,
    anomalyTypes: DEFAULT_TYPES.map((t) => ({ ...t })),
    points: [],
    photos: [],
  };
}

function ensurePhotos(p: Project): Project {
  // compatibilidade com projetos salvos antes da fase de fotos
  if (!p.photos) p.photos = [];
  for (const ph of p.photos as (Photo & { pointId?: string | null })[]) {
    if (!ph.pointIds) ph.pointIds = ph.pointId ? [ph.pointId] : [];
    delete ph.pointId;
  }
  // migração: pontos passaram do pavimento para o nível do projeto
  if (!p.points) p.points = [];
  for (const f of p.floors as (Floor & { points?: Point[] })[]) {
    if (f.points && f.points.length) {
      for (const pt of f.points) {
        p.points.push({
          id: pt.id,
          typeId: pt.typeId,
          numero: pt.numero,
          local: pt.local,
          comodo: pt.comodo ?? '',
          descricao: pt.descricao ?? '',
          floorId: f.id,
          x: pt.x,
          y: pt.y,
        });
      }
      delete f.points;
    }
  }
  return p;
}

// Projeto ainda intocado (o "Novo imóvel" que cada navegador cria sozinho): não vai para a pasta.
function intocado(p: Project): boolean {
  return (
    p.nome === 'Novo imóvel' &&
    p.floors.length === 1 &&
    p.points.length === 0 &&
    p.photos.length === 0 &&
    p.floors.every(
      (f) =>
        !f.bg &&
        f.walls.length + f.openings.length + f.rooms.length + (f.traces ?? []).length + (f.labels ?? []).length === 0,
    )
  );
}

function persist(project: Project) {
  const comData = { ...project, updatedAt: Date.now() };
  try {
    localStorage.setItem(KEY_PREFIX + project.id, JSON.stringify(comData));
    localStorage.setItem(ACTIVE_KEY, project.id);
  } catch {
    // armazenamento indisponível
  }
  // espelha na pasta do computador (gravação adiada)
  if (!intocado(project)) agendarGravacao(comData);
}

// Migra o formato antigo (projeto único) para o multiprojeto.
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Project;
    if (p?.id && !localStorage.getItem(KEY_PREFIX + p.id)) {
      localStorage.setItem(KEY_PREFIX + p.id, raw);
      localStorage.setItem(ACTIVE_KEY, p.id);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // legado corrompido — ignora
  }
}

function loadById(id: string): Project | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + id);
    if (raw) return ensurePhotos(JSON.parse(raw) as Project);
  } catch {
    // corrompido
  }
  return null;
}

// Lista os projetos salvos (mais recentes primeiro).
export function listProjects(): ProjectMeta[] {
  const out: ProjectMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const p = JSON.parse(localStorage.getItem(key)!) as Project & { updatedAt?: number };
      out.push({
        id: p.id,
        nome: p.nome || '(sem nome)',
        updatedAt: p.updatedAt ?? 0,
        pavimentos: p.floors?.length ?? 0,
        pontos: p.points?.length ?? 0,
        fotos: p.photos?.length ?? 0,
      });
    } catch {
      // entrada corrompida — pula
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadInitial(): Project {
  migrateLegacy();
  const activeId = localStorage.getItem(ACTIVE_KEY);
  if (activeId) {
    const p = loadById(activeId);
    if (p) return p;
  }
  const list = listProjects();
  if (list.length) {
    const p = loadById(list[0].id);
    if (p) return p;
  }
  const fresh = newProject();
  persist(fresh);
  return fresh;
}

// Situação da gravação na pasta do computador.
export interface DiscoInfo {
  pasta: string | null; // null = servidor sem a gravação em pasta (só navegador)
  estado: 'verificando' | 'salvando' | 'salvo' | 'falhou';
  em: number; // hora da última gravação confirmada
}

interface State {
  project: Project;
  disco: DiscoInfo;
  home: boolean; // página inicial (lista de projetos)
  projects: ProjectMeta[]; // índice para a página inicial
  goHome: () => void;
  openProject: (id: string) => void;
  createProject: (nome: string) => void;
  deleteProject: (id: string) => void;
  appView: AppView;
  tool: ToolId;
  selection: Selection;
  view: View;
  // opções ativas usadas pelas ferramentas
  activeTypeId: string;
  activeLocal: Local;
  openingWidth: number;
  placingPointId: string | null; // ponto selecionado p/ posicionar no croqui
  placingVistaId: string | null; // foto cuja vista será posicionada no próximo clique no croqui
  setPlacingVista: (id: string | null) => void;
  createVista: (photoId: string) => void; // marca a foto como vista (a posicionar)
  placeVista: (photoId: string, x: number, y: number) => void;
  updateVista: (photoId: string, patch: Partial<{ x: number; y: number }>) => void;
  removeVista: (photoId: string) => void;
  setVistasNoExport: (v: boolean) => void;
  setVistaSize: (tam: number) => void;
  snapEnabled: boolean;

  setAppView: (v: AppView) => void;
  setPlacingPoint: (id: string | null) => void;
  toggleSnap: () => void;
  setTool: (t: ToolId) => void;
  setSelection: (s: Selection) => void;
  setView: (v: Partial<View>) => void;
  setActiveType: (id: string) => void;
  setActiveLocal: (l: Local) => void;
  setOpeningWidth: (w: number) => void;

  activeFloor: () => Floor;
  mutateFloor: (fn: (f: Floor) => void) => void;

  addFloor: () => void;
  setActiveFloor: (id: string) => void;
  renameFloor: (id: string, nome: string) => void;
  setProjectName: (nome: string) => void;

  addWall: (w: Omit<Wall, 'id'>) => string;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  addOpening: (kind: OpeningKind, wallId: string, t: number) => void;
  updateOpening: (id: string, patch: Partial<Opening>) => void;
  addRoom: (x: number, y: number, nome: string) => void;
  updateRoom: (id: string, patch: Partial<RoomLabel>) => void;
  traceStyle: { color: string; width: number; dashed: boolean };
  setTraceStyle: (patch: Partial<{ color: string; width: number; dashed: boolean }>) => void;
  addTrace: (pts: { x: number; y: number }[]) => void;
  updateTrace: (id: string, patch: Partial<Trace>) => void;
  addFreeLabel: (x: number, y: number) => void;
  updateFreeLabel: (id: string, patch: Partial<FreeLabel>) => void;
  setFloorBg: (bg: FloorBg | null) => void;
  updateFloorBg: (patch: Partial<FloorBg>) => void;
  setSat: (sat: FloorBg | null) => void; // imagem de satélite (por baixo do fundo)
  updateSat: (patch: Partial<FloorBg>) => void;
  setCroquiUnico: (geo: CroquiGeo | null) => void; // liga o croqui único (um desenho, ruas como grupos)
  ensureFloor: (nome: string) => string; // camada com esse nome (cria se não existir); devolve o id
  setBgOf: (floorId: string, bg: FloorBg) => void;
  copyBgToAllFloors: () => Promise<number>; // mesmo fundo (imagem, posição e escala) nas outras camadas
  arrangeLabels: () => number; // afasta rótulos sobrepostos da camada ativa
  setAllRoomFonts: (size: number) => void;
  addPoint: (x: number, y: number) => void;
  setCroquiPointSize: (size: number) => void;
  createPoint: (attrs: { typeId: string; local: Local; comodo: string }) => string;
  placePoint: (id: string, x: number, y: number) => void;
  updatePoint: (id: string, patch: Partial<Point>) => void;
  addPointToPhoto: (photoId: string, pointId: string) => void;
  removePointFromPhoto: (photoId: string, pointId: string) => void;
  deleteSelection: () => void;

  addType: (prefix: string, nome: string) => void;
  importCroqui: (data: {
    walls?: { x1: number; y1: number; x2: number; y2: number; kind?: Wall['kind'] }[];
    rooms?: { x: number; y: number; nome: string }[];
  }) => void;
  clearCroqui: () => void;

  addPhotos: (photos: Photo[]) => void;
  setClassification: (id: string, c: Classification) => void;
  setReviewed: (id: string, reviewed: boolean) => void;
  updatePhoto: (id: string, patch: Partial<Photo>) => void;
  patchPhotos: (patches: Map<string, Partial<Photo>>) => void; // várias fotos de uma vez
  setAllTextSize: (normalized: number) => void;
  deletePhoto: (id: string) => void;

  loadFromJSON: (project: Project) => void;
  resetProject: () => void;
}

export const useStore = create<State>((set, get) => {
  const commit = (project: Project) => {
    persist(project);
    set({ project });
  };

  return {
    project: loadInitial(),
    disco: { pasta: null, estado: 'verificando', em: 0 },
    home: true, // começa na página de projetos
    projects: listProjects(),

    goHome: () => set({ home: true, projects: listProjects(), selection: null, placingPointId: null }),

    openProject: (id) => {
      const p = loadById(id);
      if (!p) return;
      localStorage.setItem(ACTIVE_KEY, id);
      set({
        project: p,
        home: false,
        appView: 'croqui',
        tool: 'select',
        selection: null,
        placingPointId: null,
        view: { tx: 80, ty: 60, scale: 1 },
      });
    },

    createProject: (nome) => {
      const p = newProject();
      p.nome = nome.trim() || 'Novo imóvel';
      persist(p);
      set({
        project: p,
        home: false,
        appView: 'croqui',
        tool: 'select',
        selection: null,
        view: { tx: 80, ty: 60, scale: 1 },
        projects: listProjects(),
      });
    },

    deleteProject: (id) => {
      const p = loadById(id);
      localStorage.removeItem(KEY_PREFIX + id);
      void excluirDoDisco(id); // na pasta, o projeto vai para _lixeira (não é apagado)
      // limpa os blobs (fotos, fundos, pasta) do projeto excluído
      if (p) {
        void (async () => {
          for (const ph of p.photos) await deletePhotoBlobs(ph.id);
          for (const f of p.floors) {
            await delBg(f.id);
            await delBg(`${f.id}_sat`);
            await delDirHandle(p.id, f.id);
          }
          await delDirHandle(p.id);
        })();
      }
      const cur = get().project;
      if (cur.id === id) {
        // excluiu o projeto aberto: carrega outro (ou cria um novo)
        const rest = listProjects();
        const next = rest.length ? loadById(rest[0].id) : null;
        if (next) {
          localStorage.setItem(ACTIVE_KEY, next.id);
          set({ project: next });
        } else {
          const fresh = newProject();
          persist(fresh);
          set({ project: fresh });
        }
      }
      set({ projects: listProjects() });
    },

    appView: 'croqui',
    tool: 'select',
    selection: null,
    view: { tx: 80, ty: 60, scale: 1 },
    activeTypeId: 'F',
    activeLocal: 'parede',
    openingWidth: 60,
    placingPointId: null,
    placingVistaId: null,
    snapEnabled: true,

    setAppView: (v) => set({ appView: v }),
    setPlacingPoint: (id) => set({ placingPointId: id, placingVistaId: null }),
    setPlacingVista: (id) => set({ placingVistaId: id, placingPointId: null }),

    createVista: (photoId) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) =>
          ph.id === photoId && !ph.vista
            ? { ...ph, reviewed: true, vista: { floorId: null, x: 0, y: 0, ang: -90 } }
            : ph,
        ),
      });
    },

    placeVista: (photoId, x, y) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) =>
          ph.id === photoId && ph.vista ? { ...ph, vista: { ...ph.vista, floorId: drawFloorId(p), x, y } } : ph,
        ),
      });
      set({ placingVistaId: null, selection: { kind: 'vista', id: photoId }, tool: 'select' });
    },

    updateVista: (photoId, patch) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) => (ph.id === photoId && ph.vista ? { ...ph, vista: { ...ph.vista, ...patch } } : ph)),
      });
    },

    removeVista: (photoId) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) => {
          if (ph.id !== photoId || !ph.vista) return ph;
          const { vista: _fora, ...resto } = ph;
          void _fora;
          return resto;
        }),
      });
      const st = get();
      set({
        placingVistaId: st.placingVistaId === photoId ? null : st.placingVistaId,
        selection: st.selection?.kind === 'vista' && st.selection.id === photoId ? null : st.selection,
      });
    },

    setVistasNoExport: (v) => commit({ ...get().project, vistasNoExport: v }),
    setVistaSize: (tam) => commit({ ...get().project, vistaSize: tam }),
    toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
    setTool: (t) => set({ tool: t, selection: null, placingPointId: null, placingVistaId: null }),
    setSelection: (s) => set({ selection: s }),
    setView: (v) => set({ view: { ...get().view, ...v } }),
    setActiveType: (id) => set({ activeTypeId: id }),
    setActiveLocal: (l) => set({ activeLocal: l }),
    setOpeningWidth: (w) => set({ openingWidth: w }),

    // camada do DESENHO: a ativa ou, no croqui único, a primeira
    activeFloor: () => {
      const p = get().project;
      const id = drawFloorId(p);
      return p.floors.find((f) => f.id === id) ?? p.floors[0];
    },

    mutateFloor: (fn) => {
      const p = get().project;
      const alvo = drawFloorId(p);
      const floors = p.floors.map((f) => {
        if (f.id !== alvo) return f;
        const copy: Floor = {
          ...f,
          walls: [...f.walls],
          openings: [...f.openings],
          rooms: [...f.rooms],
          traces: [...(f.traces ?? [])],
          labels: [...(f.labels ?? [])],
        };
        fn(copy);
        return copy;
      });
      commit({ ...p, floors });
    },

    addFloor: () => {
      const p = get().project;
      const nome = `${p.floors.length + 1}º pavimento`;
      const f = newFloor(nome);
      commit({ ...p, floors: [...p.floors, f], activeFloorId: f.id });
    },

    setActiveFloor: (id) => {
      const p = get().project;
      commit({ ...p, activeFloorId: id });
      set({ selection: null });
    },

    renameFloor: (id, nome) => {
      const p = get().project;
      const antigo = floorAsComodo(p, id);
      const floors = p.floors.map((f) => (f.id === id ? { ...f, nome } : f));
      // pontos que usavam o nome da camada como "cômodo" acompanham o novo nome
      const points =
        antigo && nome.trim()
          ? p.points.map((pt) => (pt.comodo.trim() === antigo ? { ...pt, comodo: nome.trim() } : pt))
          : p.points;
      commit({ ...p, floors, points });
    },

    setProjectName: (nome) => commit({ ...get().project, nome }),

    addWall: (w) => {
      const id = uid('wall');
      get().mutateFloor((f) => {
        f.walls.push({ id, ...w });
      });
      return id;
    },

    updateWall: (id, patch) => {
      get().mutateFloor((f) => {
        f.walls = f.walls.map((w) => (w.id === id ? { ...w, ...patch } : w));
      });
    },

    addOpening: (kind, wallId, t) => {
      const id = uid('op');
      const width = get().openingWidth;
      get().mutateFloor((f) => {
        f.openings.push({ id, kind, wallId, t, width, flip: false });
      });
      set({ selection: { kind: 'opening', id } });
    },

    updateOpening: (id, patch) => {
      get().mutateFloor((f) => {
        f.openings = f.openings.map((o) => (o.id === id ? { ...o, ...patch } : o));
      });
    },

    addRoom: (x, y, nome) => {
      const id = uid('room');
      get().mutateFloor((f) => {
        f.rooms.push({ id, x, y, nome });
      });
      set({ selection: { kind: 'room', id } });
    },

    updateRoom: (id, patch) => {
      get().mutateFloor((f) => {
        f.rooms = f.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r));
      });
    },

    traceStyle: { color: '#FF0000', width: 6, dashed: false },
    setTraceStyle: (patch) => set({ traceStyle: { ...get().traceStyle, ...patch } }),

    addTrace: (pts) => {
      if (pts.length < 2) return;
      const id = uid('trace');
      const st = get().traceStyle;
      get().mutateFloor((f) => {
        f.traces = [...(f.traces ?? []), { id, pts, color: st.color, width: st.width, dashed: st.dashed }];
      });
      set({ selection: { kind: 'trace', id } });
    },

    updateTrace: (id, patch) => {
      get().mutateFloor((f) => {
        f.traces = (f.traces ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t));
      });
    },

    addFreeLabel: (x, y) => {
      const id = uid('lbl');
      get().mutateFloor((f) => {
        f.labels = [
          ...(f.labels ?? []),
          { id, x, y, text: 'Texto', color: '#C00000', fontSize: 14, rotation: 0, bg: true },
        ];
      });
      set({ selection: { kind: 'flabel', id }, tool: 'select' });
    },

    updateFreeLabel: (id, patch) => {
      get().mutateFloor((f) => {
        f.labels = (f.labels ?? []).map((l) => (l.id === id ? { ...l, ...patch } : l));
      });
    },

    setSat: (sat) => {
      const floorId = drawFloorId(get().project);
      get().mutateFloor((f) => {
        f.sat = sat;
      });
      if (!sat) void delBg(`${floorId}_sat`);
    },

    updateSat: (patch) => {
      get().mutateFloor((f) => {
        if (f.sat) f.sat = { ...f.sat, ...patch };
      });
    },

    setCroquiUnico: (geo) => {
      const p = get().project;
      // os fundos separados das outras camadas deixam de valer
      for (const f of p.floors.slice(1)) {
        if (f.bg) void delBg(f.id);
        if (f.sat) void delBg(`${f.id}_sat`);
      }
      commit({
        ...p,
        croquiUnico: true,
        croquiGeo: geo ?? undefined,
        croquiPointSize: p.croquiPointSize ?? 28, // a quadra inteira pede um pino um pouco maior
        floors: p.floors.map((f, i) => (i === 0 ? f : { ...f, bg: null, sat: null })),
        // pontos já posicionados passam para o desenho único
        points: p.points.map((pt) => (pt.floorId ? { ...pt, floorId: p.floors[0].id } : pt)),
        photos: p.photos.map((ph) =>
          ph.vista?.floorId ? { ...ph, vista: { ...ph.vista, floorId: p.floors[0].id } } : ph,
        ),
      });
    },

    setFloorBg: (bg) => {
      const floorId = drawFloorId(get().project);
      get().mutateFloor((f) => {
        f.bg = bg;
      });
      if (!bg) void delBg(floorId);
    },

    updateFloorBg: (patch) => {
      get().mutateFloor((f) => {
        if (f.bg) f.bg = { ...f.bg, ...patch };
      });
    },

    ensureFloor: (nome) => {
      const p = get().project;
      const alvo = nome.trim().toLowerCase();
      const igual = p.floors.find((f) => f.nome.trim().toLowerCase() === alvo);
      if (igual) return igual.id;
      // projeto recém-criado: aproveita a única camada, se ainda estiver vazia
      const f0 = p.floors[0];
      const vazia =
        p.floors.length === 1 &&
        f0.nome === 'Térreo' && // ainda com o nome padrão (não é uma rua já criada)
        !f0.bg &&
        f0.walls.length + f0.openings.length + f0.rooms.length + (f0.traces ?? []).length + (f0.labels ?? []).length === 0 &&
        !p.points.some((pt) => pt.floorId === f0.id) &&
        !p.photos.some((ph) => ph.floorId === f0.id);
      if (vazia) {
        commit({ ...p, floors: [{ ...f0, nome }] });
        return f0.id;
      }
      const f = newFloor(nome);
      commit({ ...p, floors: [...p.floors, f] });
      return f.id;
    },

    setBgOf: (floorId, bg) => {
      const p = get().project;
      commit({ ...p, floors: p.floors.map((f) => (f.id === floorId ? { ...f, bg } : f)) });
    },

    copyBgToAllFloors: async () => {
      const p = get().project;
      const src = p.floors.find((f) => f.id === p.activeFloorId);
      if (!src?.bg) return 0;
      const blob = await getBg(src.id);
      if (!blob) return 0;
      const others = p.floors.filter((f) => f.id !== src.id);
      for (const f of others) await putBg(f.id, blob);
      const rev = Date.now();
      const cur = get().project;
      commit({
        ...cur,
        floors: cur.floors.map((f) => (f.id === src.id ? f : { ...f, bg: { ...src.bg!, rev } })),
      });
      return others.length;
    },

    arrangeLabels: () => {
      const p = get().project;
      const sz = p.croquiPointSize ?? DEFAULT_CROQUI_POINT;
      const items = p.points
        .filter((pt) => pt.floorId === drawFloorId(p))
        .map((pt) => {
          const prefix = p.anomalyTypes.find((t) => t.id === pt.typeId)?.prefix ?? '?';
          return { id: pt.id, x: pt.x, y: pt.y, lx: pt.lx, ly: pt.ly, w: pillWidth(`${prefix}${pt.numero}`, sz) };
        });
      const moved = spreadLabels(items, sz);
      if (moved.size === 0) return 0;
      commit({
        ...p,
        points: p.points.map((pt) => {
          const m = moved.get(pt.id);
          return m ? { ...pt, lx: m.x, ly: m.y } : pt;
        }),
      });
      return moved.size;
    },

    setAllRoomFonts: (size) => {
      get().mutateFloor((f) => {
        f.rooms = f.rooms.map((r) => ({ ...r, fontSize: size }));
      });
    },

    addPoint: (x, y) => {
      const p = get().project;
      const type = p.anomalyTypes.find((t) => t.id === get().activeTypeId) ?? p.anomalyTypes[0];
      // numeração contínua por tipo no projeto inteiro
      let max = 0;
      for (const pt of p.points) if (pt.typeId === type.id && pt.numero > max) max = pt.numero;
      const id = uid('pt');
      const point: Point = {
        id,
        typeId: type.id,
        numero: max + 1,
        local: p.croquiUnico ? 'parede' : get().activeLocal, // croqui único: pino de uma cor só
        comodo: floorAsComodo(p, p.activeFloorId),
        descricao: '',
        floorId: drawFloorId(p),
        x,
        y,
      };
      commit({ ...p, points: [...p.points, point] });
      set({ selection: { kind: 'point', id } });
    },

    // cria um ponto ainda NÃO posicionado no croqui (criado a partir de uma foto)
    createPoint: (attrs) => {
      const p = get().project;
      const type = p.anomalyTypes.find((t) => t.id === attrs.typeId) ?? p.anomalyTypes[0];
      let max = 0;
      for (const pt of p.points) if (pt.typeId === type.id && pt.numero > max) max = pt.numero;
      const id = uid('pt');
      const point: Point = {
        id,
        typeId: type.id,
        numero: max + 1,
        local: p.croquiUnico ? 'parede' : attrs.local,
        comodo: attrs.comodo,
        descricao: '',
        floorId: null,
        x: 0,
        y: 0,
      };
      commit({ ...p, points: [...p.points, point] });
      return id;
    },

    placePoint: (id, x, y) => {
      const p = get().project;
      commit({
        ...p,
        points: p.points.map((pt) =>
          pt.id === id ? { ...pt, floorId: drawFloorId(p), x, y } : pt,
        ),
      });
      set({ placingPointId: null, selection: { kind: 'point', id } });
    },

    updatePoint: (id, patch) => {
      const p = get().project;
      commit({ ...p, points: p.points.map((pt) => (pt.id === id ? { ...pt, ...patch } : pt)) });
    },

    setCroquiPointSize: (size) => {
      commit({ ...get().project, croquiPointSize: size });
    },

    addPointToPhoto: (photoId, pointId) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) =>
          ph.id === photoId && !ph.pointIds.includes(pointId)
            ? { ...ph, pointIds: [...ph.pointIds, pointId] }
            : ph,
        ),
      });
    },

    removePointFromPhoto: (photoId, pointId) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((ph) =>
          ph.id === photoId ? { ...ph, pointIds: ph.pointIds.filter((id) => id !== pointId) } : ph,
        ),
      });
    },

    deleteSelection: () => {
      const sel = get().selection;
      if (!sel) return;
      if (sel.kind === 'vista') {
        get().removeVista(sel.id);
        return;
      }
      if (sel.kind === 'point') {
        const p = get().project;
        // remove o ponto e desvincula das fotos
        commit({
          ...p,
          points: p.points.filter((pt) => pt.id !== sel.id),
          photos: p.photos.map((ph) =>
            ph.pointIds?.includes(sel.id)
              ? { ...ph, pointIds: ph.pointIds.filter((id) => id !== sel.id) }
              : ph,
          ),
        });
      } else {
        get().mutateFloor((f) => {
          if (sel.kind === 'wall') {
            f.walls = f.walls.filter((w) => w.id !== sel.id);
            f.openings = f.openings.filter((o) => o.wallId !== sel.id);
          } else if (sel.kind === 'opening') {
            f.openings = f.openings.filter((o) => o.id !== sel.id);
          } else if (sel.kind === 'room') {
            f.rooms = f.rooms.filter((r) => r.id !== sel.id);
          } else if (sel.kind === 'trace') {
            f.traces = (f.traces ?? []).filter((t) => t.id !== sel.id);
          } else if (sel.kind === 'flabel') {
            f.labels = (f.labels ?? []).filter((l) => l.id !== sel.id);
          }
        });
      }
      set({ selection: null });
    },

    addType: (prefix, nome) => {
      const p = get().project;
      const id = prefix || uid('t');
      const type: AnomalyType = { id, prefix, nome };
      commit({ ...p, anomalyTypes: [...p.anomalyTypes, type] });
      set({ activeTypeId: id });
    },

    // mescla paredes/projeções/limites e rótulos no pavimento ativo (não apaga nada)
    importCroqui: (data) => {
      get().mutateFloor((f) => {
        for (const w of data.walls ?? [])
          f.walls.push({ id: uid('wall'), x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, kind: w.kind ?? 'wall' });
        for (const r of data.rooms ?? []) f.rooms.push({ id: uid('room'), x: r.x, y: r.y, nome: r.nome });
      });
    },

    // limpa o desenho do pavimento ativo (paredes, aberturas, rótulos).
    // Os pontos de anomalia ficam no projeto, mas perdem a posição neste pavimento.
    clearCroqui: () => {
      const p = get().project;
      get().mutateFloor((f) => {
        f.walls = [];
        f.openings = [];
        f.rooms = [];
      });
      const floorId = drawFloorId(p);
      const points = get().project.points.map((pt) =>
        pt.floorId === floorId ? { ...pt, floorId: null, x: 0, y: 0 } : pt,
      );
      commit({ ...get().project, points });
      set({ selection: null });
    },

    addPhotos: (photos) => {
      const p = get().project;
      // o mesmo nome de arquivo pode se repetir em camadas (pastas) diferentes
      const key = (x: Photo) => `${x.floorId ?? ''}|${x.subpasta ?? ''}|${x.nome}`;
      const existing = new Set(p.photos.map(key));
      const fresh = photos.filter((x) => !existing.has(key(x)));
      commit({ ...p, photos: [...p.photos, ...fresh] });
    },

    setClassification: (id, c) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((x) =>
          x.id === id ? { ...x, classification: c, reviewed: true } : x,
        ),
      });
    },

    setReviewed: (id, reviewed) => {
      const p = get().project;
      commit({
        ...p,
        photos: p.photos.map((x) => (x.id === id ? { ...x, reviewed } : x)),
      });
    },

    updatePhoto: (id, patch) => {
      const p = get().project;
      commit({ ...p, photos: p.photos.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
    },

    patchPhotos: (patches) => {
      if (patches.size === 0) return;
      const p = get().project;
      commit({ ...p, photos: p.photos.map((x) => (patches.has(x.id) ? { ...x, ...patches.get(x.id) } : x)) });
    },

    // Define o tamanho (escala 1-100 do editor) de TODAS as caixas de texto de todas as fotos.
    setAllTextSize: (normalized) => {
      const p = get().project;
      const photos = p.photos.map((ph) => {
        if (!ph.annotations.some((a) => a.kind === 'text')) return ph;
        const dim = Math.min(ph.width, ph.height) || 1000;
        const maxPx = Math.max(40, Math.round(dim * 0.12));
        const size = Math.max(1, Math.round((normalized / 100) * maxPx));
        return {
          ...ph,
          annotations: ph.annotations.map((a) => (a.kind === 'text' ? { ...a, strokeWidth: size } : a)),
        };
      });
      commit({ ...p, photos });
    },

    deletePhoto: (id) => {
      const p = get().project;
      commit({ ...p, photos: p.photos.filter((x) => x.id !== id) });
      void deletePhotoBlobs(id);
    },

    loadFromJSON: (project) => {
      commit(ensurePhotos(project));
      set({ selection: null, tool: 'select', home: false, projects: listProjects() });
    },

    resetProject: () => {
      const p = newProject();
      commit(p);
      set({ selection: null, tool: 'select', view: { tx: 80, ty: 60, scale: 1 } });
    },
  };
});

// ---------------------------------------------------------------------------
// Gravação em pasta do computador
// ---------------------------------------------------------------------------

setProjetoAtivo(useStore.getState().project.id);
useStore.subscribe((s) => setProjetoAtivo(s.project.id));

aoSalvar((estado) => {
  const d = useStore.getState().disco;
  if (d.pasta === null) return;
  useStore.setState({ disco: { ...d, estado, em: estado === 'salvo' ? Date.now() : d.em } });
});

window.addEventListener('beforeunload', descarregarPendentes);
window.addEventListener('pagehide', descarregarPendentes);

// Envia um projeto inteiro (dados, fundos e miniaturas) que só existia no navegador.
async function enviarProjetoCompleto(p: Project & { updatedAt?: number }) {
  if (!(await gravarNoDisco(p))) return;
  for (const f of p.floors) {
    if (!f.bg) continue;
    const blob = await idbGet<Blob>(`bg:${f.id}`);
    if (blob) await gravarArquivo('fundos', f.id, blob, p.id);
  }
  for (const ph of p.photos) {
    const blob = await idbGet<Blob>(`thumb:${ph.id}`);
    if (blob) await gravarArquivo('miniaturas', ph.id, blob, p.id);
  }
}

// Ao abrir o sistema: iguala o navegador e a pasta (vale a versão mais recente de cada projeto).
export async function sincronizarComDisco() {
  const lista = await listarDisco();
  if (!lista) {
    useStore.setState({ disco: { pasta: null, estado: 'falhou', em: 0 } });
    return;
  }
  const lerLocal = (id: string): (Project & { updatedAt?: number }) | null => {
    try {
      const raw = localStorage.getItem(KEY_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  // excluídos em outro navegador: saem daqui também
  for (const id of lista.excluidos) localStorage.removeItem(KEY_PREFIX + id);

  const noDisco = new Map(lista.projetos.map((m) => [m.id, m]));
  // pasta -> navegador
  for (const m of lista.projetos) {
    const loc = lerLocal(m.id);
    if (!loc || m.updatedAt > (loc.updatedAt ?? 0)) {
      const p = await lerDoDisco(m.id);
      if (p) localStorage.setItem(KEY_PREFIX + m.id, JSON.stringify(p));
    }
  }
  // navegador -> pasta
  for (const meta of listProjects()) {
    const loc = lerLocal(meta.id);
    if (!loc || intocado(loc)) continue;
    const d = noDisco.get(meta.id);
    if (!d) await enviarProjetoCompleto(loc);
    else if ((loc.updatedAt ?? 0) > d.updatedAt) await gravarNoDisco(loc);
  }

  const st = useStore.getState();
  const patch: Partial<State> = {
    projects: listProjects(),
    disco: { pasta: lista.pasta, estado: 'salvo', em: Date.now() },
  };
  // na tela inicial, recarrega o projeto corrente (pode ter vindo uma versão mais nova da pasta)
  if (st.home) {
    const atual = loadById(st.project.id) ?? (patch.projects!.length ? loadById(patch.projects![0].id) : null);
    if (atual) patch.project = atual;
  }
  useStore.setState(patch);
}

void sincronizarComDisco();
