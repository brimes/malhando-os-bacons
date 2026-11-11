import { useEffect, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { Notice, Skeleton } from './perfil/ui';
import { DEFAULT_LLM_SETTINGS, KNOWN_LLM_PROVIDERS, llmApi, providerLabel, providerModels } from '../api/llm';
import { getErrorMessage } from '../api/client';
import { useOfflineStatus } from '../lib/offline';
import type { LlmSettings } from '../types';

/**
 * Sem fluxo de assinatura: o que existia aqui era uma demonstração, sem cobrança
 * e sem provisionar nada. Uma tela de assinatura fora da compra no app é o que a
 * App Review trata como funcionalidade de demonstração (2.2) ou como compra por
 * fora (3.1.1) — e o backend (`POST /api/subscription/mock`) só marcava uma flag.
 * Quando houver assinatura de verdade, ela entra por In-App Purchase.
 */
export function LlmSettingsSection() {
  // `/llm-settings` is in `ONLINE_ONLY_PATHS` (see `offlineSync.ts`): a save
  // attempted offline is rejected, never queued — the key must never sit in
  // the offline outbox, which is plain-text on disk either way it is stored.
  // Disabling the button here is only the UI half of that; the API layer is
  // what actually guarantees nothing gets written.
  const { isOnline } = useOfflineStatus();
  const [settings, setSettings] = useState<LlmSettings>(DEFAULT_LLM_SETTINGS);
  const [provider, setProvider] = useState(DEFAULT_LLM_SETTINGS.provider);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (data: LlmSettings) => {
    setSettings(data);
    setProvider(data.provider || DEFAULT_LLM_SETTINGS.provider);
    setModel(data.model ?? '');
  };

  useEffect(() => {
    llmApi.get()
      .then(apply)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  const suggestions = providerModels(provider);

  const persist = async (key: string, successMessage: string) => {
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      apply(await llmApi.update({ provider, model: model.trim(), api_key: key }));
      setApiKey('');
      setShowKey(false);
      setNotice(successMessage);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const removeKey = async () => {
    if (!window.confirm('Remover sua chave e voltar a usar o crédito compartilhado?')) return;
    // Empty api_key is the documented way to drop the stored key on the backend.
    await persist('', 'Chave removida. Você voltou para o crédito compartilhado.');
  };

  if (isLoading) {
    return <Skeleton className="h-[160px]" />;
  }

  const label = 'block text-[13px] font-semibold leading-[1.3] text-muted';

  return (
    <div className="space-y-3">
      {error && <Notice tone="danger">{error}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}

      {/* Situação atual primeiro: a pessoa precisa saber de quem é o crédito que paga a IA. */}
      <Card tint={settings.using_shared_credits ? 'sun' : 'ok'}>
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Situação atual</p>
        {settings.using_shared_credits ? (
          <>
            <p className="num mt-1 text-[24px] leading-[1.1] text-sun">Crédito compartilhado</p>
            <p className="mt-2 text-[15px] leading-[1.45] text-muted">
              O MOB gratuito usa modelos de IA gratuitos, com um crédito dividido entre todos os usuários. Esse
              crédito é limitado e <strong className="text-fg">pode acabar</strong>. Quando isso acontece, criar planos e
              tirar dúvidas param de funcionar até o crédito voltar. Para não dividir, cadastre a sua própria chave
              de API abaixo.
            </p>
          </>
        ) : (
          <>
            <p className="num mt-1 text-[24px] leading-[1.1] text-ok">Sua chave de API</p>
            <p className="mt-2 text-[15px] leading-[1.45] text-muted">
              {settings.key_preview ? `Chave ${settings.key_preview}. ` : ''}
              {providerLabel(settings.provider)}
              {settings.model ? `, ${settings.model}` : ''}. Seu uso não depende do crédito compartilhado.
            </p>
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h4 className="text-[17px] font-bold text-fg">Usar a minha própria chave</h4>
          <p className="mt-1 text-[15px] leading-[1.45] text-muted">
            A chave fica guardada na sua conta e é usada só nas suas requisições. O custo passa a ser cobrado
            direto pelo provedor que você escolher.
          </p>
        </div>

        <label className="block">
          <span className={label}>Provedor</span>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setModel('');
            }}
            className="mt-1.5 w-full"
          >
            {/* Mantém selecionável um provedor desconhecido vindo do backend, em vez de trocá-lo em silêncio. */}
            {!KNOWN_LLM_PROVIDERS.some((item) => item.value === provider) && provider && (
              <option value={provider}>{provider}</option>
            )}
            {KNOWN_LLM_PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <div>
          <label className="block">
            <span className={label}>Modelo</span>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={suggestions[0] ?? 'nome-do-modelo'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1.5 w-full min-w-0"
            />
          </label>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setModel(item)}
                  aria-pressed={model === item}
                  className={`press min-h-[44px] rounded-chip px-4 text-[15px] font-semibold ${
                    model === item ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-muted'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block">
            <span className={label}>Chave de API</span>
            <span className="mt-1.5 flex items-stretch gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.configured ? `Cadastrada (${settings.key_preview || 'oculta'})` : 'Cole a sua chave aqui'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                className="press min-h-[52px] shrink-0 rounded-md bg-surface-2 px-4 text-[15px] font-semibold text-muted"
              >
                {showKey ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </label>
          <p className="mt-2 text-[13px] leading-[1.45] text-muted">
            {KNOWN_LLM_PROVIDERS.find((item) => item.value === provider)?.keyHint ?? 'Chave fornecida pelo provedor.'}
            {settings.configured && ' Por segurança a chave salva não é exibida. Para trocar de provedor ou modelo, informe a chave de novo.'}
          </p>
        </div>

        <Button
          fullWidth
          size="lg"
          isLoading={isSaving}
          disabled={apiKey.trim().length === 0 || !isOnline}
          onClick={() => persist(apiKey.trim(), 'Chave salva. O MOB passou a usar a sua chave.')}
        >
          {settings.configured ? 'Atualizar minha chave' : 'Salvar minha chave'}
        </Button>
        {!isOnline && (
          <p className="text-center text-[13px] text-muted">Isso precisa de internet. Conecte-se e tente de novo.</p>
        )}

        {settings.configured && (
          <Button fullWidth variant="danger" onClick={removeKey} disabled={isSaving || !isOnline}>
            Remover chave e voltar ao compartilhado
          </Button>
        )}
      </Card>
    </div>
  );
}
