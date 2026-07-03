import { useRef, useState } from 'react';
import { IconFolderPlus, IconTrash, IconPhoto, IconUpload, IconCheck } from '@tabler/icons-react';
import { useStore } from '../store';
import { usePhotoUrl } from '../photoUrl';
import { putThumb, putOriginal, putFileHandle, saveDirHandle } from '../db';
import { uid } from '../geometry';
import { PhotoViewer } from './PhotoViewer';
import { PhotoEditor } from './PhotoEditor';
import { TablePointPicker } from './TablePointPicker';
import { IconPencil } from '@tabler/icons-react';
import type { Photo } from '../types';

const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i;

// Gera uma miniatura (~maxW px) e devolve também as dimensões originais.
async function makeThumb(file: Blob, maxW = 360): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const w0 = bmp.width;
  const h0 = bmp.height;
  const scale = Math.min(1, maxW / w0);
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res) =>
    canvas.toBlob((b) => res(b!), 'image/jpeg', 0.8),
  );
  return { blob, w: w0, h: h0 };
}

interface Item {
  name: string;
  file: Blob;
  handle?: FileSystemFileHandle;
}

export function PhotosView() {
  const photos = useStore((s) => s.project.photos);
  const addPhotos = useStore((s) => s.addPhotos);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);

  // "Editar": foto Laudo abre o editor de anotação; foto Tabela abre o seletor de pontos.
  // Lê o estado ao vivo (a classificação pode ter sido definida no mesmo clique).
  function openEdit(id: string) {
    const ph = useStore.getState().project.photos.find((p) => p.id === id);
    if (ph?.classification === 'laudo') setEditorId(id);
    else setPickerId(id);
  }

  async function ingest(items: Item[]) {
    const imgs = items.filter((f) => IMG_RE.test(f.name));
    if (imgs.length === 0) {
      setBusy(null);
      return;
    }
    const out: Photo[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const it = imgs[i];
      setBusy(`Importando ${i + 1}/${imgs.length}…`);
      const id = uid('photo');
      try {
        const { blob, w, h } = await makeThumb(it.file);
        await putThumb(id, blob);
        if (it.handle) await putFileHandle(id, it.handle);
        else await putOriginal(id, it.file); // fallback: sem handle, copia o original
        out.push({
          id,
          nome: it.name,
          classification: null,
          reviewed: false,
          descricao: '',
          pointIds: [],
          width: w,
          height: h,
          annotations: [],
          crop: null,
          border: true,
          edited: false,
        });
      } catch {
        /* arquivo ilegível — ignora */
      }
    }
    out.sort((a, b) => a.nome.localeCompare(b.nome, undefined, { numeric: true }));
    addPhotos(out);
    setBusy(null);
  }

  async function pickFolder() {
    if (!window.showDirectoryPicker) {
      alert('Seu navegador não suporta escolher pasta. Use o Chrome ou Edge, ou "Selecionar arquivos".');
      return;
    }
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      await saveDirHandle(useStore.getState().project.id, dir);
      setBusy('Lendo a pasta…');
      const items: Item[] = [];
      for await (const entry of dir.values()) {
        if (entry.kind === 'file' && IMG_RE.test(entry.name)) {
          const fh = entry as FileSystemFileHandle;
          items.push({ name: entry.name, file: await fh.getFile(), handle: fh });
        }
      }
      await ingest(items);
    } catch (err) {
      setBusy(null);
      if ((err as DOMException)?.name !== 'AbortError') console.error(err);
    }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    await ingest(list.map((f) => ({ name: f.name, file: f })));
    e.target.value = '';
  }

  const nLaudo = photos.filter((p) => p.classification === 'laudo').length;
  const nTabela = photos.filter((p) => p.classification === 'tabela').length;
  const nAnalisadas = photos.filter((p) => p.reviewed).length;
  const pct = photos.length ? Math.round((nAnalisadas / photos.length) * 100) : 0;

  const galleryRef = useRef<HTMLDivElement>(null);
  function goToLastReviewed() {
    let id: string | null = null;
    for (let i = photos.length - 1; i >= 0; i--)
      if (photos[i].reviewed) {
        id = photos[i].id;
        break;
      }
    if (!id) return;
    const el = galleryRef.current?.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  return (
    <div className="photos-view">
      <div className="subbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="icon-btn" onClick={pickFolder} disabled={!!busy}>
            <IconFolderPlus size={16} /> Escolher pasta
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
          <button className="icon-btn ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <IconUpload size={15} /> Selecionar arquivos
          </button>
          {busy && (
            <span className="muted" style={{ margin: 0 }}>
              {busy}
            </span>
          )}
        </div>
        <div className="counts">
          {photos.length > 0 && (
            <>
              <span className="progress-pct">{pct}% concluído</span>
              <span className="progress-bar" aria-hidden="true">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span>
                {nAnalisadas} de {photos.length} analisadas
              </span>
              {nAnalisadas > 0 && (
                <button
                  className="goto-last"
                  onClick={goToLastReviewed}
                  title="Ir para a última foto analisada (continuar de onde parou)"
                >
                  ↓ última analisada
                </button>
              )}
            </>
          )}
          {photos.length === 0 && <span>0 fotos</span>}
          <span className="tag laudo">{nLaudo} laudo</span>
          <span className="tag tabela">{nTabela} tabela</span>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="photos-empty">
          <IconPhoto size={40} stroke={1.3} />
          <p>Nenhuma foto ainda.</p>
          <p className="muted" style={{ maxWidth: 380, textAlign: 'center' }}>
            Escolha a pasta da vistoria para trazer todas as fotos. Depois marque cada uma como
            <b> Laudo</b> (será editada e entra no laudo + tabela) ou <b>Tabela</b> (só referência).
          </p>
        </div>
      ) : (
        <div className="gallery" ref={galleryRef}>
          {photos.map((p, i) => (
            <PhotoCard
              key={p.id}
              photo={p}
              onOpen={() => setViewerIndex(i)}
              onEdit={() => openEdit(p.id)}
            />
          ))}
        </div>
      )}

      {viewerIndex !== null && photos[viewerIndex] && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          onIndex={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onEdit={(id) => {
            setViewerIndex(null);
            openEdit(id);
          }}
        />
      )}

      {editorId && photos.find((p) => p.id === editorId) && (
        <PhotoEditor photo={photos.find((p) => p.id === editorId)!} onClose={() => setEditorId(null)} />
      )}

      {pickerId && photos.find((p) => p.id === pickerId) && (
        <TablePointPicker photo={photos.find((p) => p.id === pickerId)!} onClose={() => setPickerId(null)} />
      )}
    </div>
  );
}

