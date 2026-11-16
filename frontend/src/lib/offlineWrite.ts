// API GENÉRICA DE ESCRITA LOCAL-FIRST — `enqueueWrite`.
//
// Para qualquer tela que grava algo que NÃO depende da resposta do servidor
// (peso, refeição, perfil, academia, meta...). Não use `apiClient.post/put/...`
// direto para isso: ele espera a rede (até 8 s numa "rede que mente") e só
// então decide o que fazer. `enqueueWrite` inverte a ordem:
//
//   1. grava na fila persistente (com dono = conta logada);
//   2. aplica a atualização otimista no cache de leitura (`optimistic`), então
//      a tela relê/ouve o cache e já mostra o resultado;
//   3. devolve na hora, sem `await` de rede. O envio acontece em segundo plano
//      (`requestFlush`), com timeout curto e backoff exponencial 2 s → 60 s.
//
//   const { entityId } = enqueueWrite({
//     method: 'POST',
//     url: '/nutrition/weights',
//     body: { kg: 80, client_id },          // ponha a chave de idempotência no corpo
//     idempotent: true,                       // o servidor ignora reenvio (client_id)
//     dedupeKey: undefined,                   // ou 'profile' p/ "último vence" em PUT
//     optimistic: [{ key: resourceKeyForRequest('/nutrition/weights'),
//                    apply: (cur) => [{ id: entityId?, ...body }, ...(cur ?? [])] }],
//   });
//
// Campos:
//  - method/url/body/params: a requisição, como seria enviada.
//  - idempotent: true quando um reenvio é inofensivo (corpo com chave que o
//    servidor deduplica, ou operação que converge sozinha). Só então um timeout
//    é reenviado e a escrita ganha até 25 tentativas. Sem isso, timeout vira
//    "falha explicada" no painel de sincronização (nunca duplica em silêncio).
//  - dedupeKey: segunda escrita igual (mesmo método+url+chave) ainda na fila
//    SUBSTITUI o corpo da primeira. Use em PUT de "estado atual".
//  - createsEntity: true para POST que cria; gera um id local negativo
//    (`entityId`, devolvido) e o grava em `localEntityId`. Reconciliar o id real
//    depois é com `registerLocalIdReconciler` (lib/local/remap.ts).
//  - optimistic: lista de { key, apply(cacheAtual) => novoCache }. `apply` recebe
//    `undefined` quando o recurso nunca foi lido; devolva `undefined` para pular.
//
// Rotas só-online (IA, auth) NÃO entram aqui: use `apiClient` e trate com
// `isOnlineOnlyPath`; a mensagem para elas é "Precisa de internet".
// Nunca enfileire segredos (chave de LLM): a fila é localStorage em texto puro.

import type { MutationMethod, PendingMutation, ResourceKey } from '../types/offline';
import { enqueueMutation, isMutationInFlight, isOnlineOnlyPath, requestFlush } from './offlineSync';
import { getQueue, patchCacheLocally, patchQueuedMutation, readCache, takeLocalId } from './offlineStore';

export interface OptimisticUpdate {
  key: ResourceKey;
  apply: (current: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface EnqueueWriteInput {
  method: MutationMethod;
  url: string;
  body?: unknown;
  params?: Record<string, unknown>;
  idempotent?: boolean;
  dedupeKey?: string;
  createsEntity?: boolean;
  optimistic?: OptimisticUpdate[];
}

export interface EnqueueWriteResult {
  mutation: PendingMutation;
  /** Id local negativo, quando `createsEntity`. */
  entityId?: number;
}

export function enqueueWrite(input: EnqueueWriteInput): EnqueueWriteResult {
  if (isOnlineOnlyPath(input.url)) {
    throw new Error('Esta ação precisa de internet.');
  }
  const entityId = input.createsEntity ? takeLocalId() : undefined;

  let mutation: PendingMutation | undefined;
  if (input.dedupeKey) {
    const existing = getQueue().find((queued) => (
      queued.method === input.method && queued.url === input.url && queued.dedupeKey === input.dedupeKey
    ));
    if (existing && !isMutationInFlight(existing.localId)) {
      patchQueuedMutation(existing.localId, { body: input.body, params: input.params, attempts: 0, lastError: undefined });
      mutation = { ...existing, body: input.body, params: input.params };
    }
  }
  mutation ??= enqueueMutation({
    method: input.method,
    url: input.url,
    body: input.body,
    params: input.params,
    localEntityId: entityId,
    dedupeKey: input.dedupeKey,
    idempotent: input.idempotent,
  });

  for (const update of input.optimistic ?? []) {
    const next = update.apply(readCache(update.key));
    if (next !== undefined) patchCacheLocally(update.key, next);
  }

  setTimeout(requestFlush, 0);
  return { mutation, entityId };
}
