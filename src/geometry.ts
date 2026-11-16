// Utilitários de geometria 2D para o editor de croqui.

export const GRID = 20; // tamanho da quadrícula em unidades de mundo

export interface Vec {
  x: number;
  y: number;
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid;
}

export function snapVec(p: Vec, grid = GRID): Vec {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function wallLength(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

// Ponto mais próximo num segmento; devolve o ponto, o parâmetro t (0..1) e a distância.
export function closestOnSegment(
  p: Vec,
  a: Vec,
  b: Vec,
): { point: Vec; t: number; distance: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + abx * t, y: a.y + aby * t };
  return { point, t, distance: dist(p, point) };
}

// Largura do pino (pílula) de um ponto de anomalia, para um rótulo e tamanho dados.
export function pillWidth(label: string, sz: number): number {
  return sz * 0.72 + label.length * (sz * 0.28);
}

interface LabelBox {
  id: string;
  ax: number; // âncora (local da anomalia)
  ay: number;
  lx: number; // centro do rótulo
  ly: number;
  w: number;
}

// Afasta os rótulos que estão uns sobre os outros (ou sobre o local de outro
// ponto), com o menor deslocamento possível. Devolve a nova posição só dos
// rótulos que saíram do lugar; esses passam a ter linha de chamada.
export function spreadLabels(
  items: { id: string; x: number; y: number; lx?: number; ly?: number; w: number }[],
  sz: number,
): Map<string, Vec> {
  const boxes: LabelBox[] = items.map((it) => ({
    id: it.id,
    ax: it.x,
    ay: it.y,
    lx: it.lx ?? it.x,
    ly: it.ly ?? it.y,
    w: it.w,
  }));
  const start = boxes.map((b) => ({ x: b.lx, y: b.ly }));
  const gap = sz * 0.3;
  const dot = sz * 0.35;

  for (let iter = 0; iter < 400; iter++) {
    let moved = false;
    // rótulo x rótulo
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = a.lx - b.lx;
        const dy = a.ly - b.ly;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oy = sz + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox) {
          const s = dy === 0 ? -1 : Math.sign(dy);
          a.ly += (s * oy) / 2;
          b.ly -= (s * oy) / 2;
        } else {
          const s = dx === 0 ? -1 : Math.sign(dx);
          a.lx += (s * ox) / 2;
          b.lx -= (s * ox) / 2;
        }
      }
    }
    // rótulo x local de outro ponto (e o próprio local, se o rótulo já saiu dele)
    for (const a of boxes) {
      for (const b of boxes) {
        const own = a === b;
        if (own && Math.hypot(a.lx - a.ax, a.ly - a.ay) < 0.5) continue;
        const dx = a.lx - b.ax;
        const dy = a.ly - b.ay;
        const ox = a.w / 2 + dot - Math.abs(dx);
        const oy = sz / 2 + dot - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy <= ox) a.ly += (dy < 0 ? -1 : 1) * oy;
        else a.lx += (dx < 0 ? -1 : 1) * ox;
      }
    }
    if (!moved) break;
  }

  const out = new Map<string, Vec>();
  boxes.forEach((b, i) => {
    if (Math.hypot(b.lx - start[i].x, b.ly - start[i].y) > 0.5)
      out.set(b.id, { x: Math.round(b.lx), y: Math.round(b.ly) });
  });
  return out;
}

// Vetor unitário e normal de uma parede.
export function wallVectors(w: { x1: number; y1: number; x2: number; y2: number }) {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    len,
    dir: { x: dx / len, y: dy / len },
    normal: { x: -dy / len, y: dx / len },
  };
}
