import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconPointer,
  IconArrowUpRight,
  IconSquare,
  IconCircle,
  IconMapPin,
  IconTypography,
  IconHighlight,
  IconDropletHalf2,
  IconCrop,
  IconTrash,
  IconDeviceFloppy,
  IconX,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconRestore,
  IconLine,
  IconScribble,
  IconCopy,
  IconLineDashed,
  IconArrowsHorizontal,
  IconSquareFilled,
  IconPlus,
  IconMinus,
  IconMaximize,
  IconZoomIn,
  IconRuler2,
  IconRotate,
  IconRotateClockwise,
} from '@tabler/icons-react';
import { useStore } from '../store';
import { usePhotoUrl } from '../photoUrl';
import { renderEditedBlob, borderWidth, sortByZ, bakeSourceCanvas, type PointInfo } from '../renderEdited';
import { putEdited, clearEdited, writeEditedToFolder, getOriginal } from '../db';
import { uid } from '../geometry';
import { textLayout, lineSegments } from '../textWrap';
import type { TextAlign } from '../types';
import {
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignJustified,
} from '@tabler/icons-react';
import {
  ANNOTATION_COLORS,
  LOCAL_COLORS,
  LOCAL_LABEL,
  type Annotation,
  type AnnotationKind,
  type Photo,
  type Local,
  type Project,
  type Point,
} from '../types';

type EdTool = 'select' | AnnotationKind | 'crop';
const LOCALS: Local[] = ['parede', 'piso', 'teto'];

const TOOLS: { id: EdTool; label: string; Icon: typeof IconPointer }[] = [
  { id: 'select', label: 'Selecionar', Icon: IconPointer },
  { id: 'arrow', label: 'Seta', Icon: IconArrowUpRight },
  { id: 'line', label: 'Linha reta', Icon: IconLine },
  { id: 'draw', label: 'Desenho livre', Icon: IconScribble },
  { id: 'rect', label: 'Retângulo', Icon: IconSquare },
  { id: 'ellipse', label: 'Círculo / elipse', Icon: IconCircle },
  { id: 'text', label: 'Caixa de texto', Icon: IconTypography },
  { id: 'point', label: 'Ponto de anomalia', Icon: IconMapPin },
  { id: 'magnify', label: 'Lente de detalhe (arraste da anomalia até onde fica a ampliação)', Icon: IconZoomIn },
  { id: 'measure', label: 'Cota / medida', Icon: IconRuler2 },
  { id: 'highlight', label: 'Realce', Icon: IconHighlight },
  { id: 'blur', label: 'Desfoque', Icon: IconDropletHalf2 },
  { id: 'crop', label: 'Recorte', Icon: IconCrop },
];

const DRAW_KINDS: AnnotationKind[] = ['arrow', 'line', 'draw', 'rect', 'ellipse', 'highlight', 'blur', 'point', 'text', 'magnify', 'measure'];
function isDrawKind(t: EdTool): t is AnnotationKind {
  return (DRAW_KINDS as string[]).includes(t);
}

interface Props {
  photo: Photo;
  onClose: () => void;
}

type Drag =
  | { type: 'draw'; id: string }
  | { type: 'free'; id: string } // desenho livre (lápis)
  | { type: 'move'; id: string; ox: number; oy: number }
  | { type: 'handle'; id: string; h: string }
  | { type: 'crop' }
  | null;

