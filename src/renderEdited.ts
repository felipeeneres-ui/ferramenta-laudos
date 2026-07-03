import type { Annotation, AnnotationKind, Photo } from './types';
import { getOriginal } from './db';
import { textLayout, lineSegments } from './textWrap';

// Ordem de camadas fixa: blur (fundo) → realce → formas/seta → texto → pontos (topo).
const Z: Record<AnnotationKind, number> = {
  blur: 0,
  highlight: 1,
  rect: 2,
  ellipse: 2,
  arrow: 2,
  line: 2,
  draw: 2,
  magnify: 2,
  measure: 2,
  text: 3,
  point: 4,
};
export function sortByZ(anns: Annotation[]): Annotation[] {
  return anns
    .map((a, i) => ({ a, i }))
    .sort((p, q) => Z[p.a.kind] - Z[q.a.kind] || p.i - q.i)
    .map((x) => x.a);
}

// rótulo + cor de cada ponto do projeto, para desenhar os marcadores
export type PointInfo = Record<string, { label: string; color: string }>;

function norm(a: Annotation) {
  return {
    x: Math.min(a.x, a.x2),
    y: Math.min(a.y, a.y2),
    w: Math.abs(a.x2 - a.x),
    h: Math.abs(a.y2 - a.y),
  };
}

// Desenha uma anotação no contexto 2D (coordenadas em pixels da imagem cheia).
export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, pointInfo: PointInfo = {}) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (a.dashed) ctx.setLineDash([a.strokeWidth * 2.5, a.strokeWidth * 2]);

  if (a.kind === 'arrow' || a.kind === 'line') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
    if (a.kind === 'arrow') {
      ctx.setLineDash([]);
      const head = 10 + a.strokeWidth * 2.2;
      const drawHead = (hx: number, hy: number, fx: number, fy: number) => {
        const ang = Math.atan2(hy - fy, hx - fx);
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - head * Math.cos(ang - 0.42), hy - head * Math.sin(ang - 0.42));
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - head * Math.cos(ang + 0.42), hy - head * Math.sin(ang + 0.42));
        ctx.stroke();
      };
      drawHead(a.x2, a.y2, a.x, a.y);
      if (a.doubleHead) drawHead(a.x, a.y, a.x2, a.y2);
    }
  } else if (a.kind === 'draw') {
    const pts = a.points ?? [];
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  } else if (a.kind === 'measure') {
    // cota: linha + travessões perpendiculares + texto rotacionado no meio
    const ang = Math.atan2(a.y2 - a.y, a.x2 - a.x);
    const tick = Math.max(6, a.strokeWidth * 3);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const e of [{ x: a.x, y: a.y }, { x: a.x2, y: a.y2 }]) {
      ctx.beginPath();
      ctx.moveTo(e.x + nx * tick, e.y + ny * tick);
      ctx.lineTo(e.x - nx * tick, e.y - ny * tick);
      ctx.stroke();
    }
    const text = (a.text ?? '').trim();
    if (text) {
      const fs = Math.max(12, a.strokeWidth * 3.2);
      let rot = ang;
      if (rot > Math.PI / 2) rot -= Math.PI;
      if (rot < -Math.PI / 2) rot += Math.PI;
      ctx.save();
      ctx.translate((a.x + a.x2) / 2, (a.y + a.y2) / 2);
      ctx.rotate(rot);
      ctx.font = `600 ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tw = ctx.measureText(text).width;
      const pad = fs * 0.25;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(-tw / 2 - pad, -fs * 0.62 - fs * 0.75, tw + pad * 2, fs * 1.25);
      ctx.fillStyle = a.color;
      ctx.fillText(text, 0, -fs * 0.75);
      ctx.restore();
    }
  } else if (a.kind === 'rect') {
    const r = norm(a);
    if (a.filled) {
      ctx.globalAlpha = 0.25;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (a.kind === 'ellipse') {
    const r = norm(a);
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (a.filled) {
      ctx.globalAlpha = 0.25;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.stroke();
  } else if (a.kind === 'highlight') {
    const r = norm(a);
    ctx.globalAlpha = 0.3;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  } else if (a.kind === 'point') {
    const info = a.pointId ? pointInfo[a.pointId] : undefined;
    const label = info?.label ?? '?';
    const fs = a.strokeWidth;
    const w = fs * 0.7 + label.length * fs * 0.62;
    const h = fs * 1.5;
    const color = info?.color ?? '#888';
    const hasLeader = a.lx != null && a.ly != null;
    const px = hasLeader ? a.lx! : a.x;
    const py = hasLeader ? a.ly! : a.y;
    ctx.setLineDash([]);
    if (hasLeader) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, fs * 0.09);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(3, fs * 0.2), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, fs * 0.06);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    roundRect(ctx, px - w / 2, py - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${fs}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px, py + 1);
  } else if (a.kind === 'text') {
    const L = textLayout(a);
    ctx.font = `500 ${L.fs}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, L.x, L.y, L.w, L.h, 5);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, L.fs * 0.08);
    ctx.strokeStyle = a.color;
    roundRect(ctx, L.x, L.y, L.w, L.h, 5);
    ctx.stroke();
    ctx.fillStyle = a.color;
    const align = a.align ?? 'left';
    L.lines.forEach((line, i) => {
      const yy = L.y + L.pad + L.fs * 0.82 + i * L.lineH;
      for (const s of lineSegments(line, align, L)) {
        ctx.textAlign = s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left';
        ctx.fillText(s.text, s.x, yy);
      }
    });
  }
  ctx.restore();
}

