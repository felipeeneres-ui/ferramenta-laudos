import { useStore } from '../store';
import { ANNOTATION_COLORS, LOCAL_COLORS, LOCAL_LABEL, type Local } from '../types';
import { wallLength } from '../geometry';
import {
  IconPlus,
  IconTrash,
  IconFlipHorizontal,
  IconMapPinPlus,
  IconLock,
  IconLockOpen,
} from '@tabler/icons-react';

const LOCALS: Local[] = ['parede', 'piso', 'teto'];

export function RightPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const floor = useStore((s) => s.activeFloor());

  const activeTypeId = useStore((s) => s.activeTypeId);
  const activeLocal = useStore((s) => s.activeLocal);
  const openingWidth = useStore((s) => s.openingWidth);
  const setActiveType = useStore((s) => s.setActiveType);
  const setActiveLocal = useStore((s) => s.setActiveLocal);
  const setOpeningWidth = useStore((s) => s.setOpeningWidth);

  const updateOpening = useStore((s) => s.updateOpening);
  const updatePoint = useStore((s) => s.updatePoint);
  const updateRoom = useStore((s) => s.updateRoom);
  const setAllRoomFonts = useStore((s) => s.setAllRoomFonts);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const addType = useStore((s) => s.addType);
  const placingPointId = useStore((s) => s.placingPointId);
  const setPlacingPoint = useStore((s) => s.setPlacingPoint);
  const setCroquiPointSize = useStore((s) => s.setCroquiPointSize);
  const croquiPointSize = project.croquiPointSize ?? 18;

  const typeOf = (id: string) => project.anomalyTypes.find((t) => t.id === id);
  // pontos criados (ex.: numa foto) ainda sem posição no croqui — agrupados por tipo
  const unplaced = project.points
    .filter((p) => p.floorId === null)
    .sort((a, b) => {
      const pa = typeOf(a.typeId)?.prefix ?? '';
      const pb = typeOf(b.typeId)?.prefix ?? '';
      return pa.localeCompare(pb, 'pt') || a.numero - b.numero;
    });

  const selPoint =
    selection?.kind === 'point' ? project.points.find((p) => p.id === selection.id) : undefined;
  // cômodos disponíveis = rótulos de cômodo de todos os pavimentos
  const comodos = Array.from(
    new Set(project.floors.flatMap((f) => f.rooms.map((r) => r.nome).filter(Boolean))),
  ).sort((a, b) => a.localeCompare(b, 'pt'));
  const selOpening =
    selection?.kind === 'opening' ? floor.openings.find((o) => o.id === selection.id) : undefined;
  const selRoom =
    selection?.kind === 'room' ? floor.rooms.find((r) => r.id === selection.id) : undefined;
  const selWall =
    selection?.kind === 'wall' ? floor.walls.find((w) => w.id === selection.id) : undefined;
  const selTrace =
    selection?.kind === 'trace' ? (floor.traces ?? []).find((t) => t.id === selection.id) : undefined;
  const selLabel =
    selection?.kind === 'flabel' ? (floor.labels ?? []).find((l) => l.id === selection.id) : undefined;

  const traceStyle = useStore((s) => s.traceStyle);
  const setTraceStyle = useStore((s) => s.setTraceStyle);
  const updateTrace = useStore((s) => s.updateTrace);
  const updateFreeLabel = useStore((s) => s.updateFreeLabel);
  const updateFloorBg = useStore((s) => s.updateFloorBg);
  const setFloorBg = useStore((s) => s.setFloorBg);
  const bg = floor.bg ?? null;

  // Estilo do traçado: controla o selecionado, ou o padrão da ferramenta.
  const trColor = selTrace ? selTrace.color : traceStyle.color;
  const trWidth = selTrace ? selTrace.width : traceStyle.width;
  const trDashed = selTrace ? !!selTrace.dashed : traceStyle.dashed;
  const setTr = (patch: Partial<{ color: string; width: number; dashed: boolean }>) => {
    if (selTrace) updateTrace(selTrace.id, patch);
    setTraceStyle(patch);
  };
  const showTraceControls = selTrace || tool === 'trace';

  // Local e Tipo controlam o ponto selecionado, ou os padrões da ferramenta.
  const curLocal = selPoint ? selPoint.local : activeLocal;
  const curType = selPoint ? selPoint.typeId : activeTypeId;
  const setLocal = (l: Local) =>
    selPoint ? updatePoint(selPoint.id, { local: l }) : setActiveLocal(l);
  const setType = (id: string) =>
    selPoint ? updatePoint(selPoint.id, { typeId: id }) : setActiveType(id);

  const showPointControls = selPoint || tool === 'point';

  function novoTipo() {
    const prefix = prompt('Prefixo do tipo (ex.: F, U, CE):')?.trim();
    if (!prefix) return;
    const nome = prompt('Nome do tipo (ex.: Fissura):')?.trim();
    if (!nome) return;
    addType(prefix.toUpperCase(), nome);
  }

  return (
    <div className="panel">
      {/* Pontos criados nas fotos, aguardando posição no croqui */}
      {unplaced.length > 0 && (
        <section style={{ marginTop: 0 }}>
          <h3>
            <IconMapPinPlus size={15} style={{ verticalAlign: -2, marginRight: 5 }} />
            A posicionar ({unplaced.length})
          </h3>
          <div className="type-list">
            {unplaced.map((pt) => {
              const t = typeOf(pt.typeId);
              return (
                <div
                  key={pt.id}
                  className={`type-row${placingPointId === pt.id ? ' active' : ''}`}
                  onClick={() => setPlacingPoint(placingPointId === pt.id ? null : pt.id)}
                >
                  <span className="dot" style={{ background: LOCAL_COLORS[pt.local], width: 10, height: 10, borderRadius: '50%' }} />
                  <span className="prefix">{t?.prefix}{pt.numero}</span>
                  <span style={{ flex: 1, color: 'var(--ink-soft)', fontSize: 12 }}>
                    {pt.comodo || 'sem cômodo'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted">
            {placingPointId ? 'Clique no croqui para posicionar.' : 'Selecione um ponto e clique no croqui para posicioná-lo.'}
          </p>
        </section>
      )}

      {/* Propriedades contextuais */}
      {selWall && (
        <section>
          <h3>{labelLine(selWall.kind)}</h3>
          <div className="field">
            <label>
              Comprimento <span className="val">{Math.round(wallLength(selWall.x1, selWall.y1, selWall.x2, selWall.y2) / 20)} qd</span>
            </label>
          </div>
          <p className="muted">Arraste as pontas no croqui para reposicionar.</p>
          <button className="panel-btn danger" onClick={deleteSelection}>
            <IconTrash size={15} /> Excluir {labelLine(selWall.kind).toLowerCase()}
          </button>
        </section>
      )}

      {selOpening && (
        <section>
          <h3>{labelOpening(selOpening.kind)}</h3>
          <div className="field">
            <label>
              Largura <span className="val">{Math.round(selOpening.width / 20)} qd</span>
            </label>
            <input
              type="range"
              min={20}
              max={200}
              step={5}
              value={selOpening.width}
              onChange={(e) => updateOpening(selOpening.id, { width: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>
              Posição na parede <span className="val">{Math.round(selOpening.t * 100)}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(selOpening.t * 100)}
              onChange={(e) => updateOpening(selOpening.id, { t: Number(e.target.value) / 100 })}
            />
          </div>
          {selOpening.kind === 'door' && (
            <button
              className="panel-btn"
              onClick={() => updateOpening(selOpening.id, { flip: !selOpening.flip })}
            >
              <IconFlipHorizontal size={15} /> Inverter abertura
            </button>
          )}
          <p className="muted">Ou arraste a abertura e suas alças direto na parede.</p>
          <button className="panel-btn danger" onClick={deleteSelection}>
            <IconTrash size={15} /> Excluir
          </button>
        </section>
      )}

      {showTraceControls && (
        <section>
          <h3>Traçado colorido</h3>
          <div className="field">
            <label>Cor</label>
            <div className="swatch-row">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${trColor.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setTr({ color: c })}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              Espessura <span className="val">{trWidth}</span>
            </label>
            <input type="range" min={2} max={28} value={trWidth} onChange={(e) => setTr({ width: Number(e.target.value) })} />
          </div>
          <label className="check-row">
            <input type="checkbox" checked={trDashed} onChange={(e) => setTr({ dashed: e.target.checked })} />
            Tracejado
          </label>
          {selTrace && (
            <button className="panel-btn danger" onClick={deleteSelection}>
              <IconTrash size={15} /> Excluir traçado
            </button>
          )}
          {!selTrace && <p className="muted">Clique a clique no croqui; botão direito encerra.</p>}
        </section>
      )}

      {selLabel && (
        <section>
          <h3>Texto livre</h3>
          <div className="field">
            <label>Texto</label>
            <textarea
              value={selLabel.text}
              autoFocus
              onChange={(e) => updateFreeLabel(selLabel.id, { text: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Cor</label>
            <div className="swatch-row">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${selLabel.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
                  style={{ background: c }}
                  onClick={() => updateFreeLabel(selLabel.id, { color: c })}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <label>
              Tamanho <span className="val">{selLabel.fontSize}</span>
            </label>
            <input
              type="range"
              min={8}
              max={48}
              value={selLabel.fontSize}
              onChange={(e) => updateFreeLabel(selLabel.id, { fontSize: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>
              Rotação <span className="val">{selLabel.rotation}°</span>
            </label>
            <input
              type="range"
              min={-90}
              max={90}
              value={selLabel.rotation}
              onChange={(e) => updateFreeLabel(selLabel.id, { rotation: Number(e.target.value) })}
            />
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={selLabel.bg !== false}
              onChange={(e) => updateFreeLabel(selLabel.id, { bg: e.target.checked })}
            />
            Caixa branca
          </label>
          <button className="panel-btn danger" onClick={deleteSelection}>
            <IconTrash size={15} /> Excluir texto
          </button>
        </section>
      )}

      {bg && !selection && tool === 'select' && (
        <section>
          <h3>Imagem de fundo</h3>
          <div className="field">
            <label>
              Opacidade <span className="val">{Math.round(bg.opacity * 100)}%</span>
            </label>
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(bg.opacity * 100)}
              onChange={(e) => updateFloorBg({ opacity: Number(e.target.value) / 100 })}
            />
          </div>
          <div className="field">
            <label>Escala</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => updateFloorBg({ scale: bg.scale / 1.15 })}>
                −
              </button>
              <button className="panel-btn" style={{ flex: 1 }} onClick={() => updateFloorBg({ scale: bg.scale * 1.15 })}>
                +
              </button>
            </div>
          </div>
          <button className="panel-btn" onClick={() => updateFloorBg({ locked: !bg.locked })}>
            {bg.locked ? <IconLock size={15} /> : <IconLockOpen size={15} />}
            {bg.locked ? 'Travada (destravar p/ mover)' : 'Destravada (arraste p/ mover)'}
          </button>
          <button
            className="panel-btn danger"
            onClick={() => {
              if (confirm('Remover a imagem de fundo deste pavimento?')) setFloorBg(null);
            }}
          >
            <IconTrash size={15} /> Remover fundo
          </button>
        </section>
      )}

      {selRoom && (
        <section>
          <h3>Cômodo</h3>
          <div className="field">
            <label>Nome</label>
            <input
              type="text"
              value={selRoom.nome}
              autoFocus
              onChange={(e) => updateRoom(selRoom.id, { nome: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              Tamanho do texto <span className="val">{selRoom.fontSize ?? 13}</span>
            </label>
            <input
              type="range"
              min={8}
              max={32}
              value={selRoom.fontSize ?? 13}
              onChange={(e) => updateRoom(selRoom.id, { fontSize: Number(e.target.value) })}
            />
          </div>
          <button
            className="panel-btn"
            onClick={() => setAllRoomFonts(selRoom.fontSize ?? 13)}
          >
            Aplicar tamanho a todos os cômodos
          </button>
          <button className="panel-btn danger" onClick={deleteSelection}>
            <IconTrash size={15} /> Excluir rótulo
          </button>
        </section>
      )}

      {selPoint && (
        <section>
          <h3>
            Ponto {prefixOf(curType, project)}
            {selPoint.numero}
          </h3>
          <div className="field">
            <label>Cômodo</label>
            <input
              type="text"
              list="comodos-list"
              value={selPoint.comodo}
              placeholder="Escolha ou digite"
              onChange={(e) => updatePoint(selPoint.id, { comodo: e.target.value })}
            />
            <datalist id="comodos-list">
              {comodos.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>Descrição</label>
            <textarea
              value={selPoint.descricao}
              placeholder="Ex.: Fissura na alvenaria"
              onChange={(e) => updatePoint(selPoint.id, { descricao: e.target.value })}
            />
          </div>
          {selPoint.floorId && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={selPoint.lx != null}
                onChange={(e) =>
                  e.target.checked
                    ? updatePoint(selPoint.id, { lx: selPoint.x + 50, ly: selPoint.y - 40 })
                    : updatePoint(selPoint.id, { lx: undefined, ly: undefined })
                }
              />
              Linha de chamada (rótulo afastado)
            </label>
          )}
          <div className="field">
            <label>
              Tamanho no croqui <span className="val">{croquiPointSize}</span>
            </label>
            <input
              type="range"
              min={10}
              max={48}
              value={croquiPointSize}
              onChange={(e) => setCroquiPointSize(Number(e.target.value))}
            />
          </div>
          <p className="muted">O tamanho do pino vale para todos os pontos do croqui.</p>
          <button className="panel-btn danger" onClick={deleteSelection}>
            <IconTrash size={15} /> Excluir ponto
          </button>
        </section>
      )}

      {!selection && tool !== 'point' && (tool === 'door' || tool === 'window' || tool === 'stairs') && (
        <section>
          <h3>{labelOpening(tool)} — padrão</h3>
          <div className="field">
            <label>
              Largura <span className="val">{Math.round(openingWidth / 20)} qd</span>
            </label>
            <input
              type="range"
              min={20}
              max={200}
              step={5}
              value={openingWidth}
              onChange={(e) => setOpeningWidth(Number(e.target.value))}
            />
          </div>
          <p className="muted">Clique sobre uma parede para inserir.</p>
        </section>
      )}

      {!selection && tool === 'select' && (
        <section>
          <p className="empty">
            Selecione um elemento no croqui para editar suas propriedades, ou escolha uma ferramenta
            na barra à esquerda.
          </p>
        </section>
      )}

      {/* Local (cor) — visível ao colocar/editar ponto */}
      {showPointControls && (
        <section>
          <h3>
            Local <span style={{ fontWeight: 400, color: 'var(--ink-faint)' }}>(cor)</span>
          </h3>
          <div className="seg">
            {LOCALS.map((l) => (
              <button
                key={l}
                className={curLocal === l ? 'active' : ''}
                style={{ color: curLocal === l ? LOCAL_COLORS[l] : undefined }}
                onClick={() => setLocal(l)}
              >
                <span className="dot" style={{ background: LOCAL_COLORS[l] }} />
                {LOCAL_LABEL[l]}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Tipo (prefixo) */}
      {showPointControls && (
        <section>
          <h3>
            Tipo <span style={{ fontWeight: 400, color: 'var(--ink-faint)' }}>(prefixo)</span>
          </h3>
          <div className="type-list">
            {project.anomalyTypes.map((t) => (
              <div
                key={t.id}
                className={`type-row${curType === t.id ? ' active' : ''}`}
                onClick={() => setType(t.id)}
              >
                <span className="prefix">{t.prefix}</span>
                <span style={{ flex: 1 }}>{t.nome}</span>
              </div>
            ))}
          </div>
          <button className="panel-btn" onClick={novoTipo}>
            <IconPlus size={15} /> Novo tipo
          </button>
          <p className="muted">Numeração contínua por tipo no imóvel inteiro.</p>
        </section>
      )}
    </div>
  );
}

function labelLine(kind?: string): string {
  if (kind === 'projection') return 'Projeção';
  if (kind === 'limit') return 'Limite';
  return 'Parede';
}

function labelOpening(kind: string): string {
  if (kind === 'door') return 'Porta';
  if (kind === 'window') return 'Janela';
  if (kind === 'stairs') return 'Escada';
  return 'Abertura';
}

function prefixOf(typeId: string, project: { anomalyTypes: { id: string; prefix: string }[] }): string {
  return project.anomalyTypes.find((t) => t.id === typeId)?.prefix ?? '';
}
