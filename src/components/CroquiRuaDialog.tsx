import { useEffect, useMemo, useState } from 'react';
import { IconX, IconSearch, IconDownload, IconLayersSubtract } from '@tabler/icons-react';
import { useStore } from '../store';
import { putBg } from '../db';
import {
  baixarOsm,
  desenhar,
  lerCoordenada,
  montarQuadra,
  svgParaPng,
  vistaQuadra,
  vistaRua,
  type DadosOsm,
} from '../croquiRua';
import { baixarSatelite } from '../satelite';

// 1 m do terreno = 10 unidades do croqui (o pino padrão fica com cerca de 2 m).
const UNID_POR_METRO = 10;

type Modo = 'unico' | 'porRua';

function baixar(blob: Blob, nome: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function CroquiRuaDialog({ onClose }: { onClose: () => void }) {
  const projectNome = useStore((s) => s.project.nome);
  const ensureFloor = useStore((s) => s.ensureFloor);
  const setBgOf = useStore((s) => s.setBgOf);
  const setActiveFloor = useStore((s) => s.setActiveFloor);
  const setView = useStore((s) => s.setView);

  const [coord, setCoord] = useState('');
  const [ponto, setPonto] = useState<{ lat: number; lon: number } | null>(null);
  const [dados, setDados] = useState<DadosOsm | null>(null);
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [fora, setFora] = useState<Set<string>>(new Set()); // ruas desmarcadas
  const [modo, setModo] = useState<Modo>('unico');
  const [margem, setMargem] = useState(30);
  const [comSatelite, setComSatelite] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const { quadra, erroQuadra } = useMemo(() => {
    if (!dados) return { quadra: null, erroQuadra: null };
    try {
      return { quadra: montarQuadra(dados, larguras), erroQuadra: null };
    } catch (e) {
      return { quadra: null, erroQuadra: (e as Error).message };
    }
  }, [dados, larguras]);

  // prévia: a quadra inteira, como vai ficar no croqui único
  const geral = useMemo(() => {
    if (!quadra) return null;
    const v = vistaQuadra(quadra, margem);
    return { v, svg: desenhar(quadra, v, null, { edificacoes: false }) };
  }, [quadra, margem]);

  const [previa, setPrevia] = useState<string | null>(null);
  useEffect(() => {
    if (!geral) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([geral.svg], { type: 'image/svg+xml;charset=utf-8' }));
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [geral]);

  async function buscar() {
    const c = lerCoordenada(coord);
    if (!c) {
      setErro('Cole a coordenada no formato do Google Maps: latitude, longitude (ex.: -26.992929, -48.634695).');
      return;
    }
    setErro(null);
    setBusy('Buscando a quadra no OpenStreetMap…');
    try {
      setDados(await baixarOsm(c.lat, c.lon));
      setPonto(c);
      setLarguras({});
      setFora(new Set());
    } catch (e) {
      setDados(null);
      setErro((e as Error).message || 'Não foi possível consultar o OpenStreetMap. Confira a internet.');
    } finally {
      setBusy(null);
    }
  }

  const escolhidas = quadra ? quadra.ruas.filter((r) => !fora.has(r.nome)) : [];

  // Croqui único: um desenho só (na primeira camada) e uma camada por rua, como grupo.
  async function criarUnico() {
    if (!quadra || !geral || !ponto || escolhidas.length === 0) return;
    const st0 = useStore.getState();
    const temDesenho = st0.project.floors.some((f) => f.bg);
    if (
      temDesenho &&
      !confirm('As imagens de fundo atuais das camadas serão trocadas por um croqui único da quadra. Continuar?')
    )
      return;
    try {
      setBusy('Desenhando a quadra…');
      const v = geral.v;
      const png = await svgParaPng(geral.svg, v.W, v.H);
      const ids = escolhidas.map((r) => ensureFloor(r.nome));
      const geo = { lat: ponto.lat, lon: ponto.lon, cx: v.cx, cy: v.cy, rot: v.rot, larg: v.larg, alt: v.alt };
      useStore.getState().setCroquiUnico(geo);
      const base = useStore.getState().project.floors[0].id;
      const escala = UNID_POR_METRO / v.s;
      await putBg(base, png);
      let sat: { blob: Blob; w: number; h: number } | null = null;
      if (comSatelite) {
        try {
          sat = await baixarSatelite(geo, setBusy);
        } catch (e) {
          alert(`O croqui foi criado, mas sem a imagem de satélite: ${(e as Error).message}`);
        }
      }
      setBgOf(base, {
        x: 0,
        y: 0,
        w: v.W,
        h: v.H,
        scale: escala,
        opacity: sat ? 0.6 : 1,
        locked: true,
        rev: Date.now(),
      });
      if (sat) {
        await putBg(`${base}_sat`, sat.blob);
        useStore.getState().setSat({
          x: 0,
          y: 0,
          w: sat.w,
          h: sat.h,
          scale: (v.W * escala) / sat.w,
          opacity: 1,
          locked: true,
          rev: Date.now() + 1,
        });
      } else if (useStore.getState().activeFloor().sat) {
        useStore.getState().setSat(null);
      }
      setActiveFloor(ids[0]);
      setView({ tx: 30, ty: 30, scale: 0.45 });
      onClose();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Uma base por rua: cada camada com o seu desenho (rua na horizontal).
  async function criarPorRua() {
    if (!quadra || escolhidas.length === 0) return;
    const st = useStore.getState();
    if (st.project.croquiUnico) {
      setErro('Este projeto usa o croqui único da quadra. Para uma base por rua, crie outro projeto.');
      return;
    }
    const comFundo = escolhidas.filter((r) =>
      st.project.floors.some((f) => f.nome.trim().toLowerCase() === r.nome.toLowerCase() && f.bg),
    );
    if (
      comFundo.length &&
      !confirm(`${comFundo.map((r) => r.nome).join(', ')} já tem imagem de fundo, que será trocada. Continuar?`)
    )
      return;
    try {
      let primeira: string | null = null;
      for (let i = 0; i < escolhidas.length; i++) {
        const r = escolhidas[i];
        setBusy(`Desenhando ${r.nome} (${i + 1}/${escolhidas.length})…`);
        const v = vistaRua(quadra, r.nome, margem + 4);
        const png = await svgParaPng(desenhar(quadra, v, r.nome, { edificacoes: false }), v.W, v.H);
        const id = ensureFloor(r.nome);
        await putBg(id, png);
        setBgOf(id, { x: 0, y: 0, w: v.W, h: v.H, scale: UNID_POR_METRO / v.s, opacity: 1, locked: true, rev: Date.now() + i });
        primeira ??= id;
      }
      if (primeira) setActiveFloor(primeira);
      setView({ tx: 30, ty: 30, scale: 0.6 });
      onClose();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function baixarDesenho() {
    if (!geral) return;
    setBusy('Gerando a imagem…');
    try {
      baixar(await svgParaPng(geral.svg, geral.v.W, geral.v.H), `${projectNome || 'croqui'} - Quadra.png`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="picker-overlay" onClick={busy ? undefined : onClose}>
      <div className="picker rua-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <div>
            <div className="picker-title">Croqui de rua</div>
            <div className="picker-sub" style={{ fontFamily: 'inherit' }}>
              Desenha a quadra da obra e separa a vistoria por rua
            </div>
          </div>
          <button className="vt-close" onClick={onClose} aria-label="Fechar" disabled={!!busy}>
            <IconX size={20} />
          </button>
        </div>

        <div className="picker-body rua-body">
          <div className="field">
            <label>Coordenada de um ponto dentro da quadra da obra</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={coord}
                autoFocus
                placeholder="-26.992929, -48.634695"
                onChange={(e) => setCoord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && buscar()}
                style={{ flex: 1 }}
              />
              <button className="icon-btn" onClick={buscar} disabled={!!busy}>
                <IconSearch size={15} /> Buscar quadra
              </button>
            </div>
            <p className="muted">
              No Google Maps, clique com o botão direito dentro da quadra e clique na coordenada para copiar. O
              sistema consulta o OpenStreetMap nesse ponto.
            </p>
          </div>

          {(erro || erroQuadra) && <div className="tbl-warn">{erro || erroQuadra}</div>}

          {quadra && (
            <div className="rua-cols">
              <div className="rua-previa">{previa && <img src={previa} alt="Desenho da quadra" />}</div>
              <div className="rua-opcoes">
                <h3>Ruas em volta da quadra</h3>
                {quadra.ruas.map((r) => (
                  <div key={r.nome} className="rua-linha">
                    <label className="check-row" style={{ flex: 1, margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={!fora.has(r.nome)}
                        onChange={(e) => {
                          const n = new Set(fora);
                          if (e.target.checked) n.delete(r.nome);
                          else n.add(r.nome);
                          setFora(n);
                        }}
                      />
                      {r.nome}
                      <span className="muted2">{Math.round(r.comprimento)} m</span>
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={30}
                      step={0.5}
                      value={r.largura}
                      title="Largura da pista, em metros"
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (n >= 3 && n <= 30) setLarguras({ ...larguras, [r.nome]: n });
                      }}
                    />
                    <span className="muted2">m</span>
                  </div>
                ))}
                <p className="muted">
                  A largura da pista é estimada pelo tipo da via. Ajuste se souber a medida; as calçadas ficam com
                  2,5 m.
                </p>
                <div className="field">
                  <label>
                    Entorno desenhado em volta da quadra <span className="val">{margem} m</span>
                  </label>
                  <input type="range" min={15} max={60} step={1} value={margem} onChange={(e) => setMargem(Number(e.target.value))} />
                </div>

                <div className="seg" style={{ marginBottom: 8 }}>
                  <button className={modo === 'unico' ? 'active' : ''} onClick={() => setModo('unico')}>
                    Croqui único
                  </button>
                  <button className={modo === 'porRua' ? 'active' : ''} onClick={() => setModo('porRua')}>
                    Uma base por rua
                  </button>
                </div>

                {modo === 'unico' ? (
                  <>
                    <label className="check-row">
                      <input type="checkbox" checked={comSatelite} onChange={(e) => setComSatelite(e.target.checked)} />
                      Baixar a imagem de satélite, já alinhada
                    </label>
                    <button className="panel-btn primary" onClick={criarUnico} disabled={!!busy || escolhidas.length === 0}>
                      <IconLayersSubtract size={15} /> Criar o croqui único
                    </button>
                    <p className="muted">
                      Um desenho só, com a quadra inteira. Cada rua marcada vira um grupo: recebe a sua pasta de fotos
                      e os pontos ficam registrados nela, mesmo aparecendo todos no mesmo croqui.
                    </p>
                  </>
                ) : (
                  <>
                    <button className="panel-btn primary" onClick={criarPorRua} disabled={!!busy || escolhidas.length === 0}>
                      <IconLayersSubtract size={15} /> Criar {escolhidas.length} camada{escolhidas.length === 1 ? '' : 's'} com a base
                    </button>
                    <p className="muted">
                      Cada rua vira uma camada com desenho próprio, girado para a rua ficar na horizontal.
                    </p>
                  </>
                )}
                <button className="panel-btn" onClick={baixarDesenho} disabled={!!busy}>
                  <IconDownload size={15} /> Baixar o desenho da quadra (PNG)
                </button>
              </div>
            </div>
          )}

          {busy && <p className="muted">{busy}</p>}
        </div>
      </div>
    </div>
  );
}
