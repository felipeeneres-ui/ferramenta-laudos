import { jsPDF } from 'jspdf';
import { applyPlugin, type UserOptions } from 'jspdf-autotable';
import { buildSvg } from './exportPng';

// Aplica o plugin ao jsPDF (interop estável no Vite: usa-se doc.autoTable(...)).
applyPlugin(jsPDF);
type AutoTableDoc = jsPDF & {
  autoTable: (opts: UserOptions) => void;
  lastAutoTable: { finalY: number };
};
import { renderEditedDataUrl, type PointInfo } from './renderEdited';
import { getBg, blobToDataUrl } from './db';
import { LOCAL_COLORS, type Project, type Point } from './types';

// Renderiza o croqui de um pavimento (SVG) para PNG (data URL).
async function floorPng(
  project: Project,
  floor: Project['floors'][number],
  scale = 2,
): Promise<{ url: string; w: number; h: number }> {
  const pts = project.points.filter((p) => p.floorId === floor.id);
  let bgDataUrl: string | undefined;
  if (floor.bg) {
    const blob = await getBg(floor.id);
    if (blob) bgDataUrl = await blobToDataUrl(blob);
  }
  const { svg, w, h } = buildSvg(floor, project.anomalyTypes, pts, project.croquiPointSize ?? 18, {
    bgDataUrl,
  });
  return new Promise((res, rej) => {
    const img = new Image();
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res({ url: c.toDataURL('image/png'), w: c.width, h: c.height });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('Falha ao renderizar o croqui'));
    };
    img.src = url;
  });
}

