import { useEffect, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
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
    return (
      <Card>
        <p className="text-sm text-zinc-500">Carregando configurações de IA...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}
      {notice && <div className="rounded-xl border border-primary-900 bg-primary-950/40 p-3 text-sm text-primary-200">{notice}</div>}

      {/* Current state, first thing on screen: the person needs to know whose credits pay for the AI. */}
      <Card className={settings.using_shared_credits ? 'border-amber-900 bg-amber-950/20' : 'border-primary-900 bg-primary-950/20'}>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Situação atual</p>
        {settings.using_shared_credits ? (
          <>
            <p className="mt-1 text-sm font-bold text-amber-200">Usando o crédito compartilhado</p>
            <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
              O MOB gratuito usa modelos de IA gratuitos, com um crédito compartilhado entre todos os usuários. Esse
              crédito é limitado e <strong>pode acabar</strong> — quando isso acontece, criar planos e tirar dúvidas
              param de funcionar até o crédito voltar. Se você não quiser dividir esse crédito, cadastre a sua própria
              chave de API abaixo.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm font-bold text-primary-200">
              {settings.key_preview
                ? `Usando a sua chave ${settings.key_preview}`
                : 'Usando a sua chave de API'}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              {providerLabel(settings.provider)}
              {settings.model ? ` · ${settings.model}` : ''} — seu uso não depende do crédito compartilhado.
            </p>
          </>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold text-white">Usar a minha própria chave</h4>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            A chave fica guardada na sua conta e é usada só nas suas requisições. O custo passa a ser cobrado
            diretamente pelo provedor que você escolher.
          </p>
        </div>

        <label className="block text-sm text-zinc-300">
          Provedor
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setModel('');
            }}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 text-white focus:border-primary-500 focus:outline-none"
          >
            {/* Keeps an unknown provider coming from the backend selectable instead of silently switching it. */}
            {!KNOWN_LLM_PROVIDERS.some((item) => item.value === provider) && provider && (
              <option value={provider}>{provider}</option>
            )}
            {KNOWN_LLM_PROVIDERS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-zinc-300">
          Modelo
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={suggestions[0] ?? 'nome-do-modelo'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none"
          />
          {suggestions.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setModel(item)}
                  className={`rounded-full border px-3 py-2 text-xs ${
                    model === item ? 'border-primary-500 bg-primary-950 text-primary-200' : 'border-zinc-700 text-zinc-400'
                  }`}
                >
                  {item}
                </button>
              ))}
            </span>
          )}
        </label>

        <label className="block text-sm text-zinc-300">
          Chave de API
          <span className="mt-2 flex items-stretch gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={settings.configured ? `Cadastrada (${settings.key_preview || 'oculta'})` : 'Cole a sua chave aqui'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3.5 text-white placeholder-zinc-600 focus:border-primary-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((current) => !current)}
              className="shrink-0 rounded-xl border border-zinc-700 px-4 text-xs font-semibold text-zinc-300"
            >
              {showKey ? 'Ocultar' : 'Mostrar'}
            </button>
          </span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-600">
            {KNOWN_LLM_PROVIDERS.find((item) => item.value === provider)?.keyHint ?? 'Chave fornecida pelo provedor.'}
            {settings.configured && ' Por segurança a chave salva não é exibida — para trocar de provedor ou modelo, informe a chave de novo.'}
          </span>
        </label>

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
          <p className="text-center text-xs text-zinc-500">Isso precisa de internet. Conecte-se e tente de novo.</p>
        )}

        {settings.configured && (
          <Button fullWidth variant="secondary" onClick={removeKey} disabled={isSaving || !isOnline}>
            Remover chave e voltar ao compartilhado
          </Button>
        )}
      </Card>
    </div>
  );
}
