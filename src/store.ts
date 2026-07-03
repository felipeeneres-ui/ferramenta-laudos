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
} from './types';
import { uid } from './geometry';
import { deletePhotoBlobs, delBg, delDirHandle } from './db';

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

function persist(project: Project) {
  try {
    localStorage.setItem(KEY_PREFIX + project.id, JSON.stringify({ ...project, updatedAt: Date.now() }));
    localStorage.setItem(ACTIVE_KEY, project.id);
  } catch {
    // armazenamento indisponível
  }
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

interface State {
  project: Project;
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
      // limpa os blobs (fotos, fundos, pasta) do projeto excluído
      if (p) {
        void (async () => {
          for (const ph of p.photos) await deletePhotoBlobs(ph.id);
          for (const f of p.floors) await delBg(f.id);
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
    snapEnabled: true,

    setAppView: (v) => set({ appView: v }),
    setPlacingPoint: (id) => set({ placingPointId: id }),
    toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
    setTool: (t) => set({ tool: t, selection: null, placingPointId: null }),
    setSelection: (s) => set({ selection: s }),
    setView: (v) => set({ view: { ...get().view, ...v } }),
    setActiveType: (id) => set({ activeTypeId: id }),
    setActiveLocal: (l) => set({ activeLocal: l }),
    setOpeningWidth: (w) => set({ openingWidth: w }),

    activeFloor: () => {
      const p = get().project;
      return p.floors.find((f) => f.id === p.activeFloorId) ?? p.floors[0];
    },

    mutateFloor: (fn) => {
      const p = get().project;
      const floors = p.floors.map((f) => {
        if (f.id !== p.activeFloorId) return f;
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
      commit({ ...p, floors: p.floors.map((f) => (f.id === id ? { ...f, nome } : f)) });
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

    setFloorBg: (bg) => {
      const floorId = get().project.activeFloorId;
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
        local: get().activeLocal,
        comodo: '',
        descricao: '',
        floorId: p.activeFloorId,
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
        local: attrs.local,
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
          pt.id === id ? { ...pt, floorId: p.activeFloorId, x, y } : pt,
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
      const floorId = p.activeFloorId;
      const points = get().project.points.map((pt) =>
        pt.floorId === floorId ? { ...pt, floorId: null, x: 0, y: 0 } : pt,
      );
      commit({ ...get().project, points });
      set({ selection: null });
    },

    addPhotos: (photos) => {
      const p = get().project;
      const existing = new Set(p.photos.map((x) => x.nome));
      const fresh = photos.filter((x) => !existing.has(x.nome));
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
