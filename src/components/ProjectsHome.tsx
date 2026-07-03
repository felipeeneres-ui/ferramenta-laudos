import { useRef, useState } from 'react';
import {
  IconRuler2,
  IconPlus,
  IconTrash,
  IconFolderOpen,
  IconMapPin,
  IconPhoto,
  IconStack2,
  IconDownload,
} from '@tabler/icons-react';
import { useStore } from '../store';
import type { Project } from '../types';

function fmtData(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ProjectsHome() {
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);
  const createProject = useStore((s) => s.createProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const loadFromJSON = useStore((s) => s.loadFromJSON);
  const [novoNome, setNovoNome] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function criar() {
    createProject(novoNome);
    setNovoNome('');
  }

  function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Project;
        if (data.floors && data.activeFloorId) loadFromJSON(data);
        else alert('Arquivo de projeto inválido.');
      } catch {
        alert('Arquivo de projeto inválido.');
      }
    };
    reader.readAsText(file);
  }

  function baixarBackup(id: string, nome: string) {
    const raw = localStorage.getItem(`ferramenta-laudos:project:${id}`);
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nome || 'projeto'}.croqui.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="phome">
      <header className="phome-head">
        <div className="phome-brand">
          <IconRuler2 size={26} stroke={1.6} />
          <div>
            <h1>Ferramenta de Auxílio em Laudos</h1>
            <p>Croqui · Fotos · Tabelas · CRAFT Engenharia</p>
          </div>
        </div>
      </header>

      <div className="phome-body">
        <div className="phome-new">
          <input
            type="text"
            placeholder="Nome do novo projeto (ex.: Casa Dona Áurea)"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && criar()}
          />
          <button className="icon-btn primary" onClick={criar}>
            <IconPlus size={16} /> Novo projeto
          </button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={onImport} />
          <button className="icon-btn ghost" onClick={() => fileRef.current?.click()} title="Importar projeto (.croqui.json)">
            <IconFolderOpen size={16} /> Importar (.json)
          </button>
        </div>

        {projects.length === 0 ? (
          <p className="empty" style={{ padding: 40, textAlign: 'center' }}>
            Nenhum projeto ainda. Crie o primeiro acima.
          </p>
        ) : (
          <div className="phome-grid">
            {projects.map((p) => (
              <div key={p.id} className="pcard" onClick={() => openProject(p.id)} role="button" tabIndex={0}>
                <div className="pcard-nome">{p.nome}</div>
                <div className="pcard-meta">
                  <span>
                    <IconStack2 size={14} /> {p.pavimentos} pav.
                  </span>
                  <span>
                    <IconMapPin size={14} /> {p.pontos} pontos
                  </span>
                  <span>
                    <IconPhoto size={14} /> {p.fotos} fotos
                  </span>
                </div>
                <div className="pcard-foot">
                  <span className="pcard-data">editado em {fmtData(p.updatedAt)}</span>
                  <span className="pcard-actions">
                    <button
                      title="Baixar backup (.json)"
                      onClick={(e) => {
                        e.stopPropagation();
                        baixarBackup(p.id, p.nome);
                      }}
                    >
                      <IconDownload size={15} />
                    </button>
                    <button
                      className="danger"
                      title="Excluir projeto"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            `Excluir o projeto "${p.nome}"?\n\nIsso apaga o croqui, os pontos e o registro das fotos deste projeto (as fotos originais na pasta do computador são preservadas).`,
                          )
                        )
                          deleteProject(p.id);
                      }}
                    >
                      <IconTrash size={15} />
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
