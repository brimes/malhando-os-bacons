import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from '../components/Header';
import { Button } from '../components/Button';
import { LlmSettingsSection } from '../components/LlmSettingsSection';
import { SyncPanel } from '../components/perfil/SyncPanel';
import { ErrorState, Group, Notice, SectionTitle, Segmented, Skeleton, Toggle, stagger } from '../components/perfil/ui';
import { ExerciseVideoSettings } from '../components/ExerciseVideoSettings';
import { DEFAULT_SETTINGS, settingsApi } from '../api/settings';
import { getErrorMessage } from '../api/client';
import type { TrainingSettings } from '../types';

const COUNTDOWN_OPTIONS = [0, 3, 5, 10, 15].map((value) => ({ value, label: value === 0 ? 'Sem' : `${value}s` }));

export function SettingsPage() {
  const { hash } = useLocation();
  const [settings, setSettings] = useState<TrainingSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () => {
    setIsLoading(true);
    setLoadError(null);
    settingsApi.get()
      .then(setSettings)
      .catch((requestError) => setLoadError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  };
  useEffect(load, []);

  // Deep link from the profile (/settings#ia) lands directly on the AI section.
  // Runs after the loading state clears, otherwise the anchor is not mounted yet.
  useEffect(() => {
    if (isLoading || hash !== '#ia') return;
    document.getElementById('ia')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isLoading, hash]);

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

  if (isLoading) {
    return (
      <>
        <Header title="Configurações" showBack />
        <div className="space-y-[14px] px-5 pt-2" aria-busy="true" aria-label="Carregando configurações">
          <Skeleton className="h-[140px]" /><Skeleton className="h-[130px]" /><Skeleton className="h-[130px]" />
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <Header title="Configurações" showBack />
        <div className="px-5 pt-2"><ErrorState message={loadError} onRetry={load} /></div>
      </>
    );
  }

  return (
    <>
      <Header title="Configurações" showBack />
      <div className="space-y-6 px-5 pb-24 pt-2">
        {error && <Notice tone="danger">{error}</Notice>}

        <section className="enter">
          <SectionTitle>Contagem para iniciar</SectionTitle>
          <div className="rounded-lg bg-surface p-[18px] shadow-card">
            <p className="mb-4 text-[15px] leading-[1.45] text-muted">
              Tempo de preparação antes de cada exercício, para você se posicionar no aparelho.
            </p>
            <Segmented label="Contagem para iniciar" options={COUNTDOWN_OPTIONS} value={settings.countdown_seconds}
              onChange={(value) => update({ countdown_seconds: value })} />
          </div>
        </section>

        <section className="enter" style={stagger(1)}>
          <SectionTitle>Durante o treino</SectionTitle>
          <Group>
            <Toggle
              checked={settings.vibration_enabled}
              onChange={(value) => update({ vibration_enabled: value })}
              label="Vibrar ao terminar o descanso"
              hint="Avisa que a próxima série pode começar, mesmo com o celular guardado."
            />
            <Toggle
              checked={settings.auto_advance}
              onChange={(value) => update({ auto_advance: value })}
              label="Avançar sozinho"
              hint="Ao terminar o descanso, vai direto para a próxima série, sem esperar o botão continuar."
            />
          </Group>
          <Button fullWidth size="lg" onClick={save} isLoading={isSaving} className="mt-4">
            {saved ? 'Salvo' : 'Salvar configurações'}
          </Button>
        </section>

        <section className="enter" style={stagger(2)}>
          <SectionTitle>Dados e sincronização</SectionTitle>
          <SyncPanel />
        </section>

        <ExerciseVideoSettings />

        <section id="ia" className="scroll-mt-16 pt-2">
          <SectionTitle>Inteligência artificial</SectionTitle>
          <LlmSettingsSection />
        </section>
      </div>
    </>
  );
}
