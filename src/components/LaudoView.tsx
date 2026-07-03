import { useEffect, useMemo, useState } from 'react';
import { IconCopy, IconCheck, IconFileTypeDocx, IconTextIncrease } from '@tabler/icons-react';
import { useStore } from '../store';
import { renderEditedDataUrl, type PointInfo } from '../renderEdited';
import { buildLaudoDocx } from '../exportLaudoDocx';
import { LOCAL_COLORS, type Photo } from '../types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tamanho no Word (cm): lado maior = 15cm, mantendo a proporção da foto.
function cmSize(w: number, h: number): { cw: number; ch: number } {
  const LONG = 15;
  if (w >= h) return { cw: LONG, ch: Math.round(((LONG * h) / w) * 100) / 100 };
  return { ch: LONG, cw: Math.round(((LONG * w) / h) * 100) / 100 };
}

// Cabeçalho no formato de clipboard do Word: define o estilo "Legenda" (mso-style-name)
// para que o Word aplique a formatação real da legenda ao colar.
const HEAD =
  '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
  '<head><meta charset="utf-8"><style><!--\n' +
  ' p.MsoCaption, li.MsoCaption, div.MsoCaption\n' +
  ' {mso-style-name:Legenda; margin:0cm; text-align:center; line-height:normal;\n' +
  '  font-size:9.0pt; font-family:"Calibri",sans-serif;}\n' +
  '--></style></head><body>';
const FOOT = '</body></html>';

// Legenda com o campo SEQ (numeração automática do Word) — vira legenda de verdade,
// permitindo sumário de figuras. `numero` é o valor de fallback exibido.
function captionHtml(numero: number, desc: string): string {
  const field =
    'Foto ' +
    "<![if supportFields]><span style='mso-element:field-begin'></span> SEQ Foto \\* ARABIC " +
    "<span style='mso-element:field-separator'></span><![endif]>" +
    numero +
    "<![if supportFields]><span style='mso-element:field-end'></span><![endif]>";
  const tail = desc ? ` &#8211; ${escapeHtml(desc)}` : '';
  return `<p class=MsoCaption align=center style='text-align:center'>${field}${tail}</p>`;
}

function imgHtml(url: string, w: number, h: number): string {
  const { cw, ch } = cmSize(w, h);
  const wpx = Math.round((cw / 2.54) * 96);
  const hpx = Math.round((ch / 2.54) * 96);
  return `<p align=center style='text-align:center'><img width=${wpx} height=${hpx} style='width:${cw}cm;height:${ch}cm' src="${url}"></p>`;
}

function blockHtml(url: string, w: number, h: number, numero: number, desc: string): string {
  return captionHtml(numero, desc) + imgHtml(url, w, h);
}

