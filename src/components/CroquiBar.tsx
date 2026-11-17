import { useEffect, useRef, useState } from 'react';
import {
  IconPlus,
  IconDownload,
  IconFileImport,
  IconEraser,
  IconMagnet,
  IconPhotoUp,
  IconArrowsMove,
  IconMap2,
  IconEye,
  IconEyeOff,
} from '@tabler/icons-react';
import { useStore } from '../store';
import { putBg } from '../db';
import { CroquiRuaDialog } from './CroquiRuaDialog';

interface Props {
  onExport: () => void;
}

export function CroquiBar({ onExport }: Props) {
  const project = useStore((s) => s.project);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const addFloor = useStore((s) => s.addFloor);
  const importCroqui = useStore((s) => s.importCroqui);
  const clearCroqui = useStore((s) => s.clearCroqui);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const setFloorBg = useStore((s) => s.setFloorBg);
  const renameFloor = useStore((s) => s.renameFloor);
  const arrangeLabels = useStore((s) => s.arrangeLabels);
  const toggleRuaOculta = useStore((s) => s.toggleRuaOculta);
  const fileRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const [ruaOpen, setRuaOpen] = useState(false);

  async function applyBg(file: Blob) {
    try {
      const bmp = await createImageBitmap(file);
      const w = bmp.width;
      const h = bmp.height;
      bmp.close();
      const st = useStore.getState();
      const fl = st.activeFloor();
      // croqui único já com o desenho: a imagem nova entra como satélite, por baixo
      if (st.project.croquiUnico && fl.bg) {
        await putBg(`${fl.id}_sat`, file);
        const largura = fl.bg.w * fl.bg.scale;
        st.setSat({ x: fl.bg.x, y: fl.bg.y, w, h, scale: largura / w, opacity: 1, locked: false, rev: Date.now() });
        if (fl.bg.opacity > 0.7) st.updateFloorBg({ opacity: 0.6 });
        return;
      }
      await putBg(fl.id, file);
      // escala inicial: imagem com ~800 unidades de mundo de largura
      setFloorBg({ x: 0, y: 0, w, h, scale: 800 / w, opacity: 1, locked: false, rev: Date.now() });
    } catch {
      alert('Não foi possível ler a imagem.');
    }
  }

  async function onBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await applyBg(file);
  }

  // Ctrl+V: imagem copiada (ex.: recorte do satélite do Google Maps) vira o fundo da camada.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      const st = useStore.getState();
      const fl = st.activeFloor();
      const msg =
        st.project.croquiUnico && fl.bg
          ? 'Usar a imagem colada como satélite, por baixo do desenho do croqui?'
          : fl.bg
            ? `Trocar a imagem de fundo de "${fl.nome}" pela imagem colada?`
            : `Usar a imagem colada como fundo de "${fl.nome}"?`;
      if (confirm(msg)) void applyBg(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onRename(id: string, atual: string) {
    const nome = prompt('Nome da camada (ex.: Térreo, Rua das Palmeiras):', atual)?.trim();
    if (nome && nome !== atual) renameFloor(id, nome);
  }

  function onArrange() {
    const n = arrangeLabels();
    if (n === 0) alert('Nenhum rótulo sobreposto nesta camada.');
  }

  function onClear() {
    if (confirm('Limpar todo o croqui deste pavimento (paredes, portas/janelas e rótulos)? Os pontos de anomalia voltam para a lista "a posicionar".')) {
      clearCroqui();
    }
  }

  function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        importCroqui(data);
      } catch {
        alert('Arquivo de croqui inválido.');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="subbar">
      <div className="floor-tabs">
        {project.floors.map((f) => {
          const oculta = !!project.croquiUnico && (project.ruasOcultas ?? []).includes(f.id);
          return (
            <button
              key={f.id}
              className={`floor-tab${f.id === project.activeFloorId ? ' active' : ''}${oculta ? ' rua-oculta' : ''}`}
              onClick={() => setActiveFloor(f.id)}
              onDoubleClick={() => onRename(f.id, f.nome)}
              title={
                project.croquiUnico
                  ? 'Rua ativa: os pontos novos entram nela. Clique duplo para renomear.'
                  : 'Clique duplo para renomear'
              }
            >
              {project.croquiUnico && (
                <span
                  className="rua-olho"
                  role="button"
                  title={
                    oculta
                      ? 'Pontos desta rua escondidos no croqui e no PNG. Clique para mostrar.'
                      : 'Esconder os pontos desta rua no croqui e no PNG (a tabela continua com eles)'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRuaOculta(f.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {oculta ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                </span>
              )}
              {f.nome}
            </button>
          );
        })}
        <button className="icon-btn ghost" title="Adicionar camada (pavimento ou rua)" onClick={addFloor}>
          <IconPlus size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className={`icon-btn${snapEnabled ? ' snap-on' : ' ghost'}`}
          title={snapEnabled ? 'Snap à grade: ligado (clique para desligar)' : 'Snap à grade: desligado (clique para ligar)'}
          onClick={toggleSnap}
        >
          <IconMagnet size={16} /> Snap: {snapEnabled ? 'on' : 'off'}
        </button>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={onImport} />
        <input ref={bgRef} type="file" accept="image/*" hidden onChange={onBgFile} />
        <button
          className="icon-btn ghost"
          title="Imagem de fundo (satélite/planta) desta camada. Também dá para colar com Ctrl+V."
          onClick={() => bgRef.current?.click()}
        >
          <IconPhotoUp size={16} /> Fundo
        </button>
        <button
          className="icon-btn ghost"
          title="Vistoria de rua: desenha a quadra a partir de uma coordenada e cria uma camada por rua"
          onClick={() => setRuaOpen(true)}
        >
          <IconMap2 size={16} /> Croqui de rua
        </button>
        <button
          className="icon-btn ghost"
          title="Afasta os rótulos que estão uns sobre os outros, criando linhas de chamada"
          onClick={onArrange}
        >
          <IconArrowsMove size={16} /> Organizar rótulos
        </button>
        <button className="icon-btn ghost" title="Importar croqui (.json)" onClick={() => fileRef.current?.click()}>
          <IconFileImport size={16} /> Importar croqui
        </button>
        <button className="icon-btn ghost" title="Limpar todo o croqui deste pavimento" onClick={onClear}>
          <IconEraser size={16} /> Limpar
        </button>
        <button className="icon-btn" onClick={onExport}>
          <IconDownload size={16} />
          Exportar PNG
        </button>
      </div>
      {ruaOpen && <CroquiRuaDialog onClose={() => setRuaOpen(false)} />}
    </div>
  );
}
