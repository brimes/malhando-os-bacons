import { useOfflineStatus } from '../../lib/offline';
import { Button } from '../Button';
import { Card } from '../Card';
import { Chip } from '../Chip';
import { Row } from './ui';

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

// Painel de sincronização das Configurações. Existe porque o do SyncStatus é
// compartilhado com o banner do Dashboard; este lê o mesmo estado offline.
export function SyncPanel() {
  const { isOnline, lastSyncAt, pendingCount, failedCount, failedMutations, isSyncing, syncNow, discardFailedMutations } =
    useOfflineStatus();

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        <Row icon="sync" tone={isOnline ? 'ok' : 'sun'} label="Estado" value={isOnline ? 'Conectado' : 'Sem internet'} />
        <Row label="Última sincronização" value={formatRelative(lastSyncAt)} />
        {pendingCount > 0 && <Row label="Aguardando envio" value={<Chip tone="teal">{pendingCount}</Chip>} />}
      </div>

      {failedCount > 0 && (
        <Card className="bg-danger-soft">
          <p className="text-base font-semibold text-danger">
            {failedCount} {failedCount === 1 ? 'alteração não foi enviada' : 'alterações não foram enviadas'}
          </p>
          <ul className="mt-2 space-y-1">
            {failedMutations.slice(0, 5).map((mutation) => (
              <li key={mutation.localId} className="text-[13px] leading-[1.4] text-danger">
                {mutation.method} {mutation.url}
                {/* `reason` é a explicação gravada quando a mutação foi parada como
                    falha e está sempre presente; `lastError` só guarda mensagem de
                    tentativa anterior e costuma vir vazio. */}
                {mutation.reason ? `: ${mutation.reason}` : ''}
              </li>
            ))}
          </ul>
          <Button variant="secondary" fullWidth className="mt-3 text-danger" onClick={discardFailedMutations}>Descartar</Button>
        </Card>
      )}

      <Button variant="secondary" fullWidth onClick={() => void syncNow()} disabled={!isOnline || isSyncing}>
        {isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
      </Button>
      <p className="px-1 text-[13px] leading-[1.45] text-muted">
        Seus treinos ficam salvos no aparelho e continuam funcionando sem internet. O que você registrar
        offline é enviado sozinho assim que a conexão voltar.
      </p>
    </div>
  );
}
