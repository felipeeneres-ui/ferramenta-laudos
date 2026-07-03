import { useEffect, useRef, useState } from 'react';
import { IconDownload, IconRefresh } from '@tabler/icons-react';
import { useStore } from '../store';
import { renderEditedDataUrl, type PointInfo } from '../renderEdited';
import { buildInteractiveHtml } from '../exportInteractiveHtml';
import { getBg, blobToDataUrl } from '../db';
import { LOCAL_COLORS } from '../types';

export function ClientView() {
  const projectName = useStore((s) => s.project.nome);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [info, setInfo] = useState({ pontos: 0, fotos: 0 });
  const [nonce, setNonce] = useState(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setBusy(true);
    (async () => {
      const project = useStore.getState().project;
      const pointInfo: PointInfo = {};
      for (const pt of project.points) {
        const t = project.anomalyTypes.find((x) => x.id === pt.typeId);
        pointInfo[pt.id] = { label: `${t?.prefix ?? '?'}${pt.numero}`, color: LOCAL_COLORS[pt.local] };
      }
      // fotos vinculadas a algum ponto (Laudo ou Tabela), versão editada quando houver
      const linkedIds = new Set(project.points.map((p) => p.id));
      const photos = project.photos.filter(
        (ph) => ph.classification && ph.pointIds.some((id) => linkedIds.has(id)),
      );
      const srcMap = new Map<string, string>();
      for (const ph of photos) {
        try {
          const r = await renderEditedDataUrl(ph, ph.annotations, pointInfo, 1280);
          if (!aliveRef.current) return;
          srcMap.set(ph.id, r.url);
        } catch {
          /* foto indisponível — ignora */
        }
      }
      // imagens de fundo dos pavimentos (satélite/planta)
      const bgMap = new Map<string, string>();
      for (const f of project.floors) {
        if (!f.bg) continue;
        try {
          const blob = await getBg(f.id);
          if (blob) bgMap.set(f.id, await blobToDataUrl(blob));
        } catch {
          /* sem fundo — segue */
        }
      }
      if (!aliveRef.current) return;
      setHtml(buildInteractiveHtml(project, srcMap, bgMap));
      setInfo({ pontos: project.points.length, fotos: srcMap.size });
      setBusy(false);
    })();
    return () => {
      aliveRef.current = false;
    };
  }, [nonce]);

  function baixar() {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'laudo'} - croqui interativo.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="client-view">
      <div className="subbar">
        <div className="counts">
          <span>Visão do cliente (somente leitura)</span>
          {!busy && (
            <span className="muted" style={{ margin: 0 }}>
              {info.pontos} pontos · {info.fotos} fotos
            </span>
          )}
          {busy && (
            <span className="muted" style={{ margin: 0 }}>
              gerando preview…
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="icon-btn ghost" onClick={() => setNonce((n) => n + 1)} disabled={busy} title="Atualizar com as últimas alterações">
            <IconRefresh size={15} /> Atualizar
          </button>
          <button className="icon-btn primary" onClick={baixar} disabled={busy || !html}>
            <IconDownload size={16} /> Baixar para o cliente (.html)
          </button>
        </div>
      </div>

      <div className="client-frame-wrap">
        {html ? (
          <iframe className="client-frame" title="Croqui interativo" srcDoc={html} />
        ) : (
          <div className="photos-empty">
            <p className="muted">Gerando a prévia…</p>
          </div>
        )}
      </div>
    </div>
  );
}
