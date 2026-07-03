import { useMemo, useState } from 'react';
import { IconX, IconPlus } from '@tabler/icons-react';
import { useStore } from '../store';
import { LOCAL_COLORS, LOCAL_LABEL, type Local, type Photo } from '../types';

const LOCALS: Local[] = ['parede', 'piso', 'teto'];

interface Props {
  photo: Photo;
  onClose: () => void;
}

export function TablePointPicker({ photo, onClose }: Props) {
  const project = useStore((s) => s.project);
  const addPointToPhoto = useStore((s) => s.addPointToPhoto);
  const removePointFromPhoto = useStore((s) => s.removePointFromPhoto);
  const createPoint = useStore((s) => s.createPoint);

  // foto atualizada (pode mudar enquanto edita)
  const cur = project.photos.find((p) => p.id === photo.id) ?? photo;

  const comodos = useMemo(
    () =>
      Array.from(
        new Set([
          ...project.floors.flatMap((f) => f.rooms.map((r) => r.nome)),
          ...project.points.map((p) => p.comodo),
        ]),
      )
        .map((c) => c.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'pt')),
    [project.floors, project.points],
  );

  const linkedPoints = project.points.filter((p) => cur.pointIds.includes(p.id));
  const [comodo, setComodo] = useState(linkedPoints[0]?.comodo || comodos[0] || '');
  const [newType, setNewType] = useState(project.anomalyTypes[0]?.id ?? 'F');
  const [newLocal, setNewLocal] = useState<Local>('parede');

  const typeOf = (id: string) => project.anomalyTypes.find((t) => t.id === id);
  const nomen = (p: { typeId: string; numero: number }) => `${typeOf(p.typeId)?.prefix ?? '?'}${p.numero}`;
  // agrupados por tipo (prefixo em ordem alfabética) e ordenados pelo número
  const pointsInComodo = project.points
    .filter((p) => p.comodo.trim() === comodo)
    .sort((a, b) => {
      const pa = typeOf(a.typeId)?.prefix ?? '';
      const pb = typeOf(b.typeId)?.prefix ?? '';
      return pa.localeCompare(pb, 'pt') || a.numero - b.numero;
    });

  function toggle(id: string, checked: boolean) {
    if (checked) addPointToPhoto(cur.id, id);
    else removePointFromPhoto(cur.id, id);
  }

  function novoPonto() {
    if (!comodo) {
      alert('Escolha um cômodo primeiro.');
      return;
    }
    const id = createPoint({ typeId: newType, local: newLocal, comodo });
    addPointToPhoto(cur.id, id);
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <div>
            <div className="picker-title">Pontos da foto</div>
            <div className="picker-sub">{cur.nome}</div>
          </div>
          <button className="vt-close" onClick={onClose} aria-label="Fechar">
            <IconX size={20} />
          </button>
        </div>

        <div className="picker-body">
          <div className="field">
            <label>Cômodo</label>
            <select value={comodo} onChange={(e) => setComodo(e.target.value)}>
              {comodos.length === 0 && <option value="">(nenhum cômodo no croqui)</option>}
              {comodos.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="picker-points">
            {pointsInComodo.length === 0 ? (
              <p className="muted" style={{ margin: '4px 0' }}>
                Nenhum ponto neste cômodo ainda. Crie um abaixo.
              </p>
            ) : (
              pointsInComodo.map((p) => (
                <label key={p.id} className="pick-row">
                  <input
                    type="checkbox"
                    checked={cur.pointIds.includes(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                  <span className="dot" style={{ background: LOCAL_COLORS[p.local] }} />
                  <span className="mono">{nomen(p)}</span>
                  <span className="pick-desc">{p.descricao || LOCAL_LABEL[p.local]}</span>
                </label>
              ))
            )}
          </div>

          <div className="picker-new">
            <div className="picker-new-label">Novo ponto neste cômodo</div>
            <div className="picker-new-row">
              <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                {project.anomalyTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.prefix} — {t.nome}
                  </option>
                ))}
              </select>
              <div className="seg">
                {LOCALS.map((l) => (
                  <button
                    key={l}
                    className={newLocal === l ? 'active' : ''}
                    style={{ color: newLocal === l ? LOCAL_COLORS[l] : undefined }}
                    onClick={() => setNewLocal(l)}
                    title={LOCAL_LABEL[l]}
                  >
                    <span className="dot" style={{ background: LOCAL_COLORS[l] }} />
                  </button>
                ))}
              </div>
              <button className="icon-btn" onClick={novoPonto}>
                <IconPlus size={15} /> Criar
              </button>
            </div>
          </div>

          {linkedPoints.length > 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              Vinculados: {linkedPoints.map((p) => nomen(p)).join(', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
