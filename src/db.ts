import { get, set, del, clear } from 'idb-keyval';

// Armazenamento das imagens (blobs) no IndexedDB — fora do localStorage,
// que é pequeno demais para fotos. O projeto (metadados) fica no localStorage;
// os pixels ficam aqui, referenciados pelo id da foto.

const orig = (id: string) => `photo:${id}`;
const thumb = (id: string) => `thumb:${id}`;
const edited = (id: string) => `edited:${id}`;
const handle = (id: string) => `handle:${id}`;

// Miniatura (sempre presente — usada na galeria).
export const putThumb = (id: string, blob: Blob) => set(thumb(id), blob);
export const getThumb = (id: string) => get<Blob>(thumb(id));

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
}

export const clearAllBlobs = () => clear();

// Imagem de fundo do croqui (satélite/planta), por pavimento.
export const putBg = (floorId: string, blob: Blob) => set(`bg:${floorId}`, blob);
export const getBg = (floorId: string) => get<Blob>(`bg:${floorId}`);
export const delBg = (floorId: string) => del(`bg:${floorId}`);

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
export const saveDirHandle = (projectId: string, h: FileSystemDirectoryHandle) =>
  set(`dirHandle:${projectId}`, h);
export async function loadDirHandle(projectId: string) {
  // fallback: chave global antiga (formato de projeto único)
  return (
    (await get<FileSystemDirectoryHandle>(`dirHandle:${projectId}`)) ??
    (await get<FileSystemDirectoryHandle>('dirHandle'))
  );
}
export const delDirHandle = (projectId: string) => del(`dirHandle:${projectId}`);

// Grava a cópia editada (<nome>_edit.png) de volta na pasta da vistoria.
// Devolve o nome do arquivo gravado, ou null se não houver pasta/permite baixar.
export async function writeEditedToFolder(
  projectId: string,
  originalName: string,
  blob: Blob,
): Promise<string | null> {
  const dir = await loadDirHandle(projectId);
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
