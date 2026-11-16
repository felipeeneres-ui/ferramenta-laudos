import { get, set, del, clear } from 'idb-keyval';
import { gravarArquivo, lerArquivo, apagarArquivo } from './disco';

// Armazenamento das imagens (blobs) no IndexedDB — fora do localStorage,
// que é pequeno demais para fotos. O projeto (metadados) fica no localStorage;
// os pixels ficam aqui, referenciados pelo id da foto.

const orig = (id: string) => `photo:${id}`;
const thumb = (id: string) => `thumb:${id}`;
const edited = (id: string) => `edited:${id}`;
const handle = (id: string) => `handle:${id}`;

// Miniatura (sempre presente — usada na galeria).
// Também vai para a pasta do projeto no computador; se faltar no navegador
// (outro navegador, dados limpos), é lida de lá.
export async function putThumb(id: string, blob: Blob) {
  await set(thumb(id), blob);
  void gravarArquivo('miniaturas', id, blob);
}
export async function getThumb(id: string): Promise<Blob | undefined> {
  const local = await get<Blob>(thumb(id));
  if (local) return local;
  const doDisco = await lerArquivo('miniaturas', id);
  if (doDisco) await set(thumb(id), doDisco);
  return doDisco;
}

// Original: ou um blob copiado (fallback de arquivos soltos), ou lido sob
// demanda a partir do file handle (importação por pasta — não duplica os GB).
export const putOriginal = (id: string, blob: Blob) => set(orig(id), blob);
export const getOriginalBlob = (id: string) => get<Blob>(orig(id));

export const putFileHandle = (id: string, h: FileSystemFileHandle) => set(handle(id), h);
export const getFileHandle = (id: string) => get<FileSystemFileHandle>(handle(id));

export const putEdited = (id: string, blob: Blob) => set(edited(id), blob);
export const getEdited = (id: string) => get<Blob>(edited(id));
export const clearEdited = (id: string) => del(edited(id));

// Lê o original: prefere o file handle (pasta); cai no blob copiado se não houver.
export async function getOriginal(id: string): Promise<Blob | undefined> {
  const fh = await getFileHandle(id);
  if (fh) {
    try {
      const perm = await fh.queryPermission?.({ mode: 'read' });
      if (perm !== 'granted') await fh.requestPermission?.({ mode: 'read' });
      return await fh.getFile();
    } catch {
      /* sem permissão — tenta o blob */
    }
  }
  return getOriginalBlob(id);
}

export async function deletePhotoBlobs(id: string) {
  await del(orig(id));
  await del(thumb(id));
  await del(edited(id));
  await del(handle(id));
  void apagarArquivo('miniaturas', id);
}

export const clearAllBlobs = () => clear();

// Imagem de fundo do croqui (satélite/planta), por pavimento.
// Gravada também na pasta do projeto no computador (e lida de lá se faltar aqui).
export async function putBg(floorId: string, blob: Blob) {
  await set(`bg:${floorId}`, blob);
  await gravarArquivo('fundos', floorId, blob);
}
// A pasta manda: o fundo pode ter sido trocado por outro navegador, e a cópia
// guardada aqui ficaria velha. A cópia local só vale se a pasta não responder.
export async function getBg(floorId: string): Promise<Blob | undefined> {
  const doDisco = await lerArquivo('fundos', floorId);
  if (doDisco) {
    await set(`bg:${floorId}`, doDisco);
    return doDisco;
  }
  return get<Blob>(`bg:${floorId}`);
}
export async function delBg(floorId: string) {
  await del(`bg:${floorId}`);
  void apagarArquivo('fundos', floorId);
}

// Blob → data URL (para embutir o fundo nos exports PNG/PDF/HTML).
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// Handle da pasta da vistoria (File System Access), POR PROJETO. Persistido
// para reabrir a mesma pasta entre sessões (com nova permissão quando necessário).
// Com floorId, a pasta é a DAQUELA camada (ex.: uma pasta de fotos por rua).
const dirKey = (projectId: string, floorId?: string) =>
  floorId ? `dirHandle:${projectId}:${floorId}` : `dirHandle:${projectId}`;
export const saveDirHandle = (projectId: string, h: FileSystemDirectoryHandle, floorId?: string) =>
  set(dirKey(projectId, floorId), h);
export async function loadDirHandle(projectId: string, floorId?: string) {
  // foto de uma camada: só a pasta da própria camada (nunca grava na pasta de outra)
  if (floorId) return get<FileSystemDirectoryHandle>(dirKey(projectId, floorId));
  // fallback: chave global antiga (formato de projeto único)
  return (
    (await get<FileSystemDirectoryHandle>(dirKey(projectId))) ??
    (await get<FileSystemDirectoryHandle>('dirHandle'))
  );
}
export const delDirHandle = (projectId: string, floorId?: string) => del(dirKey(projectId, floorId));

// Grava a cópia editada (<nome>_edit.png) de volta na pasta da vistoria.
// Devolve o nome do arquivo gravado, ou null se não houver pasta/permite baixar.
export async function writeEditedToFolder(
  projectId: string,
  originalName: string,
  blob: Blob,
  floorId?: string,
): Promise<string | null> {
  const dir = await loadDirHandle(projectId, floorId);
  if (!dir) return null;
  try {
    const perm = await dir.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await dir.requestPermission?.({ mode: 'readwrite' });
      if (req !== 'granted') return null;
    }
    const base = originalName.replace(/\.[^.]+$/, '');
    const fname = `${base}_edit.png`;
    const fh = await dir.getFileHandle(fname, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return fname;
  } catch {
    return null;
  }
}
