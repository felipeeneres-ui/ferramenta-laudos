import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  SimpleField,
  ImageRun,
  AlignmentType,
} from 'docx';
import { renderEditedDataUrl, type PointInfo } from './renderEdited';
import type { Photo } from './types';

// 15 cm em pixels @96dpi (lado maior da foto no Word).
const LONG_PX = Math.round((15 / 2.54) * 96);

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Pixels da imagem no Word: lado maior = 15cm, mantendo a proporção.
function imgPx(w: number, h: number): { width: number; height: number } {
  if (w >= h) return { width: LONG_PX, height: Math.round((LONG_PX * h) / w) };
  return { height: LONG_PX, width: Math.round((LONG_PX * w) / h) };
}

// Gera um .docx (Registro fotográfico) com cada foto editada + legenda NATIVA do Word
// ("Foto N – descrição", estilo Legenda + campo SEQ → permite sumário de figuras).
export async function buildLaudoDocx(
  photos: Photo[],
  pointInfo: PointInfo,
): Promise<{ blob: Blob; falhas: number }> {
  const children: Paragraph[] = [];
  let falhas = 0;
  let n = 0;

  for (const p of photos) {
    let img: { url: string; w: number; h: number };
    try {
      img = await renderEditedDataUrl(p, p.annotations, pointInfo, 1600);
    } catch {
      falhas++;
      continue;
    }
    n++;
    const desc = p.descricao.trim();

    // Legenda nativa: "Foto " + campo SEQ Foto (com resultado em cache) + " – descrição"
    const capRuns: (TextRun | SimpleField)[] = [
      new TextRun('Foto '),
      new SimpleField(' SEQ Foto \\* ARABIC ', String(n)),
    ];
    if (desc) capRuns.push(new TextRun(` – ${desc}`));
    children.push(
      new Paragraph({
        style: 'Legenda',
        children: capRuns,
      }),
    );

    // Foto
    const { width, height } = imgPx(img.w, img.h);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new ImageRun({ type: 'jpg', data: dataUrlToBytes(img.url), transformation: { width, height } }),
        ],
      }),
    );
  }

  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          // Mesmo estilo do modelo do usuário: styleId "Legenda" (Word pt-BR), name "caption".
          // Ao colar no laudo, casa com o estilo Legenda do template; sozinho, replica o visual.
          id: 'Legenda',
          name: 'caption',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 20, bold: true }, // 10pt negrito (como o modelo)
          paragraph: {
            keepNext: true,
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 40 },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } }, // 2cm
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return { blob, falhas };
}