export function PhotoEditor({ photo, onClose }: Props) {
  const updatePhoto = useStore((s) => s.updatePhoto);
  const project = useStore((s) => s.project);
  const createPoint = useStore((s) => s.createPoint);
  const updateProjectPoint = useStore((s) => s.updatePoint);
  const addPointToPhoto = useStore((s) => s.addPointToPhoto);
  const removePointFromPhoto = useStore((s) => s.removePointFromPhoto);
  const url = usePhotoUrl(photo.id, 'original');

  // atributos para um NOVO ponto criado nesta foto
  const [ptType, setPtType] = useState(project.anomalyTypes[0]?.id ?? 'F');
  const [ptLocal, setPtLocal] = useState<Local>('parede');
  const [ptComodo, setPtComodo] = useState(
    () => project.floors.flatMap((f) => f.rooms.map((r) => r.nome).filter(Boolean))[0] ?? '',
  );
  // ponto existente selecionado para reaproveitar (null = criar novo)
  const [placeExisting, setPlaceExisting] = useState<string | null>(null);

  // rótulo + cor de cada ponto do projeto (para desenhar os marcadores)
  const pointInfo: PointInfo = useMemo(() => {
    const m: PointInfo = {};
    for (const pt of project.points) {
      const t = project.anomalyTypes.find((x) => x.id === pt.typeId);
      m[pt.id] = { label: `${t?.prefix ?? '?'}${pt.numero}`, color: LOCAL_COLORS[pt.local] };
    }
    return m;
  }, [project.points, project.anomalyTypes]);
  const comodos = Array.from(
    new Set(project.floors.flatMap((f) => f.rooms.map((r) => r.nome).filter(Boolean))),
  ).sort((a, b) => a.localeCompare(b, 'pt'));
  const photoDescricao = (project.photos.find((p) => p.id === photo.id) ?? photo).descricao;

  const [tool, setTool] = useState<EdTool>('select');
  // tamanhos padrão = média do que o usuário usou (escala ~18 setas/texto, ~20 pontos),
  // proporcionais à resolução da foto.
  const dim = Math.min(photo.width, photo.height) || 1000;
  const shapeSize = Math.max(3, Math.round(dim * 0.0054)); // setas/retângulos/círculos/realce ≈ nível 18
  const pointSize = Math.max(10, Math.round(dim * 0.024)); // ponto de anomalia ≈ nível 20
  const textSize = Math.max(12, Math.round(dim * 0.0216)); // caixa de texto ≈ nível 18
  const blurSize = Math.max(4, Math.round(dim * 0.014)); // sem histórico — valor moderado
  // memória de estilo (cor + tamanho + opções) por tipo: cada novo item repete o anterior
  type StyleEntry = { color: string; size: number; dashed?: boolean; doubleHead?: boolean; filled?: boolean };
  const [styles, setStyles] = useState<Record<AnnotationKind, StyleEntry>>({
    arrow: { color: '#000000', size: shapeSize },
    line: { color: '#000000', size: shapeSize },
    draw: { color: '#FF0000', size: shapeSize },
    rect: { color: '#000000', size: shapeSize },
    ellipse: { color: '#000000', size: shapeSize },
    highlight: { color: '#FFFF00', size: shapeSize },
    blur: { color: '#000000', size: blurSize },
    point: { color: '#000000', size: pointSize },
    text: { color: '#000000', size: textSize },
    magnify: { color: '#FF0000', size: Math.max(2, Math.round(shapeSize * 0.8)) },
    measure: { color: '#000000', size: shapeSize },
  });
  const [lastKind, setLastKind] = useState<AnnotationKind>('arrow');
  const [textAlign, setTextAlign] = useState<TextAlign>('left');
  const [anns, setAnns] = useState<Annotation[]>(photo.annotations);
  const [crop, setCrop] = useState(photo.crop);
  const [border, setBorder] = useState(photo.border !== false);
  const [sel, setSel] = useState<string | null>(null);
  const [draftCrop, setDraftCrop] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [saving, setSaving] = useState(false);

  const [adjust, setAdjust] = useState(photo.adjust ?? { brightness: 100, contrast: 100 });

  // base "assada" (rotação 90° + endireitar) para preview; sem transformações usa o original
  const rotate = photo.rotate ?? 0;
  const straighten = photo.straighten ?? 0;
  const [bakedUrl, setBakedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!rotate && !straighten) {
      setBakedUrl(null);
      return;
    }
    let alive = true;
    let made: string | null = null;
    (async () => {
      const blob = await getOriginal(photo.id);
      if (!blob) return;
      const bmp = await createImageBitmap(blob);
      const c = bakeSourceCanvas(bmp, rotate, straighten, photo.width, photo.height);
      bmp.close();
      c.toBlob((b) => {
        if (b && alive) {
          made = URL.createObjectURL(b);
          setBakedUrl(made);
        }
      }, 'image/jpeg', 0.9);
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.id, rotate, straighten, photo.width, photo.height]);
  const displayUrl = rotate || straighten ? bakedUrl : url;

  // rotação 90°: transforma anotações/recorte e troca as dimensões
  function rotate90(dir: 1 | -1) {
    const W = photo.width;
    const H = photo.height;
    const map = dir === 1 ? (x: number, y: number) => ({ x: H - y, y: x }) : (x: number, y: number) => ({ x: y, y: W - x });
    recordBefore(annsRef.current);
    const next = annsRef.current.map((a) => {
      const p1 = map(a.x, a.y);
      const p2 = map(a.x2, a.y2);
      const n: Annotation = { ...a, x: p1.x, y: p1.y, x2: p2.x, y2: p2.y };
      if (a.points) n.points = a.points.map((q) => map(q.x, q.y));
      if (a.lx != null && a.ly != null) {
        const l = map(a.lx, a.ly);
        n.lx = l.x;
        n.ly = l.y;
      }
      return n;
    });
    let nc = crop;
    if (crop)
      nc =
        dir === 1
          ? { x: H - (crop.y + crop.h), y: crop.x, w: crop.h, h: crop.w }
          : { x: crop.y, y: W - (crop.x + crop.w), w: crop.h, h: crop.w };
    const newRot = ((rotate + (dir === 1 ? 90 : 270)) % 360 + 360) % 360;
    applyAnns(next);
    setCrop(nc);
    setSel(null);
    updatePhoto(photo.id, { width: H, height: W, rotate: newRot, annotations: next, crop: nc, edited: true });
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag>(null);
  const annsRef = useRef<Annotation[]>(photo.annotations);
  // histórico para desfazer/refazer (instantâneos do array de anotações)
  const histRef = useRef<{ past: Annotation[][]; future: Annotation[][] }>({ past: [], future: [] });
  const beforeRef = useRef<Annotation[] | null>(null);

  function recordBefore(prev: Annotation[]) {
    histRef.current.past.push(prev);
    if (histRef.current.past.length > 60) histRef.current.past.shift();
    histRef.current.future = [];
  }

  // Mantém estado e ref em sincronia; commits ao store ficam fora dos updaters.
  function applyAnns(next: Annotation[]) {
    annsRef.current = next;
    setAnns(next);
  }

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function commit(next: Annotation[], nextCrop = crop) {
    updatePhoto(photo.id, {
      annotations: next,
      crop: nextCrop,
      edited: next.length > 0 || !!nextCrop,
    });
  }

  function toggleBorder() {
    const b = !border;
    setBorder(b);
    updatePhoto(photo.id, { border: b });
  }

  const scale = useMemo(() => {
    const maxW = Math.max(120, vp.w - 320);
    const maxH = Math.max(120, vp.h - 120);
    return Math.max(0.05, Math.min(maxW / photo.width, maxH / photo.height, 2));
  }, [vp, photo.width, photo.height]);
  const dispW = photo.width * scale;
  const dispH = photo.height * scale;

  // --- zoom & pan do palco (z = 1 → foto ajustada à tela) ---
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState({ z: 1, x: 0, y: 0 });
  const panRef = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const effScale = scale * view.z; // px de tela por px de imagem (tolerâncias/alças)

  function fitView() {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setViewState({ z: 1, x: (r.width - dispW) / 2, y: (r.height - dispH) / 2 });
  }
  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.id, dispW, dispH]);

  // zoom por scroll, centrado no cursor (listener não-passivo p/ poder prevenir o scroll)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const r = el!.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setViewState((v) => {
        const z = Math.min(8, Math.max(0.2, v.z * factor));
        const k = z / v.z;
        return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // segurar espaço = mover a vista (pan)
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      setSpaceDown(true);
    }
    function up(e: KeyboardEvent) {
      if (e.code === 'Space') setSpaceDown(false);
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  function zoomBy(factor: number) {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.width / 2;
    const cy = r.height / 2;
    setViewState((v) => {
      const z = Math.min(8, Math.max(0.2, v.z * factor));
      const k = z / v.z;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  }

  // pan: botão do meio ou espaço + arrasto (captura antes das ferramentas)
  function onStageDownCapture(e: React.PointerEvent) {
    if (e.button === 1 || spaceDown) {
      e.preventDefault();
      e.stopPropagation();
      panRef.current = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  }
  function onStageMove(e: React.PointerEvent) {
    const p = panRef.current;
    if (!p) return;
    setViewState((v) => ({ ...v, x: p.x + (e.clientX - p.sx), y: p.y + (e.clientY - p.sy) }));
  }
  function onStageUp() {
    panRef.current = null;
  }

  function toImg(e: { clientX: number; clientY: number }) {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * photo.width,
      y: ((e.clientY - r.top) / r.height) * photo.height,
    };
  }

  const pickR = 10 / effScale;

  function norm(a: { x: number; y: number; x2: number; y2: number }) {
    return { x: Math.min(a.x, a.x2), y: Math.min(a.y, a.y2), w: Math.abs(a.x2 - a.x), h: Math.abs(a.y2 - a.y) };
  }

  function handlesFor(a: Annotation): { h: string; x: number; y: number }[] {
    if (a.kind === 'arrow' || a.kind === 'line')
      return [{ h: 'a', x: a.x, y: a.y }, { h: 'b', x: a.x2, y: a.y2 }];
    if (a.kind === 'point')
      // com linha de chamada: alça na âncora para reposicionar o local exato
      return a.lx != null && a.ly != null ? [{ h: 'anchor', x: a.x, y: a.y }] : [];
    if (a.kind === 'magnify')
      return [
        { h: 'src', x: a.x, y: a.y }, // centro da fonte
        { h: 'radius', x: a.x + (a.r ?? 60), y: a.y }, // raio da fonte
      ];
    if (a.kind === 'measure')
      return [{ h: 'a', x: a.x, y: a.y }, { h: 'b', x: a.x2, y: a.y2 }];
    if (a.kind === 'draw') return [];
    if (a.kind === 'text') {
      // alças nas laterais para ajustar a largura (o texto requebra)
      const L = textLayout(a);
      return [
        { h: 'l', x: a.x, y: L.y + L.h / 2 },
        { h: 'r', x: a.x2, y: L.y + L.h / 2 },
      ];
    }
    return [
      { h: 'tl', x: a.x, y: a.y },
      { h: 'tr', x: a.x2, y: a.y },
      { h: 'bl', x: a.x, y: a.y2 },
      { h: 'br', x: a.x2, y: a.y2 },
    ];
  }

  function hitAnnotation(p: { x: number; y: number }): string | null {
    for (let i = anns.length - 1; i >= 0; i--) {
      const a = anns[i];
      if (a.kind === 'arrow' || a.kind === 'line' || a.kind === 'measure') {
        if (distToSeg(p, a) < 8 / effScale + a.strokeWidth) return a.id;
      } else if (a.kind === 'magnify') {
        const r = a.r ?? 60;
        const R = r * (a.zoom ?? 2.5);
        // inset (círculo grande) ou o anel da fonte
        if (Math.hypot(p.x - a.x2, p.y - a.y2) < R + 4 / effScale) return a.id;
        if (Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - r) < 8 / effScale + a.strokeWidth) return a.id;
      } else if (a.kind === 'draw') {
        const pts = a.points ?? [];
        const tol = 8 / effScale + a.strokeWidth;
        for (let k = 1; k < pts.length; k++) {
          if (distToSeg(p, { x: pts[k - 1].x, y: pts[k - 1].y, x2: pts[k].x, y2: pts[k].y }) < tol) return a.id;
        }
      } else if (a.kind === 'point') {
        const rad = 9 + a.strokeWidth;
        const cx = a.lx ?? a.x;
        const cy = a.ly ?? a.y;
        if (Math.hypot(p.x - cx, p.y - cy) < rad + 4 / effScale) return a.id;
      } else if (a.kind === 'text') {
        const b = textLayout(a);
        if (p.x >= b.x - pickR && p.x <= b.x + b.w + pickR && p.y >= b.y - pickR && p.y <= b.y + b.h + pickR)
          return a.id;
      } else {
        const r = norm(a);
        if (p.x >= r.x - pickR && p.x <= r.x + r.w + pickR && p.y >= r.y - pickR && p.y <= r.y + r.h + pickR)
          return a.id;
      }
    }
    return null;
  }

  function onDown(e: React.PointerEvent) {
    const p = toImg(e);
    svgRef.current?.setPointerCapture(e.pointerId);

    if (tool === 'crop') {
      setDraftCrop({ x: p.x, y: p.y, x2: p.x, y2: p.y });
      dragRef.current = { type: 'crop' };
      return;
    }

    if (tool === 'select') {
      // handle de redimensionar?
      if (sel) {
        const a = anns.find((x) => x.id === sel);
        if (a) {
          for (const h of handlesFor(a)) {
            if (Math.hypot(p.x - h.x, p.y - h.y) < pickR + 4 / effScale) {
              dragRef.current = { type: 'handle', id: sel, h: h.h };
              beforeRef.current = annsRef.current;
              return;
            }
          }
        }
      }
      const hit = hitAnnotation(p);
      setSel(hit);
      if (hit) {
        dragRef.current = { type: 'move', id: hit, ox: p.x, oy: p.y };
        beforeRef.current = annsRef.current;
      }
      return;
    }

    // desenho livre (lápis): acumula pontos enquanto arrasta
    if (tool === 'draw') {
      const id = uid('ann');
      const st = styles.draw;
      const a: Annotation = {
        id,
        kind: 'draw',
        x: p.x,
        y: p.y,
        x2: p.x,
        y2: p.y,
        points: [{ x: p.x, y: p.y }],
        dashed: st.dashed,
        color: st.color,
        strokeWidth: st.size,
      };
      beforeRef.current = annsRef.current;
      applyAnns([...annsRef.current, a]);
      setSel(id);
      dragRef.current = { type: 'free', id };
      return;
    }

    // ponto de anomalia: cria (ou reaproveita) um ponto do projeto e o marca aqui
    if (tool === 'point') {
      const pointId =
        placeExisting ?? createPoint({ typeId: ptType, local: ptLocal, comodo: ptComodo });
      const id = uid('ann');
      const marker: Annotation = {
        id,
        kind: 'point',
        pointId,
        x: p.x,
        y: p.y,
        x2: p.x,
        y2: p.y,
        color: '#000000',
        strokeWidth: styles.point.size,
      };
      recordBefore(annsRef.current);
      const next = [...annsRef.current, marker];
      applyAnns(next);
      commit(next);
      addPointToPhoto(photo.id, pointId);
      // mantém a ferramenta de ponto e a lista abertas para colocar vários rapidamente
      setPlaceExisting(null);
      dragRef.current = null;
      return;
    }

    // ferramentas de desenho (seta, linha, retângulo, elipse, realce, blur)
    const kind = tool as AnnotationKind;
    const id = uid('ann');
    const st = styles[kind];
    const base: Annotation = {
      id,
      kind,
      x: p.x,
      y: p.y,
      x2: p.x,
      y2: p.y,
      dashed: st.dashed,
      doubleHead: st.doubleHead,
      filled: st.filled,
      color: st.color,
      strokeWidth: st.size,
    };
    if (kind === 'text') {
      base.text = 'Texto';
      base.align = textAlign;
      // largura inicial da caixa (o usuário ajusta arrastando as alças laterais)
      base.x2 = p.x + Math.max(80, Math.round(dim * 0.4));
    }
    if (kind === 'magnify') {
      base.r = Math.round(dim * 0.055);
      base.zoom = 2.5;
    }
    if (kind === 'measure') base.text = '0,00 m';
    beforeRef.current = annsRef.current;
    const next = [...annsRef.current, base];
    applyAnns(next);
    setSel(id);
    if (kind === 'text') {
      dragRef.current = null;
      recordBefore(beforeRef.current);
      commit(next);
      setTool('select');
    } else {
      dragRef.current = { type: 'draw', id };
    }
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const p = toImg(e);

    if (d.type === 'crop') {
      setDraftCrop((c) => (c ? { ...c, x2: p.x, y2: p.y } : c));
      return;
    }
    if (d.type === 'draw') {
      applyAnns(annsRef.current.map((a) => (a.id === d.id ? { ...a, x2: p.x, y2: p.y } : a)));
      return;
    }
    if (d.type === 'free') {
      applyAnns(
        annsRef.current.map((a) =>
          a.id === d.id ? { ...a, points: [...(a.points ?? []), { x: p.x, y: p.y }], x2: p.x, y2: p.y } : a,
        ),
      );
      return;
    }
    if (d.type === 'move') {
      const dx = p.x - d.ox;
      const dy = p.y - d.oy;
      dragRef.current = { ...d, ox: p.x, oy: p.y };
      applyAnns(
        annsRef.current.map((a) => {
          if (a.id !== d.id) return a;
          // ponto com linha de chamada: mover arrasta só o rótulo (a âncora fica)
          if (a.kind === 'point' && a.lx != null && a.ly != null)
            return { ...a, lx: a.lx + dx, ly: a.ly + dy };
          // lente: mover arrasta só o inset (a fonte fica na anomalia)
          if (a.kind === 'magnify') return { ...a, x2: a.x2 + dx, y2: a.y2 + dy };
          return {
            ...a,
            x: a.x + dx,
            y: a.y + dy,
            x2: a.x2 + dx,
            y2: a.y2 + dy,
            points: a.points ? a.points.map((q) => ({ x: q.x + dx, y: q.y + dy })) : undefined,
          };
        }),
      );
      return;
    }
    if (d.type === 'handle') {
      applyAnns(
        annsRef.current.map((a) => {
          if (a.id !== d.id) return a;
          const n = { ...a };
          if (d.h === 'anchor') {
            n.x = p.x;
            n.y = p.y;
            n.x2 = p.x;
            n.y2 = p.y;
          } else if (d.h === 'src') {
            n.x = p.x;
            n.y = p.y;
          } else if (d.h === 'radius') {
            n.r = Math.max(10, Math.hypot(p.x - a.x, p.y - a.y));
          } else if (d.h === 'a') {
            n.x = p.x;
            n.y = p.y;
          } else if (d.h === 'b') {
            n.x2 = p.x;
            n.y2 = p.y;
          } else {
            if (d.h.includes('l')) n.x = p.x;
            if (d.h.includes('r')) n.x2 = p.x;
            if (d.h.includes('t')) n.y = p.y;
            if (d.h.includes('b')) n.y2 = p.y;
          }
          return n;
        }),
      );
    }
  }

  function onUp() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    if (d.type === 'crop') {
      const c = draftCrop;
      setDraftCrop(null);
      if (c) {
        const r = norm(c);
        if (r.w > 10 && r.h > 10) {
          const nc = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
          setCrop(nc);
          commit(anns, nc);
        }
      }
      setTool('select');
      return;
    }
    if (d.type === 'free') {
      // descarta riscos minúsculos; mantém a ferramenta ativa para desenhar de novo
      const a = annsRef.current.find((x) => x.id === d.id);
      let next = annsRef.current;
      if ((a?.points?.length ?? 0) < 3) next = annsRef.current.filter((x) => x.id !== d.id);
      else if (beforeRef.current) recordBefore(beforeRef.current);
      applyAnns(next);
      setSel(null);
      commit(next);
      beforeRef.current = null;
      return;
    }
    if (d.type === 'draw') {
      // descarta desenhos minúsculos (clique sem arrasto)
      const a = annsRef.current.find((x) => x.id === d.id);
      let next = annsRef.current;
      let kept = true;
      if (a && Math.hypot(a.x2 - a.x, a.y2 - a.y) < 5 / effScale) {
        next = annsRef.current.filter((x) => x.id !== d.id);
        setSel(null);
        kept = false;
      }
      if (kept && beforeRef.current) recordBefore(beforeRef.current);
      applyAnns(next);
      commit(next);
      setTool('select');
      beforeRef.current = null;
      return;
    }
    // move / handle → persiste (registra histórico se mudou)
    if (beforeRef.current && beforeRef.current !== annsRef.current) recordBefore(beforeRef.current);
    beforeRef.current = null;
    commit(annsRef.current);
  }

  function deleteSel() {
    if (!sel) return;
    const removed = annsRef.current.find((a) => a.id === sel);
    recordBefore(annsRef.current);
    const next = annsRef.current.filter((a) => a.id !== sel);
    applyAnns(next);
    setSel(null);
    commit(next);
    // se era um marcador de ponto e nenhum outro o referencia, desvincula a foto
    if (removed?.kind === 'point' && removed.pointId) {
      const stillUsed = next.some((a) => a.kind === 'point' && a.pointId === removed.pointId);
      if (!stillUsed) removePointFromPhoto(photo.id, removed.pointId);
    }
  }

  function undo() {
    const h = histRef.current;
    if (!h.past.length) return;
    h.future.push(annsRef.current);
    const prev = h.past.pop()!;
    applyAnns(prev);
    setSel(null);
    commit(prev);
  }
  function redo() {
    const h = histRef.current;
    if (!h.future.length) return;
    h.past.push(annsRef.current);
    const nx = h.future.pop()!;
    applyAnns(nx);
    setSel(null);
    commit(nx);
  }

  function duplicateSel() {
    if (!sel) return;
    const a = annsRef.current.find((x) => x.id === sel);
    if (!a || a.kind === 'point') return; // não duplicar marcadores de ponto
    recordBefore(annsRef.current);
    const off = Math.max(8, a.strokeWidth);
    const copy: Annotation = {
      ...a,
      id: uid('ann'),
      x: a.x + off,
      y: a.y + off,
      x2: a.x2 + off,
      y2: a.y2 + off,
      points: a.points ? a.points.map((q) => ({ x: q.x + off, y: q.y + off })) : undefined,
    };
    const next = [...annsRef.current, copy];
    applyAnns(next);
    setSel(copy.id);
    commit(next);
  }

  function setAdjustValue(patch: Partial<{ brightness: number; contrast: number }>) {
    const v = { ...adjust, ...patch };
    setAdjust(v);
    updatePhoto(photo.id, { adjust: v });
  }

  function updateSel(patch: Partial<Annotation>) {
    const next = annsRef.current.map((a) => (a.id === sel ? { ...a, ...patch } : a));
    applyAnns(next);
    commit(next);
  }

  function removeCrop() {
    setCrop(null);
    commit(anns, null);
  }

  function resetPhoto() {
    if (!confirm('Apagar todas as edições desta foto? Isso remove anotações e recorte (a foto original é preservada).')) return;
    applyAnns([]);
    setCrop(null);
    setSel(null);
    setBorder(true);
    setAdjust({ brightness: 100, contrast: 100 });
    histRef.current = { past: [], future: [] };
    // desfaz rotação: restaura as dimensões originais
    const swapped = rotate === 90 || rotate === 270;
    updatePhoto(photo.id, {
      annotations: [],
      crop: null,
      border: true,
      adjust: { brightness: 100, contrast: 100 },
      rotate: 0,
      straighten: 0,
      width: swapped ? photo.height : photo.width,
      height: swapped ? photo.width : photo.height,
      edited: false,
    });
    void clearEdited(photo.id);
  }

  async function save() {
    setSaving(true);
    try {
      const current = annsRef.current;
      const blob = await renderEditedBlob({ ...photo, annotations: current, crop, border, adjust }, current, pointInfo);
      await putEdited(photo.id, blob);
      const written = await writeEditedToFolder(project.id, photo.nome, blob);
      updatePhoto(photo.id, { annotations: current, crop, border, adjust, edited: true });
      if (written) {
        alert(`Cópia editada salva na pasta: ${written}`);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${photo.nome.replace(/\.[^.]+$/, '')}_edit.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      onClose();
    } catch (err) {
      alert('Não foi possível gerar a imagem editada: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
      else if (e.key === 'Escape') onClose();
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        duplicateSel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const selAnn = anns.find((a) => a.id === sel) ?? null;
  const curKind: AnnotationKind = selAnn ? selAnn.kind : isDrawKind(tool) ? tool : lastKind;
  const curColor = selAnn ? selAnn.color : styles[curKind].color;
  const curSize = selAnn ? selAnn.strokeWidth : styles[curKind].size;
  const curDashed = selAnn ? !!selAnn.dashed : !!styles[curKind].dashed;
  const curDouble = selAnn ? !!selAnn.doubleHead : !!styles[curKind].doubleHead;
  const curFilled = selAnn ? !!selAnn.filled : !!styles[curKind].filled;

  function setStyleColor(c: string) {
    if (selAnn) {
      updateSel({ color: c });
      setStyles((s) => ({ ...s, [selAnn.kind]: { ...s[selAnn.kind], color: c } }));
    } else {
      setStyles((s) => ({ ...s, [curKind]: { ...s[curKind], color: c } }));
    }
  }
  function setStyleSize(v: number) {
    if (selAnn) {
      updateSel({ strokeWidth: v });
      setStyles((s) => ({ ...s, [selAnn.kind]: { ...s[selAnn.kind], size: v } }));
    } else {
      setStyles((s) => ({ ...s, [curKind]: { ...s[curKind], size: v } }));
    }
  }
  function setStyleFlag(key: 'dashed' | 'doubleHead' | 'filled', val: boolean) {
    if (selAnn) {
      updateSel({ [key]: val });
      setStyles((s) => ({ ...s, [selAnn.kind]: { ...s[selAnn.kind], [key]: val } }));
    } else {
      setStyles((s) => ({ ...s, [curKind]: { ...s[curKind], [key]: val } }));
    }
  }

  return (
    <div className="editor">
      <div className="ed-top">
        <div className="ed-tools">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`ed-tool${tool === id ? ' active' : ''}`}
              title={label}
              aria-label={label}
              onClick={() => {
                setTool(id);
                setSel(null);
                if (isDrawKind(id)) setLastKind(id);
              }}
            >
              <Icon size={19} stroke={1.7} />
            </button>
          ))}
          <div className="ed-sep" />
          <button className="ed-tool" title="Desfazer (Ctrl+Z)" onClick={undo}>
            <IconArrowBackUp size={19} stroke={1.7} />
          </button>
          <button className="ed-tool" title="Refazer (Ctrl+Shift+Z)" onClick={redo}>
            <IconArrowForwardUp size={19} stroke={1.7} />
          </button>
        </div>
        <span className="ed-name">{photo.nome}</span>
        <div className="ed-actions">
          <button className="icon-btn ghost-light" onClick={resetPhoto} disabled={saving} title="Reiniciar foto (apagar todas as edições)">
            <IconRestore size={16} /> Reiniciar
          </button>
          <button className="icon-btn" onClick={save} disabled={saving}>
            <IconDeviceFloppy size={16} /> {saving ? 'Salvando…' : 'Salvar cópia'}
          </button>
          <button className="vt-close" onClick={onClose} aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>
      </div>

      <div className="ed-body">
        <div
          className="ed-stage"
          ref={stageRef}
          onPointerDownCapture={onStageDownCapture}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
          style={{ cursor: spaceDown ? 'grab' : undefined }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: dispW,
              height: dispH,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
              transformOrigin: '0 0',
            }}
          >
            {displayUrl && (
              <img
                src={displayUrl}
                alt={photo.nome}
                style={{
                  width: dispW,
                  height: dispH,
                  display: 'block',
                  filter:
                    adjust.brightness !== 100 || adjust.contrast !== 100
                      ? `brightness(${adjust.brightness}%) contrast(${adjust.contrast}%)`
                      : undefined,
                }}
              />
            )}
            <svg
              ref={svgRef}
              width={dispW}
              height={dispH}
              viewBox={`0 0 ${photo.width} ${photo.height}`}
              style={{ position: 'absolute', inset: 0, cursor: tool === 'select' ? 'default' : 'crosshair', touchAction: 'none' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
            >
              <defs>
                <marker id="ah" markerWidth="5" markerHeight="5" refX="2" refY="2.5" orient="auto-start-reverse" markerUnits="strokeWidth">
                  <path d="M0,0 L5,2.5 L0,5 z" fill="context-stroke" />
                </marker>
                {anns.filter((a) => a.kind === 'blur').map((a) => {
                  const r = norm(a);
                  return (
                    <clipPath key={a.id} id={`clip-${a.id}`}>
                      <rect x={r.x} y={r.y} width={r.w} height={r.h} />
                    </clipPath>
                  );
                })}
                <filter id="blurf" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation={6} />
                </filter>
              </defs>

              {/* blur (imagem borrada recortada à região) */}
              {displayUrl &&
                anns
                  .filter((a) => a.kind === 'blur')
                  .map((a) => (
                    <image
                      key={a.id}
                      href={displayUrl}
                      x={0}
                      y={0}
                      width={photo.width}
                      height={photo.height}
                      clipPath={`url(#clip-${a.id})`}
                      filter="url(#blurf)"
                    />
                  ))}

              {sortByZ(anns).map((a) => (
                <AnnView
                  key={a.id}
                  a={a}
                  norm={norm}
                  selected={a.id === sel}
                  pointInfo={pointInfo}
                  imgUrl={displayUrl}
                  imgW={photo.width}
                  imgH={photo.height}
                />
              ))}

              {/* handles do selecionado */}
              {selAnn &&
                handlesFor(selAnn).map((h) => (
                  <rect
                    key={h.h}
                    x={h.x - pickR / 2}
                    y={h.y - pickR / 2}
                    width={pickR}
                    height={pickR}
                    fill="#fff"
                    stroke="#2563eb"
                    strokeWidth={1.5 / effScale}
                  />
                ))}

              {/* prévia da borda preta */}
              {border &&
                (() => {
                  const fb = crop ?? { x: 0, y: 0, w: photo.width, h: photo.height };
                  const bw = borderWidth(fb.w, fb.h);
                  return (
                    <rect
                      x={fb.x + bw / 2}
                      y={fb.y + bw / 2}
                      width={fb.w - bw}
                      height={fb.h - bw}
                      fill="none"
                      stroke="#000"
                      strokeWidth={bw}
                    />
                  );
                })()}

              {/* recorte */}
              {(crop || draftCrop) && (() => {
                const c = draftCrop ? norm(draftCrop) : crop!;
                return (
                  <g>
                    <path
                      d={`M0 0 H${photo.width} V${photo.height} H0 Z M${c.x} ${c.y} h${c.w} v${c.h} h${-c.w} Z`}
                      fill="rgba(0,0,0,0.45)"
                      fillRule="evenodd"
                    />
                    <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="#fff" strokeWidth={2 / effScale} strokeDasharray={`${6 / effScale} ${4 / effScale}`} />
                  </g>
                );
              })()}
            </svg>
          </div>

          <div className="ed-zoom" title="Scroll = zoom · Espaço ou botão do meio + arrastar = mover">
            <button onClick={() => zoomBy(1 / 1.25)} aria-label="Reduzir zoom">
              <IconMinus size={14} />
            </button>
            <span className="pct">{Math.round(view.z * 100)}%</span>
            <button onClick={() => zoomBy(1.25)} aria-label="Aumentar zoom">
              <IconPlus size={14} />
            </button>
            <button onClick={fitView} aria-label="Ajustar à tela" title="Ajustar à tela">
              <IconMaximize size={14} />
            </button>
          </div>
        </div>

        <div className="ed-panel">
          {curKind !== 'point' && (
            <div className="ep-section">
              <div className="ep-label">Cor</div>
              <div className="swatches">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`sw${curColor.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setStyleColor(c)}
                    aria-label={c}
                  />
                ))}
                <label className="sw custom" title="Cor personalizada">
                  <input type="color" value={curColor} onChange={(e) => setStyleColor(e.target.value)} />
                </label>
              </div>
            </div>
          )}

          {/* Ponto de anomalia: editar o ponto selecionado, ou definir um novo */}
          {curKind === 'point' && (
            <PointPanel
              selPointId={selAnn?.kind === 'point' ? selAnn.pointId ?? null : null}
              project={project}
              comodos={comodos}
              ptType={ptType}
              ptLocal={ptLocal}
              ptComodo={ptComodo}
              setPtType={setPtType}
              setPtLocal={setPtLocal}
              setPtComodo={setPtComodo}
              placeExisting={placeExisting}
              setPlaceExisting={setPlaceExisting}
              updateProjectPoint={updateProjectPoint}
            />
          )}

          {(() => {
            const label =
              curKind === 'text' || curKind === 'point'
                ? 'Tamanho'
                : curKind === 'blur'
                  ? 'Intensidade'
                  : 'Espessura';
            // escala de 1 a 100 → pixels da imagem (proporcional à resolução)
            const maxPx =
              curKind === 'text' || curKind === 'point'
                ? Math.max(40, Math.round(dim * 0.12))
                : curKind === 'blur'
                  ? Math.max(20, Math.round(dim * 0.04))
                  : Math.max(20, Math.round(dim * 0.03));
            const factor = maxPx / 100;
            const display = Math.max(1, Math.min(100, Math.round(curSize / factor)));
            return (
              <div className="ep-section">
                <div className="ep-label">
                  {label} <span style={{ fontFamily: 'var(--mono)' }}>{display}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={display}
                  onChange={(e) => setStyleSize(Math.max(1, Math.round(Number(e.target.value) * factor)))}
                />
              </div>
            );
          })()}

          {(curKind === 'arrow' || curKind === 'line' || curKind === 'rect' || curKind === 'ellipse') && (
            <div className="ep-section">
              <div className="ep-label">Opções</div>
              <div className="ed-opts">
                <button
                  className={`opt${curDashed ? ' on' : ''}`}
                  onClick={() => setStyleFlag('dashed', !curDashed)}
                  title="Tracejado"
                >
                  <IconLineDashed size={16} /> Tracejado
                </button>
                {curKind === 'arrow' && (
                  <button
                    className={`opt${curDouble ? ' on' : ''}`}
                    onClick={() => setStyleFlag('doubleHead', !curDouble)}
                    title="Seta com duas pontas"
                  >
                    <IconArrowsHorizontal size={16} /> Duas pontas
                  </button>
                )}
                {(curKind === 'rect' || curKind === 'ellipse') && (
                  <button
                    className={`opt${curFilled ? ' on' : ''}`}
                    onClick={() => setStyleFlag('filled', !curFilled)}
                    title="Preenchido"
                  >
                    <IconSquareFilled size={16} /> Preenchido
                  </button>
                )}
              </div>
            </div>
          )}

          {curKind === 'text' && (
            <div className="ep-section">
              <div className="ep-label">Alinhamento</div>
              <div className="ed-align">
                {(
                  [
                    ['left', IconAlignLeft],
                    ['center', IconAlignCenter],
                    ['right', IconAlignRight],
                    ['justify', IconAlignJustified],
                  ] as [TextAlign, typeof IconAlignLeft][]
                ).map(([al, Icon]) => {
                  const cur = selAnn?.kind === 'text' ? selAnn.align ?? 'left' : textAlign;
                  return (
                    <button
                      key={al}
                      className={cur === al ? 'active' : ''}
                      onClick={() => {
                        if (selAnn?.kind === 'text') updateSel({ align: al });
                        setTextAlign(al);
                      }}
                      title={al}
                    >
                      <Icon size={17} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selAnn?.kind === 'text' && (
            <div className="ep-section">
              <div className="ep-label">Texto</div>
              <textarea
                className="ep-text"
                value={selAnn.text ?? ''}
                autoFocus
                onChange={(e) => updateSel({ text: e.target.value })}
              />
            </div>
          )}

          {selAnn?.kind === 'measure' && (
            <div className="ep-section">
              <div className="ep-label">Texto da cota</div>
              <input
                className="ep-input"
                type="text"
                value={selAnn.text ?? ''}
                autoFocus
                placeholder="Ex.: 0,45 m"
                onChange={(e) => updateSel({ text: e.target.value })}
              />
            </div>
          )}

          {selAnn?.kind === 'magnify' && (
            <div className="ep-section">
              <div className="ep-label">
                Ampliação <span style={{ fontFamily: 'var(--mono)' }}>{(selAnn.zoom ?? 2.5).toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min={15}
                max={40}
                value={Math.round((selAnn.zoom ?? 2.5) * 10)}
                onChange={(e) => updateSel({ zoom: Number(e.target.value) / 10 })}
              />
              <p className="muted">Arraste o círculo grande para posicionar; as alças ajustam o centro e o raio da área de origem.</p>
            </div>
          )}

          {selAnn && selAnn.kind !== 'point' && (
            <button className="panel-btn" onClick={duplicateSel}>
              <IconCopy size={15} /> Duplicar (Ctrl+D)
            </button>
          )}

          {selAnn?.kind === 'point' && (
            <button
              className="panel-btn"
              onClick={() => {
                if (selAnn.lx != null) updateSel({ lx: undefined, ly: undefined });
                else updateSel({ lx: selAnn.x + dim * 0.09, ly: selAnn.y - dim * 0.09 });
              }}
            >
              {selAnn.lx != null ? 'Remover linha de chamada' : 'Linha de chamada (rótulo afastado)'}
            </button>
          )}

          {selAnn && (
            <button className="panel-btn danger" onClick={deleteSel}>
              <IconTrash size={15} /> Excluir anotação
            </button>
          )}

          {crop && (
            <button className="panel-btn" onClick={removeCrop}>
              <IconCrop size={15} /> Remover recorte
            </button>
          )}

          <div className="ep-section" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div className="ep-label">Imagem</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button className="panel-btn" style={{ flex: 1, margin: 0 }} onClick={() => rotate90(-1)} title="Girar 90° anti-horário">
                <IconRotate size={15} /> 90°
              </button>
              <button className="panel-btn" style={{ flex: 1, margin: 0 }} onClick={() => rotate90(1)} title="Girar 90° horário">
                <IconRotateClockwise size={15} /> 90°
              </button>
            </div>
            <div className="ep-label">
              Endireitar <span style={{ fontFamily: 'var(--mono)' }}>{straighten.toFixed(1)}°</span>
            </div>
            <input
              type="range"
              min={-150}
              max={150}
              value={Math.round(straighten * 10)}
              onChange={(e) => updatePhoto(photo.id, { straighten: Number(e.target.value) / 10, edited: true })}
            />
            {straighten !== 0 && (
              <button className="panel-btn" onClick={() => updatePhoto(photo.id, { straighten: 0 })}>
                Zerar endireitamento
              </button>
            )}
            <p className="muted">Endireite antes de anotar: o giro fino move a imagem sob as marcações.</p>
          </div>

          <div className="ep-section" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div className="ep-label">
              Brilho <span style={{ fontFamily: 'var(--mono)' }}>{adjust.brightness}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              value={adjust.brightness}
              onChange={(e) => setAdjustValue({ brightness: Number(e.target.value) })}
            />
            <div className="ep-label" style={{ marginTop: 8 }}>
              Contraste <span style={{ fontFamily: 'var(--mono)' }}>{adjust.contrast}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={150}
              value={adjust.contrast}
              onChange={(e) => setAdjustValue({ contrast: Number(e.target.value) })}
            />
            {(adjust.brightness !== 100 || adjust.contrast !== 100) && (
              <button
                className="panel-btn"
                style={{ marginTop: 8 }}
                onClick={() => setAdjustValue({ brightness: 100, contrast: 100 })}
              >
                Redefinir brilho/contraste
              </button>
            )}
          </div>

          <div className="ep-section" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
            <div className="ep-label">Descrição da foto</div>
            <textarea
              className="ep-text"
              placeholder="Ex.: Parede lateral com diversos pontos de fissuras na alvenaria"
              value={photoDescricao}
              onChange={(e) => updatePhoto(photo.id, { descricao: e.target.value })}
            />
          </div>

          <label className="ep-check">
            <input type="checkbox" checked={border} onChange={toggleBorder} />
            Borda preta (padrão do laudo)
          </label>

          <p className="muted">
            A imagem original é preservada. Ao salvar, é gerada a cópia <b>_edit.png</b>
            {' '}na pasta da vistoria (ou baixada).
          </p>
        </div>
      </div>
    </div>
  );
}

function PointPanel({
  selPointId,
  project,
  comodos,
  ptType,
  ptLocal,
  ptComodo,
  setPtType,
  setPtLocal,
  setPtComodo,
  placeExisting,
  setPlaceExisting,
  updateProjectPoint,
}: {
  selPointId: string | null;
  project: Project;
  comodos: string[];
  ptType: string;
  ptLocal: Local;
  ptComodo: string;
  setPtType: (v: string) => void;
  setPtLocal: (v: Local) => void;
  setPtComodo: (v: string) => void;
  placeExisting: string | null;
  setPlaceExisting: (v: string | null) => void;
  updateProjectPoint: (id: string, patch: Partial<Point>) => void;
}) {
  const selPoint = selPointId ? project.points.find((p) => p.id === selPointId) : null;

  if (selPoint) {
    const t = project.anomalyTypes.find((x) => x.id === selPoint.typeId);
    return (
      <div className="ep-section">
        <div className="ep-label">
          Ponto {t?.prefix}
          {selPoint.numero}
        </div>
        <select className="ep-input" value={selPoint.typeId} onChange={(e) => updateProjectPoint(selPoint.id, { typeId: e.target.value })}>
          {project.anomalyTypes.map((at) => (
            <option key={at.id} value={at.id}>
              {at.prefix} — {at.nome}
            </option>
          ))}
        </select>
        <div className="ed-seg">
          {LOCALS.map((l) => (
            <button
              key={l}
              className={selPoint.local === l ? 'active' : ''}
              onClick={() => updateProjectPoint(selPoint.id, { local: l })}
            >
              <span className="dot" style={{ background: LOCAL_COLORS[l] }} />
              {LOCAL_LABEL[l]}
            </button>
          ))}
        </div>
        <input
          className="ep-input"
          type="text"
          list="ed-comodos"
          placeholder="Cômodo"
          value={selPoint.comodo}
          onChange={(e) => updateProjectPoint(selPoint.id, { comodo: e.target.value })}
        />
        <textarea
          className="ep-text"
          placeholder="Descrição (ex.: Fissura na alvenaria)"
          value={selPoint.descricao}
          onChange={(e) => updateProjectPoint(selPoint.id, { descricao: e.target.value })}
        />
        <datalist id="ed-comodos">
          {comodos.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="muted">Esse ponto vai à tabela no cômodo escolhido. Posicione-o também no croqui (lista "a posicionar").</p>
      </div>
    );
  }

  const typeOf = (id: string) => project.anomalyTypes.find((x) => x.id === id);
  const pontosDoComodo = project.points
    .filter((p) => p.comodo.trim() === ptComodo.trim())
    .sort((a, b) => {
      const pa = typeOf(a.typeId)?.prefix ?? '';
      const pb = typeOf(b.typeId)?.prefix ?? '';
      return pa.localeCompare(pb, 'pt') || a.numero - b.numero;
    });

  return (
    <>
      <div className="ep-section">
        <div className="ep-label">Cômodo</div>
        <select className="ep-input" value={ptComodo} onChange={(e) => setPtComodo(e.target.value)}>
          {comodos.length === 0 && <option value="">(nenhum cômodo no croqui)</option>}
          {comodos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="ep-section">
        <div className="ep-label">{placeExisting ? 'Vai colocar um ponto existente' : 'Novo ponto'}</div>
        {!placeExisting && (
          <>
            <select className="ep-input" value={ptType} onChange={(e) => setPtType(e.target.value)}>
              {project.anomalyTypes.map((at) => (
                <option key={at.id} value={at.id}>
                  {at.prefix} — {at.nome}
                </option>
              ))}
            </select>
            <div className="ed-seg">
              {LOCALS.map((l) => (
                <button key={l} className={ptLocal === l ? 'active' : ''} onClick={() => setPtLocal(l)}>
                  <span className="dot" style={{ background: LOCAL_COLORS[l] }} />
                  {LOCAL_LABEL[l]}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="muted">Clique na foto para colocar. A lista fica aberta para colocar vários pontos rápido.</p>
      </div>

      {pontosDoComodo.length > 0 && (
        <div className="ep-section">
          <div className="ep-label">Reaproveitar um ponto do cômodo</div>
          <div className="ed-point-list">
            {pontosDoComodo.map((pt) => (
              <div
                key={pt.id}
                className={`ed-point-row${placeExisting === pt.id ? ' active' : ''}`}
                onClick={() => setPlaceExisting(placeExisting === pt.id ? null : pt.id)}
              >
                <span className="dot" style={{ background: LOCAL_COLORS[pt.local] }} />
                <span style={{ fontFamily: 'var(--mono)' }}>
                  {typeOf(pt.typeId)?.prefix}
                  {pt.numero}
                </span>
                <span style={{ flex: 1, opacity: 0.7, fontSize: 12 }}>{pt.descricao || pt.comodo || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AnnView({
  a,
  norm,
  selected,
  pointInfo,
  imgUrl,
  imgW,
  imgH,
}: {
  a: Annotation;
  norm: (b: { x: number; y: number; x2: number; y2: number }) => { x: number; y: number; w: number; h: number };
  selected: boolean;
  pointInfo: PointInfo;
  imgUrl?: string | null;
  imgW?: number;
  imgH?: number;
}) {
  const halo = selected ? <SelHalo a={a} norm={norm} /> : null;
  const dash = a.dashed ? `${a.strokeWidth * 2.5} ${a.strokeWidth * 2}` : undefined;
  if (a.kind === 'magnify') {
    const r = a.r ?? 60;
    const k = a.zoom ?? 2.5;
    const R = r * k;
    const lw = Math.max(1.5, a.strokeWidth);
    const dx = a.x2 - a.x;
    const dy = a.y2 - a.y;
    const d = Math.hypot(dx, dy) || 1;
    return (
      <g>
        {halo}
        <clipPath id={`mag-${a.id}`}>
          <circle cx={a.x2} cy={a.y2} r={R} />
        </clipPath>
        {imgUrl && (
          <g clipPath={`url(#mag-${a.id})`}>
            <image
              href={imgUrl}
              x={0}
              y={0}
              width={imgW}
              height={imgH}
              transform={`translate(${a.x2 - a.x * k} ${a.y2 - a.y * k}) scale(${k})`}
              preserveAspectRatio="none"
            />
          </g>
        )}
        {d > r + R && (
          <line
            x1={a.x + (dx / d) * r}
            y1={a.y + (dy / d) * r}
            x2={a.x2 - (dx / d) * R}
            y2={a.y2 - (dy / d) * R}
            stroke={a.color}
            strokeWidth={lw}
          />
        )}
        <circle cx={a.x} cy={a.y} r={r} fill="none" stroke={a.color} strokeWidth={lw} />
        <circle cx={a.x2} cy={a.y2} r={R} fill="none" stroke={a.color} strokeWidth={lw} />
      </g>
    );
  }
  if (a.kind === 'measure') {
    const ang = Math.atan2(a.y2 - a.y, a.x2 - a.x);
    const tick = Math.max(6, a.strokeWidth * 3);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const text = (a.text ?? '').trim();
    const fs = Math.max(12, a.strokeWidth * 3.2);
    let deg = (ang * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    const mx = (a.x + a.x2) / 2;
    const my = (a.y + a.y2) / 2;
    const tw = text.length * fs * 0.58;
    return (
      <g>
        {halo}
        <line x1={a.x} y1={a.y} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={a.strokeWidth} strokeDasharray={dash} />
        {[{ x: a.x, y: a.y }, { x: a.x2, y: a.y2 }].map((e, i) => (
          <line
            key={i}
            x1={e.x + nx * tick}
            y1={e.y + ny * tick}
            x2={e.x - nx * tick}
            y2={e.y - ny * tick}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
          />
        ))}
        {text && (
          <g transform={`translate(${mx} ${my}) rotate(${deg})`}>
            <rect
              x={-tw / 2 - fs * 0.25}
              y={-fs * 0.62 - fs * 0.75}
              width={tw + fs * 0.5}
              height={fs * 1.25}
              fill="rgba(255,255,255,0.92)"
            />
            <text x={0} y={-fs * 0.75} textAnchor="middle" dominantBaseline="middle" fontSize={fs} fontWeight={600} fill={a.color} fontFamily="sans-serif">
              {text}
            </text>
          </g>
        )}
      </g>
    );
  }
  if (a.kind === 'arrow' || a.kind === 'line') {
    return (
      <g>
        {halo}
        <line
          x1={a.x}
          y1={a.y}
          x2={a.x2}
          y2={a.y2}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dash}
          markerEnd={a.kind === 'arrow' ? 'url(#ah)' : undefined}
          markerStart={a.kind === 'arrow' && a.doubleHead ? 'url(#ah)' : undefined}
        />
      </g>
    );
  }
  if (a.kind === 'draw') {
    const pts = a.points ?? [];
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join(' ');
    return (
      <g>
        {halo}
        <path d={d} fill="none" stroke={a.color} strokeWidth={a.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    );
  }
  if (a.kind === 'rect') {
    const r = norm(a);
    return (
      <g>
        {halo}
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill={a.filled ? a.color : 'none'}
          fillOpacity={a.filled ? 0.25 : undefined}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          strokeDasharray={dash}
        />
      </g>
    );
  }
  if (a.kind === 'ellipse') {
    const r = norm(a);
    return (
      <g>
        {halo}
        <ellipse
          cx={r.x + r.w / 2}
          cy={r.y + r.h / 2}
          rx={r.w / 2}
          ry={r.h / 2}
          fill={a.filled ? a.color : 'none'}
          fillOpacity={a.filled ? 0.25 : undefined}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          strokeDasharray={dash}
        />
      </g>
    );
  }
  if (a.kind === 'highlight') {
    const r = norm(a);
    return (
      <g>
        {halo}
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={a.color} opacity={0.3} />
      </g>
    );
  }
  if (a.kind === 'point') {
    const info = a.pointId ? pointInfo[a.pointId] : undefined;
    const label = info?.label ?? '?';
    const fs = a.strokeWidth;
    const w = fs * 0.7 + label.length * fs * 0.62;
    const h = fs * 1.5;
    const color = info?.color ?? '#888';
    const hasLeader = a.lx != null && a.ly != null;
    const px = hasLeader ? a.lx! : a.x;
    const py = hasLeader ? a.ly! : a.y;
    return (
      <g>
        {halo}
        {hasLeader && (
          <>
            <line x1={a.x} y1={a.y} x2={px} y2={py} stroke={color} strokeWidth={Math.max(1.5, fs * 0.09)} />
            <circle cx={a.x} cy={a.y} r={Math.max(3, fs * 0.2)} fill={color} stroke="#fff" strokeWidth={Math.max(1, fs * 0.06)} />
          </>
        )}
        <rect x={px - w / 2} y={py - h / 2} width={w} height={h} rx={h / 2} fill={color} />
        <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fill="#fff" fontWeight={600} fontSize={fs} fontFamily="monospace">
          {label}
        </text>
      </g>
    );
  }
  if (a.kind === 'text') {
    const L = textLayout(a);
    return (
      <g>
        {halo}
        <rect x={L.x} y={L.y} width={L.w} height={L.h} rx={5} fill="rgba(255,255,255,0.92)" stroke={a.color} strokeWidth={Math.max(1.5, L.fs * 0.08)} />
        <text fill={a.color} fontSize={L.fs} fontFamily="sans-serif" fontWeight={500}>
          {L.lines.flatMap((line, i) => lineSegments(line, a.align ?? 'left', L).map((s, j) => (
            <tspan key={`${i}-${j}`} x={s.x} y={L.y + L.pad + L.fs * 0.82 + i * L.lineH} textAnchor={s.anchor}>
              {s.text || ' '}
            </tspan>
          )))}
        </text>
      </g>
    );
  }
  return null;
}

function SelHalo({
  a,
  norm,
}: {
  a: Annotation;
  norm: (b: { x: number; y: number; x2: number; y2: number }) => { x: number; y: number; w: number; h: number };
}) {
  if (a.kind === 'arrow' || a.kind === 'line' || a.kind === 'measure') return null;
  let r: { x: number; y: number; w: number; h: number };
  let pad: number;
  if (a.kind === 'magnify') {
    const R = (a.r ?? 60) * (a.zoom ?? 2.5);
    return (
      <circle
        cx={a.x2}
        cy={a.y2}
        r={R + 4}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (a.kind === 'text') {
    const L = textLayout(a);
    r = { x: L.x, y: L.y, w: L.w, h: L.h };
    pad = 0;
  } else if (a.kind === 'point') {
    const rad = 9 + a.strokeWidth;
    const cx = a.lx ?? a.x;
    const cy = a.ly ?? a.y;
    r = { x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 };
    pad = 0;
  } else if (a.kind === 'draw') {
    const pts = a.points ?? [];
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const minX = Math.min(...xs, a.x);
    const minY = Math.min(...ys, a.y);
    r = { x: minX, y: minY, w: Math.max(...xs, a.x) - minX, h: Math.max(...ys, a.y) - minY };
    pad = a.strokeWidth;
  } else {
    r = norm(a);
    pad = a.strokeWidth;
  }
  return (
    <rect
      x={r.x - pad}
      y={r.y - pad}
      width={r.w + pad * 2}
      height={r.h + pad * 2}
      fill="none"
      stroke="#2563eb"
      strokeWidth={1}
      strokeDasharray="4 3"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function distToSeg(p: { x: number; y: number }, a: { x: number; y: number; x2: number; y2: number }) {
  const dx = a.x2 - a.x;
  const dy = a.y2 - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
