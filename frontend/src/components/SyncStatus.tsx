import { useOfflineStatus } from '../lib/offline';

/**
 * Thin bar for the top of a screen. Stays out of the way while everything is
 * synced — it only speaks up when there is something the person should know.
 */
export function SyncBanner() {
  // Offline e pendências são invisíveis de propósito: o app funciona igual, e a
  // fila só aparece em Configurações → Sincronização. Só o que FALHOU de vez
  // (e precisa de uma decisão da pessoa) merece aviso aqui.
  const { failedCount } = useOfflineStatus();
  if (failedCount === 0) return null;
  return (
    <div className="mx-4 mt-3 rounded-sm bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">
      {failedCount} {failedCount === 1 ? 'alteração não enviada' : 'alterações não enviadas'} · veja em Configurações
    </div>
  );
}
