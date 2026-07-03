import { useEffect, useRef, useState } from 'react';
import { IconPlus, IconMinus } from '@tabler/icons-react';
import { useStore } from '../store';
import { useBgUrl } from '../photoUrl';
import {
  GRID,
  snap,
  snapVec,
  dist,
  closestOnSegment,
  wallVectors,
  type Vec,
} from '../geometry';
import { LOCAL_COLORS, type FreeLabel, type OpeningKind, type Wall } from '../types';

// Caixa aproximada do texto livre (coords locais, centrada em 0,0) — usada
// no render, no hit-test e na exportação.
export function labelBox(l: FreeLabel): { w: number; h: number; lines: string[]; lh: number } {
  const lines = (l.text || 'Texto').split('\n');
  const maxLen = Math.max(...lines.map((s) => s.length), 1);
  const lh = l.fontSize * 1.25;
  return { w: maxLen * l.fontSize * 0.62 + 10, h: lines.length * lh + 6, lines, lh };
}

interface Ends {
  w: Wall;
  a: Vec;
  b: Vec;
  dir: Vec;
  len: number;
  center: Vec;
  p1: Vec;
  p2: Vec;
}

type Drag =
  | { type: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { type: 'point'; id: string }
  | { type: 'room'; id: string }
  | { type: 'opening-move'; id: string }
  | { type: 'opening-resize'; id: string }
  | { type: 'wall-end'; id: string; which: 1 | 2 }
  | { type: 'wall-move'; id: string; orig: Wall; start: Vec }
  | { type: 'trace-move'; id: string; start: Vec; orig: { x: number; y: number }[] }
  | { type: 'label-move'; id: string }
  | { type: 'point-label'; id: string } // move só o rótulo (linha de chamada)
  | { type: 'bg-move'; start: Vec; ox: number; oy: number }
  | null;

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag>(null);

  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const floor = useStore((s) => s.activeFloor());
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);

  const addWall = useStore((s) => s.addWall);
  const updateWall = useStore((s) => s.updateWall);
  const addOpening = useStore((s) => s.addOpening);
  const updateOpening = useStore((s) => s.updateOpening);
  const addRoom = useStore((s) => s.addRoom);
  const updateRoom = useStore((s) => s.updateRoom);
  const addPoint = useStore((s) => s.addPoint);
  const updatePoint = useStore((s) => s.updatePoint);
  const placingPointId = useStore((s) => s.placingPointId);
  const placePoint = useStore((s) => s.placePoint);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const addTrace = useStore((s) => s.addTrace);
  const updateTrace = useStore((s) => s.updateTrace);
  const addFreeLabel = useStore((s) => s.addFreeLabel);
  const updateFreeLabel = useStore((s) => s.updateFreeLabel);
  const updateFloorBg = useStore((s) => s.updateFloorBg);
  const traceStyle = useStore((s) => s.traceStyle);

  const traces = floor.traces ?? [];
  const labels = floor.labels ?? [];
  const bg = floor.bg ?? null;
  const bgUrl = useBgUrl(floor.id, bg?.rev ?? 0, !!bg);

  // snap condicional: respeita o toggle de snap à grade
  const gsnap = (v: number) => (snapEnabled ? snap(v) : Math.round(v));
  const gsnapVec = (p: Vec): Vec => (snapEnabled ? snapVec(p) : { x: Math.round(p.x), y: Math.round(p.y) });

  // pontos do projeto posicionados neste pavimento
  const points = project.points.filter((p) => p.floorId === floor.id);

  const [wallStart, setWallStart] = useState<Vec | null>(null);
  const [tracePts, setTracePts] = useState<Vec[]>([]);
  const [cursor, setCursor] = useState<Vec>({ x: 0, y: 0 });

  useEffect(() => {
    setWallStart(null);
    setTracePts([]);
  }, [tool, floor.id]);

  function toWorld(clientX: number, clientY: number): Vec {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }

  const pick = 8 / view.scale;

  function wallEnds(o: { wallId: string; t: number; width: number }): Ends | null {
    const w = floor.walls.find((x) => x.id === o.wallId);
    if (!w) return null;
    const a = { x: w.x1, y: w.y1 };
    const b = { x: w.x2, y: w.y2 };
    const { dir, len } = wallVectors(w);
    const center = { x: a.x + dir.x * o.t * len, y: a.y + dir.y * o.t * len };
    const half = o.width / 2;
    return {
      w,
      a,
      b,
      dir,
      len,
      center,
      p1: { x: center.x - dir.x * half, y: center.y - dir.y * half },
      p2: { x: center.x + dir.x * half, y: center.y + dir.y * half },
    };
  }

  function hitTest(p: Vec): Drag {
    // pontos (com linha de chamada: âncora move o local; rótulo move o balão)
    for (let i = points.length - 1; i >= 0; i--) {
      const pt = points[i];
      const hasLeader = pt.lx != null && pt.ly != null;
      if (hasLeader && dist(p, pt) < 9 / view.scale) {
        setSelection({ kind: 'point', id: pt.id });
        return { type: 'point', id: pt.id };
      }
      const labelPos = hasLeader ? { x: pt.lx!, y: pt.ly! } : pt;
      if (dist(p, labelPos) < 12 / view.scale) {
        setSelection({ kind: 'point', id: pt.id });
        return hasLeader ? { type: 'point-label', id: pt.id } : { type: 'point', id: pt.id };
      }
    }
    // textos livres (caixa rotacionada — testa no espaço local)
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i];
      const b = labelBox(l);
      const rad = (-l.rotation * Math.PI) / 180;
      const dx = p.x - l.x;
      const dy = p.y - l.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(lx) < b.w / 2 + pick && Math.abs(ly) < b.h / 2 + pick) {
        setSelection({ kind: 'flabel', id: l.id });
        return { type: 'label-move', id: l.id };
      }
    }
    // aberturas (alças de redimensionar e corpo p/ mover)
    for (let i = floor.openings.length - 1; i >= 0; i--) {
      const o = floor.openings[i];
      const g = wallEnds(o);
      if (!g) continue;
      if (dist(p, g.p1) < pick || dist(p, g.p2) < pick) {
        setSelection({ kind: 'opening', id: o.id });
        return { type: 'opening-resize', id: o.id };
      }
      if (closestOnSegment(p, g.p1, g.p2).distance < pick) {
        setSelection({ kind: 'opening', id: o.id });
        return { type: 'opening-move', id: o.id };
      }
    }
    // rótulos de cômodo
    for (let i = floor.rooms.length - 1; i >= 0; i--) {
      const r = floor.rooms[i];
      if (Math.abs(p.x - r.x) < 60 / view.scale && Math.abs(p.y - r.y) < 14 / view.scale) {
        setSelection({ kind: 'room', id: r.id });
        return { type: 'room', id: r.id };
      }
    }
    // paredes: pontas, depois corpo
    for (let i = floor.walls.length - 1; i >= 0; i--) {
      const w = floor.walls[i];
      if (dist(p, { x: w.x1, y: w.y1 }) < pick) {
        setSelection({ kind: 'wall', id: w.id });
        return { type: 'wall-end', id: w.id, which: 1 };
      }
      if (dist(p, { x: w.x2, y: w.y2 }) < pick) {
        setSelection({ kind: 'wall', id: w.id });
        return { type: 'wall-end', id: w.id, which: 2 };
      }
    }
    for (let i = floor.walls.length - 1; i >= 0; i--) {
      const w = floor.walls[i];
      if (closestOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }).distance < pick) {
        setSelection({ kind: 'wall', id: w.id });
        return { type: 'wall-move', id: w.id, orig: { ...w }, start: p };
      }
    }
    // traçados coloridos (corpo)
    for (let i = traces.length - 1; i >= 0; i--) {
      const tr = traces[i];
      const tol = tr.width / 2 + pick;
      for (let k = 1; k < tr.pts.length; k++) {
        if (closestOnSegment(p, tr.pts[k - 1], tr.pts[k]).distance < tol) {
          setSelection({ kind: 'trace', id: tr.id });
          return { type: 'trace-move', id: tr.id, start: p, orig: tr.pts.map((q) => ({ ...q })) };
        }
      }
    }
    // imagem de fundo (arrastar quando destravada)
    if (bg && !bg.locked) {
      const bw = bg.w * bg.scale;
      const bh = bg.h * bg.scale;
      if (p.x >= bg.x && p.x <= bg.x + bw && p.y >= bg.y && p.y <= bg.y + bh) {
        setSelection(null);
        return { type: 'bg-move', start: p, ox: bg.x, oy: bg.y };
      }
    }
    setSelection(null);
    return null;
  }

  function nearestWall(p: Vec) {
    let best: { id: string; t: number; d: number } | null = null;
    for (const w of floor.walls) {
      // aberturas só encaixam em paredes de verdade
      if ((w.kind ?? 'wall') !== 'wall') continue;
      const r = closestOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
      if (!best || r.distance < best.d) best = { id: w.id, t: r.t, d: r.distance };
    }
    return best;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    const p = toWorld(e.clientX, e.clientY);
    const isPan = tool === 'pan' || e.button === 1;
    svgRef.current?.setPointerCapture(e.pointerId);

    if (isPan) {
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
      return;
    }

    // posicionando um ponto criado numa foto ("a posicionar")
    if (placingPointId) {
      placePoint(placingPointId, Math.round(p.x), Math.round(p.y));
      return;
    }

    if (tool === 'wall' || tool === 'projection' || tool === 'limit') {
      const s = gsnapVec(p);
      if (!wallStart) {
        setWallStart(s);
      } else {
        if (dist(wallStart, s) > 1)
          addWall({ x1: wallStart.x, y1: wallStart.y, x2: s.x, y2: s.y, kind: tool });
        setWallStart(s);
      }
      return;
    }

    if (tool === 'door' || tool === 'window' || tool === 'stairs') {
      const nw = nearestWall(p);
      if (nw && nw.d < 18 / view.scale) addOpening(tool as OpeningKind, nw.id, nw.t);
      return;
    }

    if (tool === 'room') {
      const s = gsnapVec(p);
      addRoom(s.x, s.y, '');
      return;
    }

    if (tool === 'point') {
      addPoint(Math.round(p.x), Math.round(p.y));
      return;
    }

    if (tool === 'trace') {
      setTracePts((pts) => [...pts, { x: Math.round(p.x), y: Math.round(p.y) }]);
      return;
    }

    if (tool === 'flabel') {
      addFreeLabel(Math.round(p.x), Math.round(p.y));
      return;
    }

    // select
    dragRef.current = hitTest(p);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    const d = dragRef.current;
    if (!d) return;

    if (d.type === 'pan') {
      setView({ tx: d.tx + (e.clientX - d.sx), ty: d.ty + (e.clientY - d.sy) });
    } else if (d.type === 'point') {
      updatePoint(d.id, { x: Math.round(p.x), y: Math.round(p.y) });
    } else if (d.type === 'point-label') {
      updatePoint(d.id, { lx: Math.round(p.x), ly: Math.round(p.y) });
    } else if (d.type === 'room') {
      updateRoom(d.id, { x: gsnap(p.x), y: gsnap(p.y) });
    } else if (d.type === 'opening-move') {
      const o = floor.openings.find((x) => x.id === d.id);
      if (o) {
        const w = floor.walls.find((x) => x.id === o.wallId);
        if (w) {
          const r = closestOnSegment(p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
          updateOpening(d.id, { t: r.t });
        }
      }
    } else if (d.type === 'opening-resize') {
      const o = floor.openings.find((x) => x.id === d.id);
      const g = o && wallEnds(o);
      if (o && g) {
        const f = closestOnSegment(p, g.a, g.b).t;
        const width = Math.max(20, Math.min(g.len, Math.abs(f - o.t) * g.len * 2));
        updateOpening(d.id, { width: Math.round(width) });
      }
    } else if (d.type === 'wall-end') {
      const s = gsnapVec(p);
      updateWall(d.id, d.which === 1 ? { x1: s.x, y1: s.y } : { x2: s.x, y2: s.y });
    } else if (d.type === 'wall-move') {
      const dx = gsnap(p.x - d.start.x);
      const dy = gsnap(p.y - d.start.y);
      updateWall(d.id, {
        x1: d.orig.x1 + dx,
        y1: d.orig.y1 + dy,
        x2: d.orig.x2 + dx,
        y2: d.orig.y2 + dy,
      });
    } else if (d.type === 'trace-move') {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      updateTrace(d.id, { pts: d.orig.map((q) => ({ x: Math.round(q.x + dx), y: Math.round(q.y + dy) })) });
    } else if (d.type === 'label-move') {
      updateFreeLabel(d.id, { x: Math.round(p.x), y: Math.round(p.y) });
    } else if (d.type === 'bg-move') {
      updateFloorBg({ x: Math.round(d.ox + (p.x - d.start.x)), y: Math.round(d.oy + (p.y - d.start.y)) });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    svgRef.current?.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const scale = Math.max(0.2, Math.min(6, view.scale * factor));
    const k = scale / view.scale;
    setView({
      scale,
      tx: mx - (mx - view.tx) * k,
      ty: my - (my - view.ty) * k,
    });
  }

  function zoom(factor: number) {
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const scale = Math.max(0.2, Math.min(6, view.scale * factor));
    const k = scale / view.scale;
    setView({ scale, tx: mx - (mx - view.tx) * k, ty: my - (my - view.ty) * k });
  }

  const t = `translate(${view.tx} ${view.ty}) scale(${view.scale})`;
  const wallStroke = 4;
  const isLineTool = tool === 'wall' || tool === 'projection' || tool === 'limit';

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => {
          e.preventDefault();
          if (isLineTool) setWallStart(null);
          if (tool === 'trace') {
            if (tracePts.length >= 2) addTrace(tracePts);
            setTracePts([]);
          }
        }}
        style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair' }}
      >
        <defs>
          <pattern id="g-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path
              d={`M${GRID} 0 H0 V${GRID}`}
              fill="none"
              stroke="var(--grid)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
          <pattern id="g-major" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <path
              d={`M${GRID * 5} 0 H0 V${GRID * 5}`}
              fill="none"
              stroke="var(--grid-major)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
        </defs>

        <g transform={t}>
          <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#g-minor)" />
          <rect x={-4000} y={-4000} width={8000} height={8000} fill="url(#g-major)" />

          {/* imagem de fundo (satélite/planta) */}
          {bg && bgUrl && (
            <image
              href={bgUrl}
              x={bg.x}
              y={bg.y}
              width={bg.w * bg.scale}
              height={bg.h * bg.scale}
              opacity={bg.opacity}
              preserveAspectRatio="none"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* traçados coloridos */}
          {traces.map((tr) => {
            const sel = selection?.kind === 'trace' && selection.id === tr.id;
            const ptsStr = tr.pts.map((q) => `${q.x},${q.y}`).join(' ');
            return (
              <g key={tr.id}>
                {sel && (
                  <polyline
                    points={ptsStr}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth={tr.width + 6 / view.scale}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.35}
                  />
                )}
                <polyline
                  points={ptsStr}
                  fill="none"
                  stroke={tr.color}
                  strokeWidth={tr.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={tr.dashed ? `${tr.width * 2.2} ${tr.width * 1.6}` : undefined}
                />
              </g>
            );
          })}

          {/* preview do traçado em criação */}
          {tool === 'trace' && tracePts.length > 0 && (
            <polyline
              points={[...tracePts, cursor].map((q) => `${q.x},${q.y}`).join(' ')}
              fill="none"
              stroke={traceStyle.color}
              strokeWidth={traceStyle.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.6}
              strokeDasharray={traceStyle.dashed ? `${traceStyle.width * 2.2} ${traceStyle.width * 1.6}` : '6 5'}
            />
          )}

          {/* paredes / projeções / limites */}
          {floor.walls.map((w) => {
            const kind = w.kind ?? 'wall';
            const isWall = kind === 'wall';
            return (
              <line
                key={w.id}
                x1={w.x1}
                y1={w.y1}
                x2={w.x2}
                y2={w.y2}
                stroke="var(--ink)"
                strokeWidth={isWall ? wallStroke : 2}
                strokeLinecap={isWall ? 'square' : 'round'}
                strokeDasharray={kind === 'projection' ? '7 6' : undefined}
              />
            );
          })}

          {/* aberturas */}
          {floor.openings.map((o) => (
            <OpeningGlyph key={o.id} o={o} ends={wallEnds(o)} selected={selection?.kind === 'opening' && selection.id === o.id} />
          ))}

          {/* preview de linha */}
          {isLineTool && wallStart && (
            <line
              x1={wallStart.x}
              y1={wallStart.y}
              x2={gsnap(cursor.x)}
              y2={gsnap(cursor.y)}
              stroke="var(--accent)"
              strokeWidth={tool === 'wall' ? wallStroke : 2}
              strokeLinecap={tool === 'wall' ? 'square' : 'round'}
              strokeDasharray="6 5"
            />
          )}

          {/* seleção de parede: pontas */}
          {selection?.kind === 'wall' &&
            (() => {
              const w = floor.walls.find((x) => x.id === selection.id);
              if (!w) return null;
              return (
                <g>
                  <Handle x={w.x1} y={w.y1} scale={view.scale} />
                  <Handle x={w.x2} y={w.y2} scale={view.scale} />
                </g>
              );
            })()}

          {/* rótulos de cômodo */}
          {floor.rooms.map((r) => (
            <text
              key={r.id}
              x={r.x}
              y={r.y}
              textAnchor="middle"
              fontSize={r.fontSize ?? 13}
              fontFamily="var(--font)"
              fill={selection?.kind === 'room' && selection.id === r.id ? 'var(--accent)' : 'var(--ink-soft)'}
              style={{ userSelect: 'none' }}
            >
              {r.nome || 'cômodo…'}
            </text>
          ))}

          {/* textos livres (com rotação) */}
          {labels.map((l) => {
            const sel = selection?.kind === 'flabel' && selection.id === l.id;
            const b = labelBox(l);
            return (
              <g key={l.id} transform={`translate(${l.x} ${l.y}) rotate(${l.rotation})`} style={{ userSelect: 'none' }}>
                {l.bg && (
                  <rect
                    x={-b.w / 2}
                    y={-b.h / 2}
                    width={b.w}
                    height={b.h}
                    fill="#ffffff"
                    stroke={l.color}
                    strokeWidth={1.2}
                  />
                )}
                {sel && (
                  <rect
                    x={-b.w / 2 - 3}
                    y={-b.h / 2 - 3}
                    width={b.w + 6}
                    height={b.h + 6}
                    fill="none"
                    stroke="var(--accent)"
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <text textAnchor="middle" fontSize={l.fontSize} fontWeight={600} fill={l.color} fontFamily="var(--font)">
                  {b.lines.map((ln, i) => (
                    <tspan key={i} x={0} y={(i - (b.lines.length - 1) / 2) * b.lh + l.fontSize * 0.35}>
                      {ln}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

          {/* pontos */}
          {points.map((pt) => {
            const type = project.anomalyTypes.find((x) => x.id === pt.typeId);
            const label = `${type?.prefix ?? '?'}${pt.numero}`;
            const sel = selection?.kind === 'point' && selection.id === pt.id;
            const sz = project.croquiPointSize ?? 18;
            const fs = sz * 0.56;
            const w = sz * 0.72 + label.length * (sz * 0.28);
            const hasLeader = pt.lx != null && pt.ly != null;
            const px = hasLeader ? pt.lx! : pt.x;
            const py = hasLeader ? pt.ly! : pt.y;
            return (
              <g key={pt.id} style={{ userSelect: 'none' }}>
                {hasLeader && (
                  <>
                    <line
                      x1={pt.x}
                      y1={pt.y}
                      x2={px}
                      y2={py}
                      stroke={LOCAL_COLORS[pt.local]}
                      strokeWidth={Math.max(1.2, sz * 0.09)}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={Math.max(2.5, sz * 0.18)}
                      fill={LOCAL_COLORS[pt.local]}
                      stroke="#fff"
                      strokeWidth={Math.max(0.8, sz * 0.05)}
                    />
                  </>
                )}
                {sel && (
                  <rect
                    x={px - w / 2 - 3}
                    y={py - sz / 2 - 3}
                    width={w + 6}
                    height={sz + 6}
                    rx={(sz + 6) / 2}
                    fill="none"
                    stroke="var(--accent)"
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <rect
                  x={px - w / 2}
                  y={py - sz / 2}
                  width={w}
                  height={sz}
                  rx={sz / 2}
                  fill={LOCAL_COLORS[pt.local]}
                />
                <text x={px} y={py} dominantBaseline="central" textAnchor="middle" fontSize={fs} fontFamily="var(--mono)" fontWeight={500} fill="#fff">
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {isLineTool && (
        <div className="hint-bar">
          {wallStart
            ? 'Clique para fixar o próximo ponto · botão direito encerra'
            : `Clique para iniciar ${tool === 'wall' ? 'a parede' : tool === 'projection' ? 'a projeção' : 'o limite'}`}
        </div>
      )}
      {(tool === 'door' || tool === 'window' || tool === 'stairs') && (
        <div className="hint-bar">Clique sobre uma parede para inserir</div>
      )}
      {tool === 'trace' && (
        <div className="hint-bar">
          {tracePts.length
            ? 'Clique para fixar o próximo ponto · botão direito encerra o traçado'
            : 'Traçado colorido: clique para iniciar (ajuste cor/espessura no painel à direita)'}
        </div>
      )}
      {tool === 'flabel' && <div className="hint-bar">Clique para colocar o texto</div>}
      {placingPointId && (
        <div className="hint-bar">Clique no croqui para posicionar o ponto</div>
      )}

      <div className="zoom-ctl">
        <button onClick={() => zoom(1 / 1.2)} aria-label="Reduzir zoom">
          <IconMinus size={15} />
        </button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button onClick={() => zoom(1.2)} aria-label="Aumentar zoom">
          <IconPlus size={15} />
        </button>
      </div>
    </div>
  );
}

function Handle({ x, y, scale }: { x: number; y: number; scale: number }) {
  const s = 7 / scale;
  return (
    <rect
      x={x - s / 2}
      y={y - s / 2}
      width={s}
      height={s}
      fill="#fff"
      stroke="var(--accent)"
      strokeWidth={1.5 / scale}
    />
  );
}

function OpeningGlyph({
  o,
  ends,
  selected,
}: {
  o: { id: string; kind: OpeningKind; width: number; flip: boolean };
  ends: Ends | null;
  selected: boolean;
}) {
  if (!ends) return null;
  const { dir, p1, p2, center, len } = ends;
  const normal = { x: -dir.y, y: dir.x };
  const accent = selected ? 'var(--accent)' : 'var(--ink-soft)';

  let glyph = null;
  if (o.kind === 'window') {
    const off = 3;
    glyph = (
      <g stroke="var(--ink)" strokeWidth={1.6} fill="none">
        <line x1={p1.x + normal.x * off} y1={p1.y + normal.y * off} x2={p2.x + normal.x * off} y2={p2.y + normal.y * off} />
        <line x1={p1.x - normal.x * off} y1={p1.y - normal.y * off} x2={p2.x - normal.x * off} y2={p2.y - normal.y * off} />
      </g>
    );
  } else if (o.kind === 'door') {
    const dirSign = o.flip ? -1 : 1;
    const hinge = o.flip ? p2 : p1;
    const jamb = o.flip ? p1 : p2;
    const leafEnd = { x: hinge.x + normal.x * o.width * dirSign, y: hinge.y + normal.y * o.width * dirSign };
    const sweep = dirSign > 0 ? 1 : 0;
    glyph = (
      <g stroke="var(--ink-soft)" strokeWidth={1.4} fill="none">
        <line x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} />
        <path d={`M${leafEnd.x} ${leafEnd.y} A${o.width} ${o.width} 0 0 ${sweep} ${jamb.x} ${jamb.y}`} />
      </g>
    );
  } else {
    const depth = Math.min(40, len);
    const q1 = { x: p1.x + normal.x * depth, y: p1.y + normal.y * depth };
    const q2 = { x: p2.x + normal.x * depth, y: p2.y + normal.y * depth };
    const steps = [];
    for (let i = 1; i < 6; i++) {
      const a = { x: p1.x + (p2.x - p1.x) * (i / 6), y: p1.y + (p2.y - p1.y) * (i / 6) };
      const b = { x: a.x + normal.x * depth, y: a.y + normal.y * depth };
      steps.push(<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
    }
    glyph = (
      <g stroke="var(--ink-soft)" strokeWidth={1.2} fill="none">
        <path d={`M${p1.x} ${p1.y} L${q1.x} ${q1.y} L${q2.x} ${q2.y} L${p2.x} ${p2.y}`} />
        {steps}
      </g>
    );
  }

  return (
    <g>
      {/* "apaga" o trecho da parede sob a abertura */}
      <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--paper)" strokeWidth={7} strokeLinecap="butt" />
      {glyph}
      {selected && (
        <g>
          <rect x={p1.x - 4} y={p1.y - 4} width={8} height={8} fill="#fff" stroke={accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <rect x={p2.x - 4} y={p2.y - 4} width={8} height={8} fill="#fff" stroke={accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <circle cx={center.x} cy={center.y} r={2.5} fill={accent} />
        </g>
      )}
    </g>
  );
}