// Lente de detalhe: círculo na anomalia + círculo ampliado (inset) ligado por linha.
function drawMagnify(
  ctx: CanvasRenderingContext2D,
  a: Annotation,
  img: HTMLCanvasElement | ImageBitmap,
  filter: string,
) {
  const r = a.r ?? 60;
  const k = a.zoom ?? 2.5;
  const R = r * k;
  // imagem ampliada recortada no círculo do inset (fonte (x,y) mapeia para (x2,y2))
  ctx.save();
  ctx.beginPath();
  ctx.arc(a.x2, a.y2, R, 0, Math.PI * 2);
  ctx.clip();
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, a.x2 - a.x * k, a.y2 - a.y * k, img.width * k, img.height * k);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.lineWidth = Math.max(1.5, a.strokeWidth);
  ctx.setLineDash([]);
  const dx = a.x2 - a.x;
  const dy = a.y2 - a.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d > r + R) {
    ctx.beginPath();
    ctx.moveTo(a.x + (dx / d) * r, a.y + (dy / d) * r);
    ctx.lineTo(a.x2 - (dx / d) * R, a.y2 - (dy / d) * R);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(a.x2, a.y2, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// "Assa" a base: aplica rotação 90° e endireitamento fino num canvas nas
// dimensões finais (outW×outH). Usada no export e no preview do editor.
export function bakeSourceCanvas(
  img: ImageBitmap,
  rotate: number,
  straighten: number,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  // 1) rotação 90/180/270
  const rot = document.createElement('canvas');
  rot.width = outW;
  rot.height = outH;
  const rctx = rot.getContext('2d')!;
  rctx.save();
  if (rotate === 90) {
    rctx.translate(outW, 0);
    rctx.rotate(Math.PI / 2);
  } else if (rotate === 180) {
    rctx.translate(outW, outH);
    rctx.rotate(Math.PI);
  } else if (rotate === 270) {
    rctx.translate(0, outH);
    rctx.rotate(-Math.PI / 2);
  }
  rctx.drawImage(img, 0, 0);
  rctx.restore();
  if (!straighten) return rot;

  // 2) endireitar: gira em torno do centro com escala de cobertura (sem bordas vazias)
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d')!;
  const rad = (straighten * Math.PI) / 180;
  const ratio = Math.max(outW, outH) / Math.min(outW, outH);
  const s = Math.cos(Math.abs(rad)) + Math.sin(Math.abs(rad)) * ratio;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.scale(s, s);
  ctx.translate(-outW / 2, -outH / 2);
  ctx.drawImage(rot, 0, 0);
  return out;
}

// Monta o canvas editado: imagem (recortada) + blur + anotações + borda.
async function buildEditedCanvas(
  photo: Photo,
  annotations: Annotation[],
  pointInfo: PointInfo,
): Promise<HTMLCanvasElement> {
  const blob = await getOriginal(photo.id);
  if (!blob) throw new Error('Imagem original indisponível');
  const bmp = await createImageBitmap(blob);
  const rotate = photo.rotate ?? 0;
  const straighten = photo.straighten ?? 0;
  // base nas dimensões finais (photo.width/height já refletem a rotação)
  const img: HTMLCanvasElement | ImageBitmap =
    rotate || straighten ? bakeSourceCanvas(bmp, rotate, straighten, photo.width, photo.height) : bmp;

  const crop = photo.crop;
  const cx = crop ? crop.x : 0;
  const cy = crop ? crop.y : 0;
  const cw = crop ? crop.w : img.width;
  const ch = crop ? crop.h : img.height;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  const ctx = canvas.getContext('2d')!;

  // brilho/contraste (100 = neutro)
  const adj = photo.adjust;
  const adjFilter =
    adj && (adj.brightness !== 100 || adj.contrast !== 100)
      ? `brightness(${adj.brightness}%) contrast(${adj.contrast}%)`
      : '';

  ctx.filter = adjFilter || 'none';
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  ctx.filter = 'none';
  ctx.translate(-cx, -cy);

  for (const a of annotations.filter((x) => x.kind === 'blur')) {
    const r = norm(a);
    if (r.w < 2 || r.h < 2) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.filter = `blur(${Math.max(4, a.strokeWidth * 2)}px) ${adjFilter}`.trim();
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  for (const a of sortByZ(annotations.filter((x) => x.kind !== 'blur'))) {
    if (a.kind === 'magnify') drawMagnify(ctx, a, img, adjFilter);
    else drawAnnotation(ctx, a, pointInfo);
  }

  if (photo.border !== false) {
    const bw = borderWidth(canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = bw;
    ctx.strokeRect(bw / 2, bw / 2, canvas.width - bw, canvas.height - bw);
  }
  return canvas;
}

// Gera o PNG editado em resolução cheia (para salvar a cópia _edit.png).
export async function renderEditedBlob(
  photo: Photo,
  annotations: Annotation[],
  pointInfo: PointInfo = {},
): Promise<Blob> {
  const canvas = await buildEditedCanvas(photo, annotations, pointInfo);
  return new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
}

// Gera a imagem editada reduzida como data URL (JPEG) — para colar no Word/clipboard.
export async function renderEditedDataUrl(
  photo: Photo,
  annotations: Annotation[],
  pointInfo: PointInfo = {},
  maxSide = 1500,
): Promise<{ url: string; w: number; h: number }> {
  const full = await buildEditedCanvas(photo, annotations, pointInfo);
  const scale = Math.min(1, maxSide / Math.max(full.width, full.height));
  const w = Math.round(full.width * scale);
  const h = Math.round(full.height * scale);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(full, 0, 0, w, h);
  return { url: out.toDataURL('image/jpeg', 0.92), w, h };
}

// Espessura da borda proporcional ao tamanho da imagem (≈1pt quando no Word).
export function borderWidth(w: number, h: number): number {
  return Math.max(2, Math.round(Math.max(w, h) * 0.0025));
}