function PhotoCard({ photo, onOpen, onEdit }: { photo: Photo; onOpen: () => void; onEdit: () => void }) {
  const url = usePhotoUrl(photo.id, 'thumb');
  const deletePhoto = useStore((s) => s.deletePhoto);

  return (
    <div className={`photo-card${photo.reviewed ? ' reviewed' : ''}`} data-id={photo.id}>
      <button className="thumb" onClick={onOpen} title="Abrir em tamanho grande">
        {url ? <img src={url} alt={photo.nome} loading="lazy" /> : <div className="thumb-ph" />}
        {photo.classification && (
          <span className={`badge ${photo.classification}`}>
            {photo.classification === 'laudo' ? 'Laudo' : 'Tabela'}
          </span>
        )}
        {photo.edited && <span className="edited-tag">editada</span>}
        {photo.reviewed && (
          <span className="check" aria-label="Analisada">
            <IconCheck size={13} stroke={3} />
          </span>
        )}
        {photo.classification && (
          <span
            className="edit-btn"
            title={photo.classification === 'laudo' ? 'Editar foto' : 'Escolher pontos da tabela'}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <IconPencil size={14} />
          </span>
        )}
        <span
          className="del"
          title="Remover foto"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Remover ${photo.nome}?`)) deletePhoto(photo.id);
          }}
        >
          <IconTrash size={14} />
        </span>
      </button>
      <div className="meta">
        <span className="name" title={photo.nome}>
          {photo.nome}
        </span>
      </div>
    </div>
  );
}