async function copyHtml(bodyHtml: string, plain: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([HEAD + bodyHtml + FOOT], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function LaudoView() {
  const project = useStore((s) => s.project);
  const setAllTextSize = useStore((s) => s.setAllTextSize);

  const pointInfo: PointInfo = useMemo(() => {
    const m: PointInfo = {};
    for (const pt of project.points) {
      const t = project.anomalyTypes.find((x) => x.id === pt.typeId);
      m[pt.id] = { label: `${t?.prefix ?? '?'}${pt.numero}`, color: LOCAL_COLORS[pt.local] };
    }
    return m;
  }, [project.points, project.anomalyTypes]);

  const photos = project.photos
    .filter((p) => p.classification === 'laudo')
    .sort((a, b) => a.nome.localeCompare(b.nome, undefined, { numeric: true }));

  const legendaDe = (p: Photo, n: number) => {
    const d = p.descricao.trim();
    return `Foto ${n}${d ? ` – ${d}` : ''}`;
  };

  const [busy, setBusy] = useState(false);
  const [txtSize, setTxtSize] = useState(25);
  const textCount = project.photos.reduce(
    (n, ph) => n + ph.annotations.filter((a) => a.kind === 'text').length,
    0,
  );
  const textPhotos = project.photos.filter((ph) => ph.annotations.some((a) => a.kind === 'text')).length;

  function aplicarEscritas() {
    if (textCount === 0) {
      alert('Nenhuma caixa de texto encontrada nas fotos.');
      return;
    }
    if (
      !confirm(
        `Ajustar TODAS as ${textCount} caixa(s) de texto (em ${textPhotos} foto(s)) para o tamanho ${txtSize}?\n\n` +
          'Um backup do projeto será baixado ANTES de qualquer alteração.',
      )
    )
      return;
    // 1) backup automático (restaurável em "Abrir projeto")
    const bkp = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const burl = URL.createObjectURL(bkp);
    const ba = document.createElement('a');
    ba.href = burl;
    ba.download = `${project.nome || 'projeto'} - BACKUP antes de ajustar escritas.json`;
    ba.click();
    URL.revokeObjectURL(burl);
    // 2) aplica o novo tamanho
    setAllTextSize(txtSize);
    alert(
      `Pronto! Backup baixado na sua pasta Downloads e ${textCount} escrita(s) ajustada(s) para o tamanho ${txtSize}.\n\n` +
        'Gere o Word/PDF de novo para ver o resultado.',
    );
  }

  async function baixarDocx() {
    setBusy(true);
    try {
      const { blob, falhas } = await buildLaudoDocx(photos, pointInfo);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.nome || 'Registro fotográfico'} - Fotos do laudo.docx`;
      a.click();
      URL.revokeObjectURL(url);
      if (falhas) alert(`Gerado, mas ${falhas} foto(s) não puderam ser renderizadas (permita a pasta das fotos).`);
    } catch {
      alert('Não foi possível gerar o Word.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="laudo-view">
      <div className="subbar">
        <div className="counts">
          <span>{photos.length} fotos no laudo</span>
          {textCount > 0 && (
            <span className="muted" style={{ margin: 0 }}>
              {textCount} escritas
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div
            style={{ display: 'flex', gap: 6, alignItems: 'center' }}
            title="Define o tamanho de TODAS as caixas de texto das fotos (faz um backup antes)"
          >
            <span className="muted" style={{ margin: 0 }}>
              Tamanho das escritas
            </span>
            <input
              type="number"
              min={1}
              max={100}
              value={txtSize}
              onChange={(e) => setTxtSize(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              style={{ width: 54 }}
            />
            <button className="icon-btn ghost" onClick={aplicarEscritas} disabled={textCount === 0}>
              <IconTextIncrease size={15} /> Aplicar a todas
            </button>
          </div>
          <button className="icon-btn primary" onClick={baixarDocx} disabled={photos.length === 0 || busy}>
            <IconFileTypeDocx size={16} />
            {busy ? 'Gerando Word…' : 'Baixar Word (.docx)'}
          </button>
        </div>
      </div>

      <div className="laudo-scroll">
        {photos.length === 0 ? (
          <p className="empty" style={{ padding: 24 }}>
            Nenhuma foto marcada como <b>Laudo</b> ainda. As fotos editadas (Laudo) aparecem aqui
            numeradas, com a legenda, prontas para copiar para o Word.
          </p>
        ) : (
          photos.map((p, i) => (
            <LaudoCard
              key={p.id}
              photo={p}
              numero={i + 1}
              legenda={legendaDe(p, i + 1)}
              pointInfo={pointInfo}
            />
          ))
        )}
      </div>
    </div>
  );
}

function LaudoCard({
  photo,
  numero,
  legenda,
  pointInfo,
}: {
  photo: Photo;
  numero: number;
  legenda: string;
  pointInfo: PointInfo;
}) {
  const [img, setImg] = useState<{ url: string; w: number; h: number } | null>(null);
  const [erro, setErro] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setImg(null);
    setErro(false);
    renderEditedDataUrl(photo, photo.annotations, pointInfo)
      .then((r) => alive && setImg(r))
      .catch(() => alive && setErro(true));
    return () => {
      alive = false;
    };
  }, [photo, pointInfo]);

  async function copiar() {
    if (!img) return;
    const ok = await copyHtml(
      blockHtml(img.url, img.w, img.h, numero, photo.descricao.trim()),
      legenda,
    );
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      alert('Não foi possível copiar automaticamente.');
    }
  }

  const orient = img && img.h > img.w ? 'em pé (11,25 × 15 cm)' : 'deitada (15 × 11,25 cm)';

  return (
    <div className="laudo-card">
      <div className="laudo-legenda">{legenda}</div>
      <div className="laudo-prev">
        {img ? (
          <img src={img.url} alt={legenda} />
        ) : erro ? (
          <span className="muted2">não foi possível gerar (permita a pasta das fotos)</span>
        ) : (
          <span className="muted2">gerando imagem editada…</span>
        )}
      </div>
      <div className="laudo-foot">
        <span className="muted">
          {photo.nome} · {orient}
        </span>
        <button className="icon-btn" onClick={copiar} disabled={!img}>
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          {copied ? 'Copiado!' : 'Copiar foto'}
        </button>
      </div>
    </div>
  );
}
