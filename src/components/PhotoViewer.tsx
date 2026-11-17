import { useEffect } from 'react';
import {
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconPencil,
  IconCamera,
} from '@tabler/icons-react';
import { useStore } from '../store';
import { usePhotoUrl } from '../photoUrl';
import type { Classification, Photo } from '../types';

interface Props {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onEdit: (id: string) => void;
}

export function PhotoViewer({ photos, index, onIndex, onClose, onEdit }: Props) {
  const photo = photos[index];
  const setClassification = useStore((s) => s.setClassification);
  const createVista = useStore((s) => s.createVista);
  const removeVista = useStore((s) => s.removeVista);

  // Vista: marca a foto para aparecer no croqui como um ponto (fica "a posicionar").
  function alternarVista() {
    if (!photo.vista) createVista(photo.id);
    else if (confirm('Remover a vista desta foto do croqui?')) removeVista(photo.id);
  }

  const thumbUrl = usePhotoUrl(photo.id, 'thumb');
  const fullUrl = usePhotoUrl(photo.id, 'original');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      else if (e.key === 'ArrowRight') onIndex(Math.min(photos.length - 1, index + 1));
      else if (e.key === '1') setClassification(photo.id, null);
      else if (e.key === '2') setClassification(photo.id, 'tabela');
      else if (e.key === '3') setClassification(photo.id, 'laudo');
      else if (e.key === '4' && !photo.vista) createVista(photo.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photo.id, photo.vista, photos.length, onIndex, onClose, setClassification, createVista]);

  function choose(c: Classification) {
    setClassification(photo.id, c);
    // Tabela/Laudo: vai direto para a edição. "Não usar": avança para a próxima.
    if (c) {
      onEdit(photo.id);
      return;
    }
    const nextUnreviewed = photos.findIndex((p, i) => i > index && !p.reviewed);
    if (nextUnreviewed !== -1) onIndex(nextUnreviewed);
    else if (index < photos.length - 1) onIndex(index + 1);
  }

  const cls = photo.classification;

  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer-top" onClick={(e) => e.stopPropagation()}>
        <div className="vt-left">
          <span className="vt-name">{photo.nome}</span>
          {photo.subpasta && <span className="vt-sub">{photo.subpasta}</span>}
          {photo.reviewed && (
            <span className="vt-reviewed">
              <IconCircleCheck size={15} /> analisada
            </span>
          )}
        </div>
        <span className="vt-count">
          {index + 1} / {photos.length}
        </span>
        <button className="vt-close" onClick={onClose} aria-label="Fechar">
          <IconX size={20} />
        </button>
      </div>

      <button
        className="viewer-nav left"
        disabled={index === 0}
        onClick={(e) => {
          e.stopPropagation();
          onIndex(index - 1);
        }}
        aria-label="Anterior"
      >
        <IconChevronLeft size={28} />
      </button>

      <div className="viewer-stage" onClick={(e) => e.stopPropagation()}>
        <img src={fullUrl ?? thumbUrl ?? undefined} alt={photo.nome} />
      </div>

      <button
        className="viewer-nav right"
        disabled={index === photos.length - 1}
        onClick={(e) => {
          e.stopPropagation();
          onIndex(index + 1);
        }}
        aria-label="Próxima"
      >
        <IconChevronRight size={28} />
      </button>

      <div className="viewer-actions" onClick={(e) => e.stopPropagation()}>
        <button className={`va${cls === null && photo.reviewed ? ' active none' : ''}`} onClick={() => choose(null)}>
          Não usar
        </button>
        <button className={`va${cls === 'tabela' ? ' active tabela' : ''}`} onClick={() => choose('tabela')}>
          Tabela
        </button>
        <button className={`va${cls === 'laudo' ? ' active laudo' : ''}`} onClick={() => choose('laudo')}>
          Laudo
        </button>
        <button
          className={`va${photo.vista ? ' active vista' : ''}`}
          onClick={alternarVista}
          title={
            photo.vista
              ? photo.vista.floorId
                ? 'Esta foto já é uma vista no croqui. Clique para remover.'
                : 'Vista criada: falta posicionar no croqui (lista "A posicionar"). Clique para remover.'
              : 'Marca esta foto como uma vista: um ponto no croqui que abre a foto no croqui interativo'
          }
        >
          <IconCamera size={15} /> {photo.vista ? (photo.vista.floorId ? 'Vista no croqui' : 'Vista a posicionar') : 'Criar vista'}
        </button>
        {cls && (
          <button className="va edit" onClick={() => onEdit(photo.id)}>
            <IconPencil size={15} /> {cls === 'laudo' ? 'Editar' : 'Pontos'}
          </button>
        )}
      </div>
    </div>
  );
}
