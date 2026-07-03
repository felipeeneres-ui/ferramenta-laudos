import { useRef } from 'react';
import {
  IconPlus,
  IconDownload,
  IconFileImport,
  IconEraser,
  IconMagnet,
  IconPhotoUp,
} from '@tabler/icons-react';
import { useStore } from '../store';
import { putBg } from '../db';

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
  const activeFloor = useStore((s) => s.activeFloor());
  const fileRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);

  async function onBgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      const w = bmp.width;
      const h = bmp.height;
      bmp.close();
      await putBg(activeFloor.id, file);
      // escala inicial: imagem com ~800 unidades de mundo de largura
      setFloorBg({ x: 0, y: 0, w, h, scale: 800 / w, opacity: 1, locked: false, rev: Date.now() });
    } catch {
      alert('Não foi possível ler a imagem.');
    }
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
        {project.floors.map((f) => (
          <button
            key={f.id}
            className={`floor-tab${f.id === project.activeFloorId ? ' active' : ''}`}
            onClick={() => setActiveFloor(f.id)}
          >
            {f.nome}
          </button>
        ))}
        <button className="icon-btn ghost" title="Adicionar pavimento" onClick={addFloor}>
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
          title="Imagem de fundo (satélite/planta) deste pavimento"
          onClick={() => bgRef.current?.click()}
        >
          <IconPhotoUp size={16} /> Fundo
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
    </div>
  );
}
