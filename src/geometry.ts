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
