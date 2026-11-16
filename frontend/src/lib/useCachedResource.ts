// Leitura "cache primeiro": a tela recebe na hora o que o aparelho já tem e
// revalida em segundo plano. Nunca espera a rede para mostrar algo que já
// existe — nem quando o aparelho "acha que tem internet" mas a API pendura.
//
// Diferença para `readThrough`: não revalida enquanto há escrita pendente no
// mesmo recurso (a resposta do servidor ainda não tem o que a pessoa acabou de
// gravar e pisaria no cache otimista) e refaz a leitura quando a fila esvazia.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../api/client';
import { isConnectivityError, isNetworkOnline, resourceKeyForRequest } from './offline';
import { useOfflineStore, writeCache } from './offlineStore';
import { normalizeRoute } from './requestPath';

export interface CachedResource<T> {
  data: T | undefined;
  /** Só é true enquanto não há NADA para mostrar (sem cópia local). */
  isLoading: boolean;
  /** Só aparece quando não há cópia local; falha de rede com cópia é silenciosa. */
  error: string | null;
  /** Há dados, mas o aparelho nunca falou com o servidor sobre eles. */
  reload: () => Promise<void>;
}

interface Options<T> {
  fetcher: () => Promise<T>;
  params?: Record<string, unknown>;
  /** Prefixos de rota cujas escritas pendentes bloqueiam a revalidação. */
  guard?: string[];
}

export function useCachedResource<T>(path: string, { fetcher, params, guard = [path] }: Options<T>): CachedResource<T> {
  const key = resourceKeyForRequest(path, params);
  const entry = useOfflineStore((state) => state.cache[key]);
  const hasPending = useOfflineStore((state) => state.queue.some(
    (mutation) => guard.some((prefix) => normalizeRoute(mutation.url).startsWith(prefix)),
  ));
  const [loading, setLoading] = useState(entry === undefined);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    if (!isNetworkOnline()) { setLoading(false); return; }
    try {
      const fresh = await fetcherRef.current();
      // A fila pode ter ganhado uma escrita enquanto a leitura voava: a
      // resposta já nasceu velha, o cache otimista vale mais.
      const stillPending = useOfflineStore.getState().queue.some(
        (mutation) => guard.some((prefix) => normalizeRoute(mutation.url).startsWith(prefix)),
      );
      if (!stillPending) writeCache(key, fresh);
      setError(null);
    } catch (requestError) {
      // Sem rede não é erro de tela: se há cópia, ela já está na tela.
      setError(isConnectivityError(requestError) ? null : getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (hasPending) { setLoading(false); return; }
    void reload();
  }, [reload, hasPending]);

  return {
    data: entry === undefined ? undefined : (entry.data as T),
    isLoading: entry === undefined && loading,
    error: entry === undefined ? error : null,
    reload,
  };
}
