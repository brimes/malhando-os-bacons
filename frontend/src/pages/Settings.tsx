import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { DEFAULT_SETTINGS, settingsApi } from '../api/settings';
import { getErrorMessage } from '../api/client';
import type { TrainingSettings } from '../types';

const COUNTDOWN_OPTIONS = [0, 3, 5, 10, 15];

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 text-left">
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">{hint}</span>
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary-600' : 'bg-zinc-700'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<TrainingSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    settingsApi.get()
      .then(setSettings)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  const update = (patch: Partial<TrainingSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      setSettings(await settingsApi.update(settings));
      setSaved(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="py-20 text-center text-zinc-500">Carregando configurações...</div>;

  return (
    <>
      <Header title="Configurações do treino" showBack />
      <div className="space-y-5 px-4 py-5 pb-24">
        {error && <div className="rounded-xl border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">{error}</div>}

        <div>
          <h3 className="mb-3 px-1 text-xs uppercase tracking-wide text-zinc-500">Contagem para iniciar</h3>
          <Card className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-500">
              Tempo de preparação antes de cada exercício começar, para você se posicionar no aparelho.
            </p>
            <div className="grid grid-cols-5 gap-2">
              {COUNTDOWN_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => update({ countdown_seconds: value })}
                  className={`rounded-xl py-3 text-sm font-semibold transition-colors ${
                    settings.countdown_seconds === value ? 'bg-primary-600 text-white' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {value === 0 ? 'Sem' : `${value}s`}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div>
          <h3 className="mb-3 px-1 text-xs uppercase tracking-wide text-zinc-500">Durante o treino</h3>
          <Card className="space-y-5">
            <Toggle
              checked={settings.vibration_enabled}
              onChange={(value) => update({ vibration_enabled: value })}
              label="Vibrar ao terminar o descanso"
              hint="Avisa que a próxima série pode começar mesmo com o celular guardado."
            />
            <div className="border-t border-zinc-800" />
            <Toggle
              checked={settings.auto_advance}
              onChange={(value) => update({ auto_advance: value })}
              label="Avançar sozinho"
              hint="Ao terminar o descanso, vai direto para a próxima série sem esperar o botão continuar."
            />
          </Card>
        </div>

        <Button fullWidth size="lg" onClick={save} isLoading={isSaving}>
          {saved ? 'Salvo!' : 'Salvar configurações'}
        </Button>
      </div>
    </>
  );
}
