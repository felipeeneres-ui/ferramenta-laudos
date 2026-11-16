// Projetos gravados em pasta do computador (pelo servidor local, ver vite.config.ts).
// O navegador mantém a cópia de trabalho; aqui ficam as chamadas que espelham
// tudo na pasta. Se o servidor não tiver a API (ex.: versão estática), as
// chamadas falham em silêncio e o sistema segue só com o navegador.
import type { Project } from './types';

export type TipoArquivo = 'fundos' | 'miniaturas';

export interface ListaDisco {
  pasta: string;
  projetos: { id: string; nome: string; updatedAt: number }[];
  excluidos: string[];
}

let ativo = ''; // projeto aberto (dono dos fundos e miniaturas em uso)
export const setProjetoAtivo = (id: string) => {
  ativo = id;
};

type Aviso = (estado: 'salvando' | 'salvo' | 'falhou') => void;
let avisar: Aviso = () => {};
export const aoSalvar = (fn: Aviso) => {
  avisar = fn;
};

const url = (id: string, tipo?: TipoArquivo, nome?: string) =>
  `/api/projetos/${encodeURIComponent(id)}` + (tipo && nome ? `/${tipo}/${encodeURIComponent(nome)}` : '');

async function pedir(u: string, init?: RequestInit): Promise<Response | null> {
  try {
    const r = await fetch(u, { cache: 'no-store', ...init });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

const ehJson = (r: Response) => (r.headers.get('content-type') ?? '').includes('application/json');

export async function listarDisco(): Promise<ListaDisco | null> {
  const r = await pedir('/api/projetos');
  if (!r || !ehJson(r)) return null; // sem a API, o servidor devolve a página do app
  return (await r.json()) as ListaDisco;
}

export async function lerDoDisco(id: string): Promise<(Project & { updatedAt?: number }) | null> {
  const r = await pedir(url(id));
  if (!r || !ehJson(r)) return null;
  return (await r.json()) as Project & { updatedAt?: number };
}

export async function gravarNoDisco(project: Project & { updatedAt?: number }): Promise<boolean> {
  const r = await pedir(url(project.id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  return !!r;
}

// Gravação adiada: junta as alterações em sequência (arrastar um ponto dispara dezenas).
const pendentes = new Map<string, { texto: string; timer: number }>();

export function agendarGravacao(project: Project & { updatedAt?: number }, espera = 1200) {
  const antigo = pendentes.get(project.id);
  if (antigo) clearTimeout(antigo.timer);
  const texto = JSON.stringify(project);
  avisar('salvando');
  const timer = window.setTimeout(async () => {
    pendentes.delete(project.id);
    const r = await pedir(url(project.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: texto });
    if (!pendentes.size) avisar(r ? 'salvo' : 'falhou');
  }, espera);
  pendentes.set(project.id, { texto, timer });
}

// Grava já o que estava esperando para um projeto.
async function gravarPendente(id: string) {
  const p = pendentes.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendentes.delete(id);
  const r = await pedir(url(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: p.texto });
  if (!pendentes.size) avisar(r ? 'salvo' : 'falhou');
}

// Ao fechar a aba: envia o que ainda estava esperando.
export function descarregarPendentes() {
  for (const [id, p] of pendentes) {
    clearTimeout(p.timer);
    navigator.sendBeacon(url(id), new Blob([p.texto], { type: 'application/json' }));
  }
  pendentes.clear();
}

export async function excluirDoDisco(id: string) {
  const p = pendentes.get(id);
  if (p) {
    clearTimeout(p.timer);
    pendentes.delete(id);
  }
  await pedir(url(id), { method: 'DELETE' });
}

export async function gravarArquivo(tipo: TipoArquivo, nome: string, blob: Blob, projetoId = ativo): Promise<boolean> {
  if (!projetoId) return false;
  const enviar = () =>
    pedir(url(projetoId, tipo, nome), {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'image/png' },
      body: blob,
    });
  // projeto com gravação ainda pendente (ex.: recém-criado): grava primeiro, para a pasta existir
  await gravarPendente(projetoId);
  return !!(await enviar());
}

export async function lerArquivo(tipo: TipoArquivo, nome: string, projetoId = ativo): Promise<Blob | undefined> {
  if (!projetoId) return undefined;
  const r = await pedir(url(projetoId, tipo, nome));
  if (!r || !(r.headers.get('content-type') ?? '').startsWith('image/')) return undefined;
  return await r.blob();
}

export async function apagarArquivo(tipo: TipoArquivo, nome: string, projetoId = ativo) {
  if (projetoId) await pedir(url(projetoId, tipo, nome), { method: 'DELETE' });
}
