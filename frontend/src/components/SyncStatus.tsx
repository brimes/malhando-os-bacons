import { useOfflineStatus } from '../lib/offline';
import { Card } from './Card';

function formatRelative(timestamp: number | null): string {
  if (!timestamp) return 'ainda não sincronizado';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'agora há pouco';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Thin bar for the top of a screen. Stays out of the way while everything is
 * synced — it only speaks up when there is something the person should know.
 */
export function SyncBanner() {
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();
  if (isOnline && pendingCount === 0 && failedCount === 0) return null;

  const tone = !isOnline
    ? 'bg-sun-soft text-sun'
    : failedCount > 0
      ? 'bg-danger-soft text-danger'
      : 'bg-brand-soft text-brand-fg';

  const message = !isOnline
    ? pendingCount > 0
      ? `Sem internet · ${pendingCount} ${pendingCount === 1 ? 'alteração aguardando' : 'alterações aguardando'}`
      : 'Sem internet · você continua treinando normalmente'
    : isSyncing
      ? 'Sincronizando...'
      : failedCount > 0
        ? `${failedCount} ${failedCount === 1 ? 'alteração não enviada' : 'alterações não enviadas'} · veja em Configurações`
        : `${pendingCount} ${pendingCount === 1 ? 'alteração pendente' : 'alterações pendentes'}`;

  return (
    <div className={`mx-4 mt-3 rounded-sm px-3 py-2 text-[13px] font-medium ${tone}`}>
      {message}
    </div>
  );
}

/** Full panel for the settings screen: last sync, queue and manual retry. */
export function SyncStatusPanel() {
  const { isOnline, lastSyncAt, pendingCount, failedCount, failedMutations, isSyncing, syncNow, discardFailedMutations } =
    useOfflineStatus();

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Estado</span>
        <span className={`text-sm font-semibold ${isOnline ? 'text-ok' : 'text-sun'}`}>
          {isOnline ? 'Conectado' : 'Sem internet'}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Última sincronização</span>
        <span className="text-sm font-medium text-fg">{formatRelative(lastSyncAt)}</span>
      </div>
      {pendingCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Aguardando envio</span>
          <span className="text-sm font-medium text-teal">{pendingCount}</span>
        </div>
      )}

      {failedCount > 0 && (
        <div className="rounded-sm bg-danger-soft p-3">
          <p className="text-xs font-semibold text-danger">
            {failedCount} {failedCount === 1 ? 'alteração não foi enviada' : 'alterações não foram enviadas'}
          </p>
          <ul className="mt-2 space-y-1">
            {failedMutations.slice(0, 5).map((mutation) => (
              <li key={mutation.localId} className="text-xs leading-relaxed text-danger">
                {mutation.method} {mutation.url}
                {/* `reason` is the explanation set when this was parked as
                    failed and is always present; `lastError` only ever holds
                    a message from an earlier retry attempt and is frequently
                    empty for something that failed outright on its first try
                    — e.g. a session start refused with a 409. */}
                {mutation.reason ? ` — ${mutation.reason}` : ''}
              </li>
            ))}
          </ul>
          <button type="button" onClick={discardFailedMutations} className="mt-2 text-xs font-semibold text-danger">
            Descartar
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={!isOnline || isSyncing}
        className="w-full rounded-md bg-surface-2 min-h-[48px] py-3 text-sm font-semibold text-fg disabled:opacity-40"
      >
        {isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
      </button>
      <p className="text-xs leading-relaxed text-dim">
        Seus treinos ficam salvos no aparelho e continuam funcionando sem internet. O que você registrar
        offline é enviado sozinho assim que a conexão voltar.
      </p>
    </Card>
  );
}
