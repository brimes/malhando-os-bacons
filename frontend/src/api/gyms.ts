import { apiClient } from './client';
import {
  dropQueuedMutations,
  enqueueWrite,
  patchCacheLocally,
  readCache,
  resourceKeyForRequest,
} from '../lib/offline';
import { normalizeRoute } from '../lib/requestPath';
import {
  queuedMutationsReferencingLocalId,
  registerLocalIdReconciler,
  remapQueuedRoute,
  routeIdPattern,
} from '../lib/local/remap';
import type { Gym, GymInput } from '../types';

// Escritas locais primeiro: a academia aparece na lista e abre para edição na
// hora, mesmo sem rede ou com a API pendurada; o envio é em segundo plano.
// Leitura: o `apiClient` guarda a última resposta de todo GET; as escritas
// abaixo atualizam esse mesmo cache de forma otimista.
const LIST_KEY = resourceKeyForRequest('/gyms');
const detailKey = (id: number) => resourceKeyForRequest(`/gyms/${id}`);
const ROUTE_SEGMENT = 'gyms';

function replaceInList(id: number, gym: Gym): void {
  const list = readCache<Gym[]>(LIST_KEY);
  if (list) patchCacheLocally(LIST_KEY, list.map((item) => (item.id === id ? gym : item)));
}

export const gymsApi = {
  list: async (): Promise<Gym[]> => (await apiClient.get<Gym[]>('/gyms')).data,
  get: async (id: number): Promise<Gym> => (await apiClient.get<Gym>(`/gyms/${id}`)).data,

  create: (input: GymInput): Gym => {
    const gym: Gym = { id: 0, ...input, created_at: new Date().toISOString() };
    const { entityId } = enqueueWrite({
      method: 'POST',
      url: '/gyms',
      // `client_id` viaja para o servidor poder deduplicar um reenvio.
      body: { ...input, client_id: newId() },
      idempotent: true,
      createsEntity: true,
      optimistic: [{ key: LIST_KEY, apply: (cur?: Gym[]) => (cur ? [...cur, gym] : undefined) }],
    });
    const created = { ...gym, id: entityId as number };
    replaceInList(0, created);
    patchCacheLocally(detailKey(created.id), created);
    return created;
  },

  // Substitui a lista de aparelhos inteira — não há PATCH incremental no servidor.
  update: (id: number, input: GymInput): void => {
    const current = readCache<Gym>(detailKey(id)) ?? readCache<Gym[]>(LIST_KEY)?.find((g) => g.id === id);
    const updated: Gym = { created_at: new Date().toISOString(), ...current, id, ...input };
    enqueueWrite({
      method: 'PUT',
      url: `/gyms/${id}`,
      body: input,
      idempotent: true,
      optimistic: [
        { key: LIST_KEY, apply: (cur?: Gym[]) => (cur ? cur.map((g) => (g.id === id ? updated : g)) : undefined) },
        { key: detailKey(id), apply: () => updated },
      ],
    });
  },

  delete: (id: number): void => {
    const removeLocal = { key: LIST_KEY, apply: (cur?: Gym[]) => (cur ? cur.filter((g) => g.id !== id) : undefined) };
    if (id < 0) {
      // Nunca chegou ao servidor: retira da fila o POST e tudo que dependia dele.
      const pattern = routeIdPattern(ROUTE_SEGMENT, id);
      dropQueuedMutations((m) => (
        (m.method === 'POST' && normalizeRoute(m.url) === '/gyms' && m.localEntityId === id) || pattern.test(normalizeRoute(m.url))
      ));
      const list = readCache<Gym[]>(LIST_KEY);
      if (list) patchCacheLocally(LIST_KEY, list.filter((g) => g.id !== id));
      return;
    }
    enqueueWrite({ method: 'DELETE', url: `/gyms/${id}`, idempotent: true, optimistic: [removeLocal] });
  },
};

function newId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

registerLocalIdReconciler({
  matches: (mutation) => mutation.method === 'POST' && normalizeRoute(mutation.url) === '/gyms',
  reconcile: (mutation, response) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return;
    const created = response as Gym | undefined;
    if (!created || typeof created.id !== 'number' || created.id <= 0) return;
    remapQueuedRoute(ROUTE_SEGMENT, localId, created.id);
    replaceInList(localId, created);
    patchCacheLocally(detailKey(created.id), created);
  },
  dependents: (mutation, queue) => {
    const localId = mutation.localEntityId;
    if (typeof localId !== 'number' || localId >= 0) return [];
    return queuedMutationsReferencingLocalId(ROUTE_SEGMENT, localId, queue);
  },
});
