import { useEffect } from 'react';
import {
  IconX,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconPencil,
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
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photo.id, photos.length, onIndex, onClose, setClassification]);

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
        {cls && (
          <button className="va edit" onClick={() => onEdit(photo.id)}>
            <IconPencil size={15} /> {cls === 'laudo' ? 'Editar' : 'Pontos'}
          </button>
        )}
      </div>
    </div>
  );
}
