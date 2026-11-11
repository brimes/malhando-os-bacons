import { useOfflineStatus } from '../lib/offline';

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
