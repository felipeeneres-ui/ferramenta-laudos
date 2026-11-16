/* eslint-disable @typescript-eslint/no-explicit-any */
// Gerador de croqui de rua: a partir de uma coordenada, busca a quadra no
// OpenStreetMap e desenha a planta de situação e uma base por rua (rua na
// horizontal), para servir de fundo das camadas em vistoria feita na rua.
//
// Linguagem visual: prancha técnica. Pista em branco (é onde entram os pinos),
// quadras em cinza-ardósia claro, meio-fio em traço fino, eixo da rua vistoriada
// em traço-ponto e a quadra da obra vazia, só com hachura âmbar.
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import LineMerger from 'jsts/org/locationtech/jts/operation/linemerge/LineMerger.js';
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js';
import BufferParameters from 'jsts/org/locationtech/jts/operation/buffer/BufferParameters.js';
import DouglasPeuckerSimplifier from 'jsts/org/locationtech/jts/simplify/DouglasPeuckerSimplifier.js';
import 'jsts/org/locationtech/jts/monkey.js';

type Geo = any;
interface P {
  x: number;
  y: number;
}

const gf: any = new GeometryFactory();
const CAP_ROUND = 1;
const CAP_FLAT = 2;
const CAP_SQUARE = 3;
const JOIN_ROUND = 1;
const JOIN_MITRE = 2;

// largura estimada da pista (m) por classe de via do OpenStreetMap
export const LARG_PISTA: Record<string, number> = {
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 9,
  residential: 7,
  unclassified: 7,
  living_street: 6,
  pedestrian: 5,
};
const CALCADA = 2.5;
const RAIO_ESQUINA = 3;

// paleta CRAFT: azul-marinho, ardósia e âmbar
const NAVY = '#0F1E3C';
const ARDOSIA = '#46536B';
const C_PISTA = '#FFFFFF';
const C_PISTA_SEL = '#DDE7F6';
const C_CALCADA = '#F6F7F9';
const C_MEIO_FIO = '#B9C0CB';
const C_QUADRA = '#ECEFF3';
const C_QUADRA_L = '#AAB2BF';
const C_EDIF = '#DFE3E9';
const C_EDIF_L = '#A3ABB8';
const C_OBRA = '#FFF5DA';
const C_OBRA_L = '#C9982B';
const FONTE = "Bahnschrift, 'DIN Alternate', 'Arial Narrow', Arial, sans-serif";

// ---------- geometria ----------

const linha = (pts: P[]): Geo => gf.createLineString(pts.map((p) => new Coordinate(p.x, p.y)));
function poligono(pts: P[]): Geo {
  const cs = pts.map((p) => new Coordinate(p.x, p.y));
  const a = cs[0];
  const b = cs[cs.length - 1];
  if (a.x !== b.x || a.y !== b.y) cs.push(new Coordinate(a.x, a.y));
  return gf.createPolygon(gf.createLinearRing(cs), []);
}
const buf = (g: Geo, d: number, cap = CAP_ROUND, join = JOIN_ROUND): Geo =>
  BufferOp.bufferOp(g, d, new BufferParameters(8, cap, join, 5));
const uniao = (gs: Geo[]): Geo => gf.createGeometryCollection(gs).union();
const coords = (g: Geo): P[] => g.getCoordinates().map((c: any) => ({ x: c.x, y: c.y }));

function partes(g: Geo, tipo: 'Polygon' | 'LineString'): Geo[] {
  if (!g || g.isEmpty()) return [];
  if (g.getGeometryType() === tipo) return [g];
  const out: Geo[] = [];
  const n = g.getNumGeometries();
  if (n > 1 || g.getGeometryType().startsWith('Multi') || g.getGeometryType() === 'GeometryCollection')
    for (let i = 0; i < n; i++) out.push(...partes(g.getGeometryN(i), tipo));
  return out;
}
// arredonda as esquinas (cantos salientes)
const arredondar = (g: Geo, r: number): Geo => buf(buf(g, -r), r);

function juntarLinhas(gs: Geo[]): Geo[] {
  const lm = new LineMerger();
  for (const g of gs) lm.add(g);
  return lm.getMergedLineStrings().toArray();
}

