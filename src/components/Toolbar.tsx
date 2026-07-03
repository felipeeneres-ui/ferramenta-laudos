import {
  IconPointer,
  IconWall,
  IconLineDashed,
  IconLine,
  IconDoor,
  IconWindow,
  IconStairs,
  IconTag,
  IconMapPin,
  IconArrowsMove,
  IconRoute2,
  IconTypography,
} from '@tabler/icons-react';
import { useStore } from '../store';
import type { ToolId } from '../types';

const TOOLS: { id: ToolId; label: string; Icon: typeof IconPointer }[] = [
  { id: 'select', label: 'Selecionar / mover', Icon: IconPointer },
  { id: 'wall', label: 'Parede', Icon: IconWall },
  { id: 'projection', label: 'Projeção (pontilhada)', Icon: IconLineDashed },
  { id: 'limit', label: 'Limite (linha simples)', Icon: IconLine },
  { id: 'door', label: 'Porta', Icon: IconDoor },
  { id: 'window', label: 'Janela', Icon: IconWindow },
  { id: 'stairs', label: 'Escada', Icon: IconStairs },
  { id: 'room', label: 'Rótulo de cômodo', Icon: IconTag },
  { id: 'point', label: 'Ponto de anomalia', Icon: IconMapPin },
  { id: 'trace', label: 'Traçado colorido (clique a clique; botão direito encerra)', Icon: IconRoute2 },
  { id: 'flabel', label: 'Texto livre (com rotação)', Icon: IconTypography },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="toolbar">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`tool${tool === id ? ' active' : ''}`}
          title={label}
          aria-label={label}
          aria-pressed={tool === id}
          onClick={() => setTool(id)}
        >
          <Icon size={20} stroke={1.7} />
        </button>
      ))}
      <div className="tool-divider" />
      <button
        className={`tool${tool === 'pan' ? ' active' : ''}`}
        title="Mover tela (pan)"
        aria-label="Mover tela"
        aria-pressed={tool === 'pan'}
        onClick={() => setTool('pan')}
      >
        <IconArrowsMove size={20} stroke={1.7} />
      </button>
    </div>
  );
}
