import { useEffect, useState } from 'react';
import { getOriginal, getEdited, getThumb, getBg } from './db';

type Kind = 'thumb' | 'original' | 'edited';

// Carrega o blob da foto (miniatura, original ou versão editada) e devolve um
// object URL, revogando-o quando o componente desmonta ou o id muda.
export function usePhotoUrl(id: string, kind: Kind = 'thumb'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    (async () => {
      let blob: Blob | undefined;
      if (kind === 'thumb') blob = (await getThumb(id)) ?? (await getOriginal(id));
      else if (kind === 'edited') blob = (await getEdited(id)) ?? (await getOriginal(id));
      else blob = await getOriginal(id);
      if (blob && alive) {
        made = URL.createObjectURL(blob);
        setUrl(made);
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [id, kind]);
  return url;
}

// Object URL da imagem de fundo do pavimento (rev muda quando a imagem troca).
export function useBgUrl(floorId: string, rev: number, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    let alive = true;
    let made: string | null = null;
    (async () => {
      const blob = await getBg(floorId);
      if (blob && alive) {
        made = URL.createObjectURL(blob);
        setUrl(made);
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [floorId, rev, enabled]);
  return url;
}
