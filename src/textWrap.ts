// Quebra de linha, medição e alinhamento de texto (compartilhado entre editor e exportação).
import type { TextAlign } from './types';

let _ctx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
  return _ctx!;
}

export interface WrappedLine {
  text: string;
  lastOfPara: boolean; // última linha do parágrafo (não justifica)
}

// Quebra o texto em linhas que cabem em maxWidth (respeita \n digitados).
export function wrapLines(text: string, fs: number, maxWidth: number): WrappedLine[] {
  const c = ctx();
  c.font = `500 ${fs}px sans-serif`;
  const out: WrappedLine[] = [];
  for (const para of (text ?? '').split('\n')) {
    if (para === '') {
      out.push({ text: '', lastOfPara: true });
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    const paraLines: string[] = [];
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (!line || c.measureText(test).width <= maxWidth) line = test;
      else {
        paraLines.push(line);
        line = w;
      }
    }
    paraLines.push(line);
    paraLines.forEach((l, i) => out.push({ text: l, lastOfPara: i === paraLines.length - 1 }));
  }
  return out.length ? out : [{ text: '', lastOfPara: true }];
}

export interface TextLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: WrappedLine[];
  fs: number;
  pad: number;
  lineH: number;
}

// Geometria da caixa de texto: largura = |x2 - x| (controlada pelo usuário),
// altura cresce conforme as linhas quebradas.
export function textLayout(a: {
  x: number;
  y: number;
  x2: number;
  text?: string;
  strokeWidth: number;
}): TextLayout {
  const fs = a.strokeWidth;
  const pad = Math.max(2, fs * 0.3);
  const left = Math.min(a.x, a.x2);
  const w = Math.max(fs * 2.5, Math.abs(a.x2 - a.x));
  const lineH = fs * 1.28;
  const lines = wrapLines(a.text || 'Texto', fs, w - pad * 2);
  const h = lines.length * lineH + pad * 2;
  return { x: left, y: a.y, w, h, lines, fs, pad, lineH };
}

export interface Seg {
  text: string;
  x: number;
  anchor: 'start' | 'middle' | 'end';
}

// Posiciona uma linha conforme o alinhamento (justificado distribui os espaços).
export function lineSegments(
  line: WrappedLine,
  align: TextAlign,
  L: TextLayout,
): Seg[] {
  const innerL = L.x + L.pad;
  const innerW = L.w - L.pad * 2;
  if (align === 'center') return [{ text: line.text, x: L.x + L.w / 2, anchor: 'middle' }];
  if (align === 'right') return [{ text: line.text, x: L.x + L.w - L.pad, anchor: 'end' }];
  if (align === 'justify' && !line.lastOfPara && line.text.trim()) {
    const words = line.text.split(' ');
    if (words.length === 1) return [{ text: line.text, x: innerL, anchor: 'start' }];
    const c = ctx();
    c.font = `500 ${L.fs}px sans-serif`;
    const wordsW = words.reduce((s, w) => s + c.measureText(w).width, 0);
    const gap = (innerW - wordsW) / (words.length - 1);
    const segs: Seg[] = [];
    let x = innerL;
    for (const w of words) {
      segs.push({ text: w, x, anchor: 'start' });
      x += c.measureText(w).width + gap;
    }
    return segs;
  }
  return [{ text: line.text, x: innerL, anchor: 'start' }];
}
