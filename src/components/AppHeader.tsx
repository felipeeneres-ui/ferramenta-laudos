import { useRef, useState } from 'react';
import {
  IconRuler2,
  IconFolderOpen,
  IconDeviceFloppy,
  IconFileTypePdf,
  IconArrowLeft,
} from '@tabler/icons-react';
import { useStore } from '../store';
import { buildLaudoPdf } from '../exportLaudoPdf';
import type { Project, AppView } from '../types';

const VIEWS: { id: AppView; label: string }[] = [
  { id: 'croqui', label: 'Croqui' },
  { id: 'fotos', label: 'Fotos' },
  { id: 'split', label: 'Lado a lado' },
  { id: 'laudo', label: 'Fotos do laudo' },
  { id: 'tabela', label: 'Tabela' },
  { id: 'cliente', label: 'Croqui interativo' },
];

export function AppHeader() {
  const project = useStore((s) => s.project);
  const appView = useStore((s) => s.appView);
  const setAppView = useStore((s) => s.setAppView);
  const setProjectName = useStore((s) => s.setProjectName);
  const loadFromJSON = useStore((s) => s.loadFromJSON);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function baixarPdf() {
    setPdfBusy(true);
    try {
      const { blob, falhas } = await buildLaudoPdf(useStore.getState().project);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.nome || 'laudo'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      if (falhas) alert(`PDF gerado, mas ${falhas} foto(s) não puderam ser renderizadas (permita a pasta das fotos).`);
    } catch {
      alert('Não foi possível gerar o PDF.');
    } finally {
      setPdfBusy(false);
    }
  }

  function saveJSON() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.nome || 'imovel'}.croqui.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openJSON(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Project;
        if (data.floors && data.activeFloorId) loadFromJSON(data);
      } catch {
        alert('Arquivo de projeto inválido.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const goHome = useStore((s) => s.goHome);

  return (
    <div className="appheader">
      <div className="brand">
        <button className="icon-btn ghost" title="Voltar aos projetos" onClick={goHome} style={{ paddingInline: 8 }}>
          <IconArrowLeft size={16} /> Projetos
        </button>
        <IconRuler2 size={19} stroke={1.7} color="var(--ink-soft)" />
        <input
          value={project.nome}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Nome do imóvel"
        />
      </div>

      <div className="view-switch">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`view-tab${appView === v.id ? ' active' : ''}`}
            onClick={() => setAppView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={openJSON} />
        <button
          className="icon-btn"
          title="Baixar PDF (croqui + tabelas + fotos)"
          onClick={baixarPdf}
          disabled={pdfBusy}
        >
          <IconFileTypePdf size={16} />
          {pdfBusy ? 'Gerando…' : 'PDF'}
        </button>
        <button className="icon-btn ghost" title="Abrir projeto" onClick={() => fileRef.current?.click()}>
          <IconFolderOpen size={17} />
        </button>
        <button className="icon-btn ghost" title="Salvar projeto (.json)" onClick={saveJSON}>
          <IconDeviceFloppy size={17} />
        </button>
      </div>
    </div>
  );
}