// Monta o PDF completo do laudo: croqui → tabelas → fotos.
export async function buildLaudoPdf(project: Project): Promise<{ blob: Blob; falhas: number }> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 15;
  const cw = pageW - 2 * M;
  let y = M;

  const ensure = (space: number) => {
    if (y + space > pageH - M) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (text: string) => {
    ensure(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 30, 60);
    doc.text(text, M, y + 6);
    doc.setDrawColor(15, 30, 60);
    doc.setLineWidth(0.4);
    doc.line(M, y + 8.5, pageW - M, y + 8.5);
    y += 14;
    doc.setTextColor(20, 20, 20);
    doc.setFont('helvetica', 'normal');
  };

  // título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(15, 30, 60);
  doc.text(project.nome || 'Laudo', M, y + 7);
  y += 16;
  doc.setTextColor(20, 20, 20);

  // ---------- 1. Croqui ----------
  heading('1. Croqui');
  const floors = project.floors.filter((f) => f.walls.length > 0 || project.points.some((p) => p.floorId === f.id));
  if (floors.length === 0) {
    doc.setFontSize(10);
    doc.text('Sem croqui.', M, y + 4);
    y += 8;
  }
  for (const floor of floors) {
    const png = await floorPng(project, floor);
    const ratio = png.h / png.w;
    let imgW = cw;
    let imgH = imgW * ratio;
    const maxH = pageH - 2 * M - 10;
    if (imgH > maxH) {
      imgH = maxH;
      imgW = imgH / ratio;
    }
    ensure(imgH + 8);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(floor.nome, M, y + 4);
    doc.setFont('helvetica', 'normal');
    y += 6;
    doc.addImage(png.url, 'PNG', M + (cw - imgW) / 2, y, imgW, imgH);
    y += imgH + 8;
  }

  // ---------- 2. Tabelas ----------
  doc.addPage();
  y = M;
  heading('2. Tabela de manifestações patológicas');

  const typeOf = (id: string) => project.anomalyTypes.find((t) => t.id === id);
  const nomen = (p: Point) => `${typeOf(p.typeId)?.prefix ?? '?'}${p.numero}`;
  const tipo = (p: Point) => typeOf(p.typeId)?.nome ?? '';
  const arquivos = (p: Point) =>
    project.photos
      .filter((ph) => ph.classification && ph.pointIds.includes(p.id))
      .map((ph) => ph.nome.replace(/\.[^.]+$/, ''))
      .join(', ');

  const groups = new Map<string, Point[]>();
  for (const p of project.points) {
    const key = p.comodo.trim() || 'Sem cômodo';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === 'Sem cômodo') return 1;
    if (b[0] === 'Sem cômodo') return -1;
    return a[0].localeCompare(b[0], 'pt');
  });
  for (const [, pts] of sortedGroups)
    pts.sort((a, b) => (a.typeId === b.typeId ? a.numero - b.numero : a.typeId.localeCompare(b.typeId)));

  if (sortedGroups.length === 0) {
    doc.setFontSize(10);
    doc.text('Nenhum ponto de anomalia.', M, y + 4);
    y += 8;
  }
  for (const [comodo, pts] of sortedGroups) {
    (doc as AutoTableDoc).autoTable({
      startY: y,
      margin: { left: M, right: M },
      head: [
        [
          {
            content: comodo,
            colSpan: 4,
            // banda do cômodo (azul-claro)
            styles: { halign: 'center', fillColor: [221, 227, 240], textColor: [38, 51, 63], fontStyle: 'bold' },
          },
        ],
        ['Nomenclatura', 'Tipo', 'Descrição', 'Arquivos'],
      ],
      body: pts.map((p) => [nomen(p), tipo(p), p.descricao ?? '', arquivos(p)]),
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 1.6,
        textColor: [38, 51, 63],
        lineColor: [199, 206, 214],
        lineWidth: 0.1,
        overflow: 'linebreak',
      },
      // cabeçalho ardósia (linha de títulos)
      headStyles: { fillColor: [38, 51, 63], textColor: [255, 255, 255], lineWidth: 0.1, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 246, 248] }, // zebra
      columnStyles: {
        0: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
        1: { cellWidth: 34 },
        2: { cellWidth: 60 },
        3: { cellWidth: cw - 24 - 34 - 60 },
      },
      theme: 'grid',
    });
    y = (doc as AutoTableDoc).lastAutoTable.finalY + 5;
  }

  // ---------- 3. Registro fotográfico ----------
  doc.addPage();
  y = M;
  heading('3. Registro fotográfico');

  const pointInfo: PointInfo = {};
  for (const pt of project.points) {
    const t = project.anomalyTypes.find((x) => x.id === pt.typeId);
    pointInfo[pt.id] = { label: `${t?.prefix ?? '?'}${pt.numero}`, color: LOCAL_COLORS[pt.local] };
  }

  const laudo = project.photos
    .filter((p) => p.classification === 'laudo')
    .sort((a, b) => a.nome.localeCompare(b.nome, undefined, { numeric: true }));

  let n = 0;
  let falhas = 0;
  const LONG = 150; // 15cm
  for (const photo of laudo) {
    let img: { url: string; w: number; h: number };
    try {
      img = await renderEditedDataUrl(photo, photo.annotations, pointInfo, 1600);
    } catch {
      falhas++;
      continue;
    }
    n++;
    let imgW: number, imgH: number;
    if (img.w >= img.h) {
      imgW = LONG;
      imgH = (LONG * img.h) / img.w;
    } else {
      imgH = LONG;
      imgW = (LONG * img.w) / img.h;
    }
    const desc = photo.descricao.trim();
    const capText = `Foto ${n}${desc ? ` – ${desc}` : ''}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const capLines = doc.splitTextToSize(capText, cw) as string[];
    const capH = capLines.length * 4.6 + 2;

    ensure(capH + imgH + 8);
    doc.text(capLines, pageW / 2, y + 3.4, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    y += capH;
    doc.addImage(img.url, 'JPEG', M + (cw - imgW) / 2, y, imgW, imgH);
    y += imgH + 8;
  }
  if (n === 0) {
    doc.setFontSize(10);
    doc.text('Nenhuma foto marcada como Laudo.', M, y + 4);
  }

  return { blob: doc.output('blob'), falhas };
}
