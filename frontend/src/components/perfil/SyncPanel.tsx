import { useState } from 'react';
import { adoptLegacyMutations, discardLegacyMutations, useOfflineStatus } from '../../lib/offline';
import { useOfflineStore } from '../../lib/offlineStore';
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
  // Itens sem dono (de antes do campo existir ou restaurados por backup) não
  // saem sozinhos: a pessoa decide se são desta conta.
  const legacyCount = useOfflineStore((state) => state.queue.filter((m) => m.userId === undefined).length);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        <Row icon="sync" tone={isOnline ? 'ok' : 'sun'} label="Estado" value={isOnline ? 'Conectado' : 'Sem internet'} />
        <Row label="Última sincronização" value={formatRelative(lastSyncAt)} />
        {pendingCount - legacyCount > 0 && <Row label="Aguardando envio" value={<Chip tone="teal">{pendingCount - legacyCount}</Chip>} />}
      </div>

      {legacyCount > 0 && (
        <Card>
          <p className="text-base font-semibold">
            {legacyCount} {legacyCount === 1 ? 'item de uma sessão anterior aguardando' : 'itens de uma sessão anterior aguardando'}
          </p>
          <p className="mt-1 text-[13px] leading-[1.4] text-muted">
            Não sabemos de qual conta eles vieram, então não foram enviados. Envie só se forem seus.
          </p>
          <Button variant="secondary" fullWidth className="mt-3" onClick={() => { adoptLegacyMutations(); }}>
            Enviar para esta conta
          </Button>
          {confirmingDiscard ? (
            <div className="mt-2 space-y-2">
              <p className="text-[13px] leading-[1.4] text-danger">Isso apaga esses itens do aparelho e não dá para desfazer.</p>
              <Button variant="secondary" fullWidth className="text-danger" onClick={() => { discardLegacyMutations(); setConfirmingDiscard(false); }}>
                Confirmar descarte
              </Button>
              <Button variant="secondary" fullWidth onClick={() => setConfirmingDiscard(false)}>Cancelar</Button>
            </div>
          ) : (
            <Button variant="secondary" fullWidth className="mt-2 text-danger" onClick={() => setConfirmingDiscard(true)}>
              Descartar
            </Button>
          )}
        </Card>
      )}

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