// ponto a uma distância `d` ao longo da linha
function aoLongo(pts: P[], d: number): P {
  let rest = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (rest <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, rest / seg);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    rest -= seg;
  }
  return pts[pts.length - 1];
}

// ---------- dados do OpenStreetMap ----------

interface Via {
  classe: string;
  nome: string | null;
  geom: Geo;
}

export interface DadosOsm {
  vias: { classe: string; nome: string | null; pts: P[] }[];
  edifs: P[][];
}

export interface RuaDaQuadra {
  nome: string;
  classe: string;
  comprimento: number; // m, trecho junto à quadra
  largura: number; // m, pista
}

export interface Quadra {
  vias: Via[];
  edifs: Geo[];
  quadra: Geo;
  borda: Geo;
  pistas: Geo;
  faixas: Geo;
  ruas: RuaDaQuadra[];
  larguras: Record<string, number>;
}

// Lê "lat, lon" como o Google Maps copia (ex.: -26.992929, -48.634695).
export function lerCoordenada(txt: string): { lat: number; lon: number } | null {
  const m = txt.match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Baixa ruas e edificações num raio em volta do ponto (API pública do OpenStreetMap).
export async function baixarOsm(lat: number, lon: number, raio = 260): Promise<DadosOsm> {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320;
  const ky = 110574;
  const dLon = raio / kx;
  const dLat = raio / ky;
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(',');
  const resp = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`);
  if (!resp.ok) throw new Error(`O OpenStreetMap não respondeu (erro ${resp.status}). Tente de novo em instantes.`);
  const data = (await resp.json()) as { elements: any[] };
  const nos = new Map<number, P>();
  for (const e of data.elements)
    if (e.type === 'node') nos.set(e.id, { x: (e.lon - lon) * kx, y: (e.lat - lat) * ky });
  const out: DadosOsm = { vias: [], edifs: [] };
  for (const e of data.elements) {
    if (e.type !== 'way' || !e.tags) continue;
    const pts = (e.nodes as number[]).map((n) => nos.get(n)).filter(Boolean) as P[];
    if (pts.length !== e.nodes.length) continue;
    if (e.tags.highway in LARG_PISTA && pts.length >= 2)
      out.vias.push({ classe: e.tags.highway, nome: e.tags.name ?? null, pts });
    else if (e.tags.building && pts.length >= 4) out.edifs.push(pts);
  }
  return out;
}

// Monta a quadra que contém o ponto (origem) e as ruas que a contornam.
export function montarQuadra(dados: DadosOsm, larguras: Record<string, number> = {}): Quadra {
  const vias: Via[] = dados.vias.map((v) => ({ classe: v.classe, nome: v.nome, geom: linha(v.pts) }));
  if (vias.length === 0) throw new Error('Não há ruas mapeadas perto desse ponto no OpenStreetMap.');
  const larg = (v: Via) => (v.nome && larguras[v.nome]) || LARG_PISTA[v.classe];

  const pz = new Polygonizer();
  pz.add(uniao(vias.map((v) => v.geom)));
  const origem = gf.createPoint(new Coordinate(0, 0));
  const quadra = (pz.getPolygons().toArray() as Geo[]).find((b) => b.contains(origem));
  if (!quadra)
    throw new Error('Não encontrei uma quadra fechada em volta desse ponto. Confira se a coordenada cai dentro da quadra.');
  const borda = quadra.getExteriorRing();
  const perto = buf(borda, 0.5);

  const edifs: Geo[] = [];
  for (const pts of dados.edifs) {
    try {
      let pg = poligono(pts);
      if (!pg.isValid()) pg = buf(pg, 0);
      edifs.push(...partes(pg, 'Polygon'));
    } catch {
      /* contorno inválido: ignora */
    }
  }

  const porNome = new Map<string, { classe: string; comp: number }>();
  for (const v of vias) {
    if (!v.nome) continue;
    const comp = v.geom.intersection(perto).getLength();
    if (comp < 5) continue;
    const cur = porNome.get(v.nome);
    porNome.set(v.nome, { classe: v.classe, comp: (cur?.comp ?? 0) + comp });
  }
  const ruas: RuaDaQuadra[] = Array.from(porNome.entries())
    .map(([nome, r]) => ({
      nome,
      classe: r.classe,
      comprimento: r.comp,
      largura: larguras[nome] || LARG_PISTA[r.classe],
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { numeric: true }));
  if (ruas.length === 0) throw new Error('As ruas em volta dessa quadra não têm nome no OpenStreetMap.');

  return {
    vias,
    edifs,
    quadra,
    borda,
    pistas: uniao(vias.map((v) => buf(v.geom, larg(v) / 2))),
    faixas: uniao(vias.map((v) => buf(v.geom, larg(v) / 2 + CALCADA))),
    ruas,
    larguras,
  };
}

// Trecho do eixo da rua que faz divisa com a quadra.
function trechoDaRua(q: Quadra, nome: string): Geo {
  const perto = buf(q.borda, 0.5);
  const segs: Geo[] = [];
  for (const v of q.vias)
    if (v.nome === nome)
      segs.push(...partes(v.geom.intersection(perto), 'LineString').filter((g) => g.getLength() > 1));
  if (segs.length === 1) return segs[0];
  const m = juntarLinhas(segs);
  return m.reduce((a, b) => (b.getLength() > a.getLength() ? b : a));
}

// ---------- vista (janela do desenho) ----------

export interface Vista {
  cx: number;
  cy: number;
  rot: number; // graus, anti-horário
  larg: number; // m
  alt: number; // m
  s: number; // px por metro
  W: number;
  H: number;
}

function vista(cx: number, cy: number, rot: number, larg: number, alt: number, s: number): Vista {
  return { cx, cy, rot, larg, alt, s, W: Math.round(larg * s), H: Math.round(alt * s) };
}

function areaDaVista(v: Vista): Geo {
  const a = (v.rot * Math.PI) / 180;
  const c = [
    [-v.larg / 2, -v.alt / 2],
    [v.larg / 2, -v.alt / 2],
    [v.larg / 2, v.alt / 2],
    [-v.larg / 2, v.alt / 2],
  ].map(([x, y]) => ({ x: v.cx + x * Math.cos(a) - y * Math.sin(a), y: v.cy + x * Math.sin(a) + y * Math.cos(a) }));
  return poligono(c);
}

export function vistaSituacao(q: Quadra, margem = 70): Vista {
  const env = q.quadra.getEnvelopeInternal();
  const larg = env.getMaxX() - env.getMinX() + 2 * margem;
  const alt = env.getMaxY() - env.getMinY() + 2 * margem;
  const s = Math.min(10, 2600 / Math.max(larg, alt));
  return vista((env.getMinX() + env.getMaxX()) / 2, (env.getMinY() + env.getMaxY()) / 2, 0, larg, alt, s);
}

// Quadra inteira, alinhada à folha (ruas na horizontal e na vertical), no giro
// mais próximo do norte para cima.
export function vistaQuadra(q: Quadra, margem = 30, s = 20): Vista {
  // direção do lado mais comprido da quadra
  const maior = q.ruas.reduce((a, b) => (b.comprimento > a.comprimento ? b : a));
  const pts = coords(trechoDaRua(q, maior.nome));
  const a = pts[0];
  const b = pts[pts.length - 1];
  let rot = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  // dos 4 giros que alinham a quadra, fica o de menor inclinação (norte mais perto de cima)
  rot = ((((rot + 45) % 90) + 90) % 90) - 45;
  const ar = (-rot * Math.PI) / 180;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of coords(q.quadra.getExteriorRing())) {
    const x = p.x * Math.cos(ar) - p.y * Math.sin(ar);
    const y = p.x * Math.sin(ar) + p.y * Math.cos(ar);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // centro da caixa, de volta para as coordenadas do terreno
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const av = (rot * Math.PI) / 180;
  const cx = mx * Math.cos(av) - my * Math.sin(av);
  const cy = mx * Math.sin(av) + my * Math.cos(av);
  const larg = maxX - minX + 2 * margem;
  const alt = maxY - minY + 2 * margem;
  return vista(cx, cy, rot, larg, alt, Math.min(s, 4200 / Math.max(larg, alt)));
}

// Rua na horizontal, com o norte apontando para a metade de cima do desenho.
export function vistaRua(q: Quadra, nome: string, fundo = 34, folga = 16, s = 20): Vista {
  const pts = coords(trechoDaRua(q, nome));
  const a = pts[0];
  const b = pts[pts.length - 1];
  let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (Math.cos(((90 - ang) * Math.PI) / 180) < 0) ang += 180;
  const comp = Math.hypot(b.x - a.x, b.y - a.y);
  return vista((a.x + b.x) / 2, (a.y + b.y) / 2, ang, comp + 2 * folga, 2 * fundo, s);
}

// ---------- desenho (SVG) ----------

export function desenhar(
  q: Quadra,
  v: Vista,
  destaque: string | null = null,
  opcoes: { edificacoes?: boolean } = {},
): string {
  const s = v.s;
  const ar = (-v.rot * Math.PI) / 180;
  const pt = (p: P): [number, number] => {
    const dx = p.x - v.cx;
    const dy = p.y - v.cy;
    return [
      (dx * Math.cos(ar) - dy * Math.sin(ar) + v.larg / 2) * s,
      (v.alt / 2 - (dx * Math.sin(ar) + dy * Math.cos(ar))) * s,
    ];
  };
  const f = (n: number) => n.toFixed(1);
  const path = (pts: P[], fechar = false) =>
    pts.map((p, i) => (i === 0 ? 'M' : 'L') + pt(p).map(f).join(' ')).join(' ') + (fechar ? ' Z' : '');
  const poly = (g: Geo) =>
    partes(g, 'Polygon')
      .map((pg) => {
        let d = path(coords(pg.getExteriorRing()), true);
        for (let i = 0; i < pg.getNumInteriorRing(); i++) d += ' ' + path(coords(pg.getInteriorRingN(i)), true);
        return d;
      })
      .join(' ');

  const fino = Math.max(1, 0.07 * s);
  const area = areaDaVista(v);
  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${v.W}" height="${v.H}" viewBox="0 0 ${v.W} ${v.H}" font-family="${FONTE}">`,
  );
  const passo = 1.6 * s;
  o.push(
    `<defs><pattern id="hachura" width="${f(passo)}" height="${f(passo)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
      `<line x1="0" y1="0" x2="0" y2="${f(passo)}" stroke="${C_OBRA_L}" stroke-width="${f(Math.max(1, 0.09 * s))}" opacity="0.55"/></pattern></defs>`,
  );
  o.push(`<rect width="${v.W}" height="${v.H}" fill="${C_PISTA}"/>`);

  const janela = buf(area, 12, CAP_ROUND, JOIN_MITRE);
  // calçadas: tudo que não é pista, com as esquinas arredondadas; o contorno é o meio-fio
  const calc = arredondar(janela.difference(q.pistas), RAIO_ESQUINA);
  o.push(`<path d="${poly(calc)}" fill="${C_CALCADA}" stroke="${C_MEIO_FIO}" stroke-width="${f(fino)}" fill-rule="evenodd"/>`);
  // quadras (alinhamento dos lotes)
  const lotes = partes(arredondar(janela.difference(q.faixas), RAIO_ESQUINA * 0.6), 'Polygon');
  // a quadra da obra pode aparecer só em parte na janela: reconhece pelo miolo, não pelo ponto
  const daObra = (pg: Geo) => q.quadra.contains(pg.getInteriorPoint());
  for (const pg of lotes)
    if (!daObra(pg))
      o.push(`<path d="${poly(pg)}" fill="${C_QUADRA}" stroke="${C_QUADRA_L}" stroke-width="${f(fino)}" fill-rule="evenodd"/>`);
  // edificações do entorno (a quadra da obra fica vazia)
  for (const pg of opcoes.edificacoes === false ? [] : q.edifs)
    if (pg.intersects(area) && !q.quadra.contains(pg.getCentroid()))
      o.push(`<path d="${poly(pg)}" fill="${C_EDIF}" stroke="${C_EDIF_L}" stroke-width="${f(fino)}" stroke-linejoin="round"/>`);
  // quadra da obra: vazia, com hachura
  for (const pg of lotes) {
    if (!daObra(pg)) continue;
    const d = poly(pg);
    o.push(`<path d="${d}" fill="${C_OBRA}"/>`);
    o.push(`<path d="${d}" fill="url(#hachura)"/>`);
    o.push(`<path d="${d}" fill="none" stroke="${C_OBRA_L}" stroke-width="${f(Math.max(1.5, 0.16 * s))}" stroke-linejoin="round"/>`);
  }

  // trechos vistoriados: pista em azul claro e eixo em traço-ponto
  const sel = q.ruas.map((r) => r.nome).filter((n) => destaque === null || destaque === n);
  const trechos = new Map<string, Geo>();
  for (const nome of sel) trechos.set(nome, DouglasPeuckerSimplifier.simplify(trechoDaRua(q, nome), 0.8));
  const faixas = sel.map((nome) => {
    const larg = q.ruas.find((r) => r.nome === nome)!.largura;
    return buf(trechos.get(nome), larg / 2, destaque === null ? CAP_SQUARE : CAP_FLAT, JOIN_MITRE);
  });
  if (faixas.length) o.push(`<path d="${poly(uniao(faixas))}" fill="${C_PISTA_SEL}" fill-rule="evenodd"/>`);
  for (const nome of sel)
    o.push(
      `<path d="${path(coords(trechos.get(nome)))}" fill="none" stroke="${NAVY}" stroke-width="${f(Math.max(1, 0.08 * s))}" ` +
        `stroke-dasharray="${f(2.4 * s)} ${f(0.7 * s)} ${f(0.35 * s)} ${f(0.7 * s)}" opacity="0.55"/>`,
    );

  // nomes das ruas
  const interior = buf(area, -2, CAP_ROUND, JOIN_MITRE);
  const porNome = new Map<string, Geo[]>();
  for (const via of q.vias)
    if (via.nome && via.geom.intersects(area)) porNome.set(via.nome, [...(porNome.get(via.nome) ?? []), via.geom]);
  for (const [nome, lst] of porNome) {
    const forte = sel.includes(nome);
    const daQuadra = q.ruas.some((r) => r.nome === nome);
    const fs = (forte ? 3.3 : 2.5) * s;
    const largTxt = (nome.length * fs * 0.62) / s;
    for (const peca of juntarLinhas(lst).flatMap((m) => partes(m.intersection(interior), 'LineString'))) {
      let alvo = peca;
      if (daQuadra) {
        const cand = partes(trechoDaRua(q, nome).intersection(interior), 'LineString').filter((g) => g.getLength() > 15);
        if (cand.length) alvo = cand.reduce((a, b) => (b.getLength() > a.getLength() ? b : a));
      }
      const comp = alvo.getLength();
      if (comp < largTxt + 4) continue;
      const pts = coords(alvo);
      const mid = pt(aoLongo(pts, comp / 2));
      const p1 = pt(aoLongo(pts, comp / 2 - 3));
      const p2 = pt(aoLongo(pts, comp / 2 + 3));
      let ang = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      else if (ang < -90) ang += 180;
      o.push(
        `<text x="${f(mid[0])}" y="${f(mid[1])}" transform="rotate(${f(ang)} ${f(mid[0])} ${f(mid[1])})" text-anchor="middle" dominant-baseline="central" ` +
          `font-size="${f(fs)}" font-weight="${forte ? 700 : 400}" fill="${forte ? NAVY : ARDOSIA}" ` +
          `stroke="${forte ? C_PISTA_SEL : C_PISTA}" stroke-width="${f(fs * 0.28)}" stroke-linejoin="round" paint-order="stroke" ` +
          `letter-spacing="${f(fs * 0.1)}">${esc(nome.toUpperCase())}</text>`,
      );
      if (daQuadra) break;
    }
  }

  // norte: seta de prancha, metade cheia e metade vazada
  const m = 6.5 * s;
  const nx = v.W - m;
  const ny = m;
  const ux = -Math.sin(ar);
  const uy = -Math.cos(ar);
  const lx = -uy;
  const ly = ux;
  const L = 3.6 * s;
  const asa = 1.5 * s;
  const tip = [nx + ux * L, ny + uy * L];
  const pe = [nx - ux * L * 0.55, ny - uy * L * 0.55];
  const e = [nx - ux * L + lx * asa, ny - uy * L + ly * asa];
  const dd = [nx - ux * L - lx * asa, ny - uy * L - ly * asa];
  const tr = f(Math.max(1, 0.1 * s));
  o.push(`<circle cx="${f(nx)}" cy="${f(ny)}" r="${f(5.2 * s)}" fill="#ffffff" stroke="${NAVY}" stroke-width="${tr}"/>`);
  o.push(`<path d="M${f(tip[0])} ${f(tip[1])} L${f(e[0])} ${f(e[1])} L${f(pe[0])} ${f(pe[1])} Z" fill="${NAVY}" stroke="${NAVY}" stroke-width="${tr}" stroke-linejoin="round"/>`);
  o.push(`<path d="M${f(tip[0])} ${f(tip[1])} L${f(dd[0])} ${f(dd[1])} L${f(pe[0])} ${f(pe[1])} Z" fill="#ffffff" stroke="${NAVY}" stroke-width="${tr}" stroke-linejoin="round"/>`);
  o.push(
    `<text x="${f(nx)}" y="${f(ny + 7.6 * s)}" text-anchor="middle" dominant-baseline="central" font-size="${f(2.3 * s)}" font-weight="700" fill="${NAVY}" ` +
      `stroke="#ffffff" stroke-width="${f(0.6 * s)}" paint-order="stroke" letter-spacing="${f(0.25 * s)}">NORTE</text>`,
  );

  // escala gráfica: 0, 5, 10 e 20 m
  const ex = 3.5 * s;
  const ey = v.H - 3.2 * s;
  const h = 0.7 * s;
  o.push(`<rect x="${f(ex - 1.5 * s)}" y="${f(ey - 4.4 * s)}" width="${f(26.5 * s)}" height="${f(6.4 * s)}" fill="#ffffff" opacity="0.9"/>`);
  for (const [x0, x1, cheio] of [
    [0, 5, true],
    [5, 10, false],
    [10, 20, true],
  ] as [number, number, boolean][])
    o.push(
      `<rect x="${f(ex + x0 * s)}" y="${f(ey - h)}" width="${f((x1 - x0) * s)}" height="${f(h)}" fill="${cheio ? NAVY : '#ffffff'}" stroke="${NAVY}" stroke-width="${f(Math.max(1, 0.08 * s))}"/>`,
    );
  for (const [x0, t] of [
    [0, '0'],
    [5, '5'],
    [10, '10'],
    [20, '20 m'],
  ] as [number, string][])
    o.push(
      `<text x="${f(ex + x0 * s)}" y="${f(ey - h - 0.9 * s)}" text-anchor="${x0 === 0 ? 'start' : 'middle'}" font-size="${f(1.9 * s)}" fill="${NAVY}">${t}</text>`,
    );
  // fonte dos dados (a licença do OpenStreetMap exige o crédito)
  o.push(
    `<text x="${f(v.W - 1.6 * s)}" y="${f(v.H - 1.6 * s)}" text-anchor="end" font-size="${f(1.5 * s)}" fill="${ARDOSIA}" ` +
      `stroke="#ffffff" stroke-width="${f(0.5 * s)}" paint-order="stroke">Base cartográfica: © colaboradores do OpenStreetMap</text>`,
  );
  const mw = Math.max(2, 0.15 * s);
  o.push(`<rect x="${f(mw / 2)}" y="${f(mw / 2)}" width="${f(v.W - mw)}" height="${f(v.H - mw)}" fill="none" stroke="${NAVY}" stroke-width="${f(mw)}"/>`);
  o.push('</svg>');
  return o.join('\n');
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// SVG -> PNG (no próprio navegador).
export function svgParaPng(svg: string, W: number, H: number): Promise<Blob> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.getContext('2d')!.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar a imagem.'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('Falha ao desenhar o croqui.'));
    };
    img.src = url;
  });
}
