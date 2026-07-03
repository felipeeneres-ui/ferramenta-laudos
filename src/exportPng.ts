import type { Floor, AnomalyType, Point } from './types';
import { LOCAL_COLORS } from './types';
import { wallVectors } from './geometry';

const INK = '#1f2329';
const SOFT = '#5b6470';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Constrói o SVG do croqui com cores fixas (sem variáveis de tema) e
// enquadramento automático no conteúdo.
export function buildSvg(
  floor: Floor,
  types: AnomalyType[],
  points: Point[],
  pointSize = 18,
  opts: { interactive?: boolean; bgDataUrl?: string } = {},
): { svg: string; w: number; h: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  const note = (x: number, y: number) => {
    xs.push(x);
    ys.push(y);
  };
  floor.walls.forEach((w) => {
    note(w.x1, w.y1);
    note(w.x2, w.y2);
  });
  points.forEach((p) => {
    note(p.x, p.y);
    if (p.lx != null && p.ly != null) note(p.lx, p.ly);
  });
  floor.rooms.forEach((r) => note(r.x, r.y));
  (floor.traces ?? []).forEach((tr) => tr.pts.forEach((q) => note(q.x, q.y)));
  (floor.labels ?? []).forEach((l) => note(l.x, l.y));
  const bg = floor.bg && opts.bgDataUrl ? floor.bg : null;
  if (bg) {
    note(bg.x, bg.y);
    note(bg.x + bg.w * bg.scale, bg.y + bg.h * bg.scale);
  }
  floor.openings.forEach((o) => {
    const w = floor.walls.find((x) => x.id === o.wallId);
    if (w) {
      const { normal } = wallVectors(w);
      note(w.x1 + normal.x * o.width, w.y1 + normal.y * o.width);
      note(w.x2 - normal.x * o.width, w.y2 - normal.y * o.width);
    }
  });

  if (xs.length === 0) {
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"></svg>', w: 200, h: 120 };
  }

  const pad = 40;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  const w = maxX - minX;
  const h = maxY - minY;

  const parts: string[] = [];
  parts.push(`<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>`);

  // imagem de fundo (satélite/planta)
  if (bg) {
    parts.push(
      `<image href="${opts.bgDataUrl}" x="${bg.x}" y="${bg.y}" width="${bg.w * bg.scale}" height="${bg.h * bg.scale}" opacity="${bg.opacity}" preserveAspectRatio="none"/>`,
    );
  }

  // traçados coloridos
  (floor.traces ?? []).forEach((tr) => {
    const pts = tr.pts.map((q) => `${q.x},${q.y}`).join(' ');
    const dash = tr.dashed ? ` stroke-dasharray="${tr.width * 2.2} ${tr.width * 1.6}"` : '';
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${tr.color}" stroke-width="${tr.width}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`,
    );
  });

  floor.walls.forEach((wl) => {
    const kind = wl.kind ?? 'wall';
    if (kind === 'wall') {
      parts.push(
        `<line x1="${wl.x1}" y1="${wl.y1}" x2="${wl.x2}" y2="${wl.y2}" stroke="${INK}" stroke-width="4" stroke-linecap="square"/>`,
      );
    } else {
      const dash = kind === 'projection' ? ' stroke-dasharray="7 6"' : '';
      parts.push(
        `<line x1="${wl.x1}" y1="${wl.y1}" x2="${wl.x2}" y2="${wl.y2}" stroke="${INK}" stroke-width="2" stroke-linecap="round"${dash}/>`,
      );
    }
  });

  floor.openings.forEach((o) => {
    const wl = floor.walls.find((x) => x.id === o.wallId);
    if (!wl) return;
    const { dir, len } = wallVectors(wl);
    const normal = { x: -dir.y, y: dir.x };
    const a = { x: wl.x1, y: wl.y1 };
    const center = { x: a.x + dir.x * o.t * len, y: a.y + dir.y * o.t * len };
    const half = o.width / 2;
    const p1 = { x: center.x - dir.x * half, y: center.y - dir.y * half };
    const p2 = { x: center.x + dir.x * half, y: center.y + dir.y * half };
    parts.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ffffff" stroke-width="7"/>`);
    if (o.kind === 'window') {
      const off = 3;
      parts.push(
        `<line x1="${p1.x + normal.x * off}" y1="${p1.y + normal.y * off}" x2="${p2.x + normal.x * off}" y2="${p2.y + normal.y * off}" stroke="${INK}" stroke-width="1.6"/>`,
        `<line x1="${p1.x - normal.x * off}" y1="${p1.y - normal.y * off}" x2="${p2.x - normal.x * off}" y2="${p2.y - normal.y * off}" stroke="${INK}" stroke-width="1.6"/>`,
      );
    } else if (o.kind === 'door') {
      const sign = o.flip ? -1 : 1;
      const hinge = o.flip ? p2 : p1;
      const jamb = o.flip ? p1 : p2;
      const leafEnd = { x: hinge.x + normal.x * o.width * sign, y: hinge.y + normal.y * o.width * sign };
      const sweep = sign > 0 ? 1 : 0;
      parts.push(
        `<line x1="${hinge.x}" y1="${hinge.y}" x2="${leafEnd.x}" y2="${leafEnd.y}" stroke="${SOFT}" stroke-width="1.4"/>`,
        `<path d="M${leafEnd.x} ${leafEnd.y} A${o.width} ${o.width} 0 0 ${sweep} ${jamb.x} ${jamb.y}" fill="none" stroke="${SOFT}" stroke-width="1.4"/>`,
      );
    } else {
      const depth = Math.min(40, len);
      const q1 = { x: p1.x + normal.x * depth, y: p1.y + normal.y * depth };
      const q2 = { x: p2.x + normal.x * depth, y: p2.y + normal.y * depth };
      parts.push(`<path d="M${p1.x} ${p1.y} L${q1.x} ${q1.y} L${q2.x} ${q2.y} L${p2.x} ${p2.y}" fill="none" stroke="${SOFT}" stroke-width="1.2"/>`);
      for (let i = 1; i < 6; i++) {
        const sa = { x: p1.x + (p2.x - p1.x) * (i / 6), y: p1.y + (p2.y - p1.y) * (i / 6) };
        const sb = { x: sa.x + normal.x * depth, y: sa.y + normal.y * depth };
        parts.push(`<line x1="${sa.x}" y1="${sa.y}" x2="${sb.x}" y2="${sb.y}" stroke="${SOFT}" stroke-width="1.2"/>`);
      }
    }
  });

  floor.rooms.forEach((r) => {
    parts.push(
      `<text x="${r.x}" y="${r.y}" text-anchor="middle" font-size="${r.fontSize ?? 13}" font-family="sans-serif" fill="${SOFT}">${esc(r.nome)}</text>`,
    );
  });

  // textos livres (com rotação)
  (floor.labels ?? []).forEach((l) => {
    const lines = (l.text || 'Texto').split('\n');
    const maxLen = Math.max(...lines.map((s) => s.length), 1);
    const lh = l.fontSize * 1.25;
    const bw = maxLen * l.fontSize * 0.62 + 10;
    const bh = lines.length * lh + 6;
    let inner = '';
    if (l.bg !== false)
      inner += `<rect x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" fill="#ffffff" stroke="${l.color}" stroke-width="1.2"/>`;
    const tspans = lines
      .map(
        (ln, i) =>
          `<tspan x="0" y="${(i - (lines.length - 1) / 2) * lh + l.fontSize * 0.35}">${esc(ln)}</tspan>`,
      )
      .join('');
    inner += `<text text-anchor="middle" font-size="${l.fontSize}" font-weight="600" font-family="sans-serif" fill="${l.color}">${tspans}</text>`;
    parts.push(`<g transform="translate(${l.x} ${l.y}) rotate(${l.rotation})">${inner}</g>`);
  });

  const sz = pointSize;
  const fs = sz * 0.56;
  points.forEach((p) => {
    const type = types.find((t) => t.id === p.typeId);
    const label = `${type?.prefix ?? '?'}${p.numero}`;
    const pw = sz * 0.72 + label.length * (sz * 0.28);
    const hasLeader = p.lx != null && p.ly != null;
    const px = hasLeader ? p.lx! : p.x;
    const py = hasLeader ? p.ly! : p.y;
    const leader = hasLeader
      ? `<line x1="${p.x}" y1="${p.y}" x2="${px}" y2="${py}" stroke="${LOCAL_COLORS[p.local]}" stroke-width="${Math.max(1.2, sz * 0.09)}"/>` +
        `<circle cx="${p.x}" cy="${p.y}" r="${Math.max(2.5, sz * 0.18)}" fill="${LOCAL_COLORS[p.local]}" stroke="#ffffff" stroke-width="${Math.max(0.8, sz * 0.05)}"/>`
      : '';
    const pill = `<rect x="${px - pw / 2}" y="${py - sz / 2}" width="${pw}" height="${sz}" rx="${sz / 2}" fill="${LOCAL_COLORS[p.local]}"/>`;
    const txt = `<text x="${px}" y="${py}" dominant-baseline="central" text-anchor="middle" font-size="${fs}" font-family="monospace" font-weight="500" fill="#ffffff">${esc(label)}</text>`;
    if (opts.interactive) {
      // grupo clicável com área de toque generosa (usado na visão do cliente)
      parts.push(
        `<g data-point="${esc(p.id)}" class="pt">` +
          leader +
          `<circle cx="${px}" cy="${py}" r="${(Math.max(pw, sz) / 2) * 1.25}" fill="#000" opacity="0"/>` +
          pill +
          txt +
          `</g>`,
      );
    } else {
      parts.push(leader + pill + txt);
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${minX} ${minY} ${w} ${h}">${parts.join('')}</svg>`;
  return { svg, w, h };
}

export function exportFloorPng(
  floor: Floor,
  types: AnomalyType[],
  points: Point[],
  filename: string,
  pointSize = 18,
  bgDataUrl?: string,
) {
  const { svg, w, h } = buildSvg(floor, types, points, pointSize, { bgDataUrl });
  const scale = 2;
  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => {
      if (!png) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };
  img.src = url;
}
