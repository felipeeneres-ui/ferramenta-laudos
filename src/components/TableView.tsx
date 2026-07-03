import { useState } from 'react';
import { IconCopy, IconCheck, IconAlertTriangle } from '@tabler/icons-react';
import { useStore } from '../store';
import type { Point } from '../types';

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function TableView() {
  const project = useStore((s) => s.project);
  const [copied, setCopied] = useState(false);

  const typeOf = (id: string) => project.anomalyTypes.find((t) => t.id === id);
  const nomen = (p: Point) => `${typeOf(p.typeId)?.prefix ?? '?'}${p.numero}`;
  // Tipo = significado da sigla (nome do tipo de anomalia); Descrição = texto do ponto
  const tipo = (p: Point) => typeOf(p.typeId)?.nome ?? '';
  const descricao = (p: Point) => p.descricao ?? '';
  // arquivos = nomes das fotos ORIGINAIS vinculadas ao ponto (sem extensão).
  // Só entram fotos classificadas (Tabela/Laudo) — "Não usar" sai da tabela.
  const arquivos = (p: Point) =>
    project.photos
      .filter((ph) => ph.classification && ph.pointIds.includes(p.id))
      .map((ph) => stripExt(ph.nome))
      .join(', ');

  // agrupa por cômodo
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
  for (const [, pts] of sortedGroups) {
    pts.sort((a, b) => (a.typeId === b.typeId ? a.numero - b.numero : a.typeId.localeCompare(b.typeId)));
  }

  const unplaced = project.points.filter((p) => p.floorId === null).length;
  const semComodo = project.points.filter((p) => !p.comodo.trim()).length;

  function buildHtml(): string {
    // Padrão visual "ardósia + âmbar". Larguras FIXAS em CADA célula (px) +
    // mso-table-layout-alt:fixed (o Word faz "autofit" sem isso). Cores via style
    // de célula (o Word respeita background/border de HTML colado).
    const CM = ['2.2cm', '3cm', '5.5cm', '4.8cm'];
    const PX = [83, 113, 208, 181]; // ≈ as larguras acima a 96dpi (total ≈ 585px / 15,5cm)
    const TOTAL_PX = PX.reduce((a, b) => a + b, 0);
    const P = { INK: '#26333F', WHITE: '#FFFFFF', ZEBRA: '#F5F6F8', BORDER: '#C7CED6', BAND: '#DDE3F0' };
    const colgroup = '<colgroup>' + CM.map((w) => `<col style="width:${w}"/>`).join('') + '</colgroup>';
    const BASE = `font-family:Arial;border:0.5pt solid ${P.BORDER};vertical-align:middle;word-wrap:break-word;padding:2pt 0.1cm`;
    const cell = (
      i: number,
      content: string,
      o: { bg?: string; color?: string; bold?: boolean; size?: string; align?: string } = {},
    ) => {
      const align = o.align ?? (i === 0 ? 'center' : 'left');
      const style =
        `${BASE};width:${CM[i]};text-align:${align};color:${o.color ?? P.INK};font-size:${o.size ?? '8.5pt'}` +
        (o.bg ? `;background:${o.bg}` : '') +
        (o.bold ? ';font-weight:bold' : '');
      return `<td width="${PX[i]}" style="${style}">${content}</td>`;
    };
    const head = (i: number, t: string) =>
      cell(i, t, { bg: P.INK, color: P.WHITE, bold: true, size: '9pt', align: i === 0 ? 'center' : 'left' });

    let html = '';
    for (const [comodo, pts] of sortedGroups) {
      html +=
        `<table border="0" cellspacing="0" cellpadding="0" width="${TOTAL_PX}" ` +
        `style="border-collapse:collapse;table-layout:fixed;mso-table-layout-alt:fixed;width:15.5cm;margin-bottom:10px;font-family:Arial;border:0.5pt solid ${P.BORDER}">`;
      html += colgroup;
      // banda do cômodo (mesclada)
      html +=
        `<tr><td colspan="4" style="${BASE};background:${P.BAND};color:${P.INK};text-align:center;font-weight:bold;font-size:9pt">${esc(comodo)}</td></tr>`;
      // cabeçalho ardósia
      html += '<tr>' + head(0, 'Nomenclatura') + head(1, 'Tipo') + head(2, 'Descrição') + head(3, 'Arquivos') + '</tr>';
      // corpo com zebra (1ª, 3ª, 5ª… linhas do corpo sombreadas)
      pts.forEach((p, idx) => {
        const bg = idx % 2 === 0 ? P.ZEBRA : undefined;
        html +=
          '<tr>' +
          cell(0, nomen(p), { bg, bold: true, align: 'center' }) +
          cell(1, esc(tipo(p)), { bg }) +
          cell(2, esc(descricao(p)), { bg }) +
          cell(3, esc(arquivos(p)), { bg }) +
          '</tr>';
      });
      html += '</table>';
    }
    return html;
  }
  function buildText(): string {
    let txt = '';
    for (const [comodo, pts] of sortedGroups) {
      txt += `${comodo}\nNomenclatura\tTipo\tDescrição\tArquivos\n`;
      for (const p of pts) txt += `${nomen(p)}\t${tipo(p)}\t${descricao(p)}\t${arquivos(p)}\n`;
      txt += '\n';
    }
    return txt;
  }

  async function copyAll() {
    let ok = false;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([buildHtml()], { type: 'text/html' }),
          'text/plain': new Blob([buildText()], { type: 'text/plain' }),
        }),
      ]);
      ok = true;
    } catch {
      try {
        await navigator.clipboard.writeText(buildText());
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      alert('Não foi possível copiar automaticamente. Selecione a tabela e use Ctrl+C.');
    }
  }

  return (
    <div className="table-view">
      <div className="subbar">
        <div className="counts">
          <span>{project.points.length} pontos</span>
          <span>{sortedGroups.length} cômodos</span>
        </div>
        <button className="icon-btn" onClick={copyAll} disabled={project.points.length === 0}>
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
          {copied ? 'Copiado!' : 'Copiar para o Word'}
        </button>
      </div>

      <div className="table-scroll">
        {(unplaced > 0 || semComodo > 0) && (
          <div className="tbl-warn">
            <IconAlertTriangle size={16} />
            {unplaced > 0 && <span>{unplaced} ponto(s) ainda sem posição no croqui.</span>}
            {semComodo > 0 && <span>{semComodo} ponto(s) sem cômodo.</span>}
          </div>
        )}

        {project.points.length === 0 ? (
          <p className="empty" style={{ padding: 24 }}>
            Nenhum ponto ainda. Crie pontos de anomalia (no croqui ou nas fotos) e vincule as fotos a
            eles — eles aparecem aqui agrupados por cômodo.
          </p>
        ) : (
          sortedGroups.map(([comodo, pts]) => (
            <table key={comodo} className="laudo-table">
              <thead>
                <tr>
                  <th className="comodo-head" colSpan={4}>
                    {comodo}
                  </th>
                </tr>
                <tr>
                  <th style={{ width: '14%' }}>Nomenclatura</th>
                  <th style={{ width: '19%' }}>Tipo</th>
                  <th style={{ width: '36%' }}>Descrição</th>
                  <th style={{ width: '31%' }}>Arquivos</th>
                </tr>
              </thead>
              <tbody>
                {pts.map((p) => (
                  <tr key={p.id}>
                    <td>{nomen(p)}</td>
                    <td>{tipo(p) || <span className="muted2">—</span>}</td>
                    <td>{descricao(p) || <span className="muted2">—</span>}</td>
                    <td className="tbl-files">{arquivos(p) || <span className="muted2">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))
        )}
      </div>
    </div>
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
