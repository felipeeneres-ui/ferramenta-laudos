// Imagem de satélite no mesmo enquadramento do croqui gerado (CroquiGeo).
// Fonte: Esri World Imagery (aberta para visualização, com crédito). Os blocos
// do mapa são baixados e reprojetados na janela do desenho, já girada.
import type { CroquiGeo } from './types';

const BLOCO = 256;
const FONTE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
export const CREDITO_SATELITE = 'Imagem: Esri, Maxar, Earthstar Geographics';

const lonDoBloco = (x: number, n: number) => (x / n) * 360 - 180;
const latDoBloco = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
const xDoLon = (lon: number, n: number) => ((lon + 180) / 360) * n;
function yDoLat(lat: number, n: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}

async function baixarBloco(z: number, x: number, y: number): Promise<Blob | null> {
  try {
    const r = await fetch(`${FONTE}/${z}/${y}/${x}`);
    if (!r.ok) return null;
    const b = await r.blob();
    return b.type.startsWith('image/') ? b : null;
  } catch {
    return null;
  }
}

// Devolve a imagem (JPEG) e o tamanho dela em pixels; `pxm` = pixels por metro.
export async function baixarSatelite(
  geo: CroquiGeo,
  aviso?: (texto: string) => void,
): Promise<{ blob: Blob; w: number; h: number; pxm: number }> {
  const kx = Math.cos((geo.lat * Math.PI) / 180) * 111320;
  const ky = 110574;
  const a = (geo.rot * Math.PI) / 180;

  // nível de detalhe: tenta o mais fino; se a região não tiver, desce um
  let z = 20;
  {
    const n = 2 ** z;
    const teste = await baixarBloco(z, Math.floor(xDoLon(geo.lon, n)), Math.floor(yDoLat(geo.lat, n)));
    if (!teste || teste.size < 3500) z = 19; // bloco "sem dados" é minúsculo
  }
  const n = 2 ** z;
  const mPorPx = (156543.03392 * Math.cos((geo.lat * Math.PI) / 180)) / n;
  const pxm = Math.min(12, 1.15 / mPorPx); // um pouco acima da resolução nativa
  const W = Math.round(geo.larg * pxm);
  const H = Math.round(geo.alt * pxm);

  // metros (terreno) -> pixel da janela girada
  const ar = -a;
  const px = (mx: number, my: number): [number, number] => {
    const dx = mx - geo.cx;
    const dy = my - geo.cy;
    return [
      (dx * Math.cos(ar) - dy * Math.sin(ar) + geo.larg / 2) * pxm,
      (geo.alt / 2 - (dx * Math.sin(ar) + dy * Math.cos(ar))) * pxm,
    ];
  };
  const dePx = (lon: number, lat: number) => px((lon - geo.lon) * kx, (lat - geo.lat) * ky);

  // blocos que cobrem a janela (pelos 4 cantos, em metros)
  const cantos = [
    [-geo.larg / 2, -geo.alt / 2],
    [geo.larg / 2, -geo.alt / 2],
    [geo.larg / 2, geo.alt / 2],
    [-geo.larg / 2, geo.alt / 2],
  ].map(([x, y]) => ({
    lon: geo.lon + (geo.cx + x * Math.cos(a) - y * Math.sin(a)) / kx,
    lat: geo.lat + (geo.cy + x * Math.sin(a) + y * Math.cos(a)) / ky,
  }));
  const xs = cantos.map((c) => xDoLon(c.lon, n));
  const ys = cantos.map((c) => yDoLat(c.lat, n));
  const x0 = Math.floor(Math.min(...xs));
  const x1 = Math.floor(Math.max(...xs));
  const y0 = Math.floor(Math.min(...ys));
  const y1 = Math.floor(Math.max(...ys));
  const total = (x1 - x0 + 1) * (y1 - y0 + 1);
  if (total > 400) throw new Error('A área é grande demais para baixar a imagem de satélite.');

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#dfe3e9';
  ctx.fillRect(0, 0, W, H);

  let feitos = 0;
  let falhas = 0;
  const fila: [number, number][] = [];
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) fila.push([tx, ty]);
  async function operario() {
    for (;;) {
      const item = fila.shift();
      if (!item) return;
      const [tx, ty] = item;
      const blob = await baixarBloco(z, tx, ty);
      feitos++;
      aviso?.(`Baixando a imagem de satélite (${feitos}/${total})…`);
      if (!blob) {
        falhas++;
        continue;
      }
      const bmp = await createImageBitmap(blob);
      // cantos do bloco -> janela; em área tão pequena a transformação é afim
      const p0 = dePx(lonDoBloco(tx, n), latDoBloco(ty, n));
      const p1 = dePx(lonDoBloco(tx + 1, n), latDoBloco(ty, n));
      const p2 = dePx(lonDoBloco(tx, n), latDoBloco(ty + 1, n));
      ctx.setTransform(
        (p1[0] - p0[0]) / BLOCO,
        (p1[1] - p0[1]) / BLOCO,
        (p2[0] - p0[0]) / BLOCO,
        (p2[1] - p0[1]) / BLOCO,
        p0[0],
        p0[1],
      );
      ctx.drawImage(bmp, 0, 0, BLOCO + 0.6, BLOCO + 0.6); // leve sobreposição, sem frestas
      bmp.close();
    }
  }
  await Promise.all([operario(), operario(), operario(), operario()]);
  if (falhas === total) throw new Error('Não foi possível baixar a imagem de satélite. Confira a internet.');

  // crédito da fonte
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fs = Math.max(11, Math.round(H * 0.014));
  ctx.font = `${fs}px Arial, sans-serif`;
  const tw = ctx.measureText(CREDITO_SATELITE).width;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(6, H - fs - 12, tw + 10, fs + 8);
  ctx.fillStyle = '#26333F';
  ctx.fillText(CREDITO_SATELITE, 11, H - 10);

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao montar a imagem de satélite.'))), 'image/jpeg', 0.9),
  );
  return { blob, w: W, h: H, pxm };
}
