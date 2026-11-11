import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { Button } from '../components/Button';
import { CountUp } from '../components/CountUp';
import { resultsApi } from '../api/results';
import { getErrorMessage } from '../api/client';
import { TrendChart } from '../components/perfil/TrendChart';
import { Chevron, ErrorState, Icon, Notice, SectionTitle, Skeleton, fieldLabel, stagger } from '../components/perfil/ui';
import type { MeasurementField, MetricSeries, ResultsData, SaveBodyMeasurementInput } from '../types';

const FIELDS: { key: MeasurementField; label: string; unit: string; step: number }[] = [
  { key: 'weight_kg', label: 'Peso', unit: 'kg', step: 0.1 },
  { key: 'body_fat_percentage', label: 'Gordura corporal', unit: '%', step: 0.1 },
  { key: 'muscle_mass_kg', label: 'Massa muscular', unit: 'kg', step: 0.1 },
  { key: 'waist_cm', label: 'Cintura', unit: 'cm', step: 0.5 },
  { key: 'hip_cm', label: 'Quadril', unit: 'cm', step: 0.5 },
  { key: 'arm_cm', label: 'Braço', unit: 'cm', step: 0.5 },
  { key: 'thigh_cm', label: 'Coxa', unit: 'cm', step: 0.5 },
  { key: 'chest_cm', label: 'Peito', unit: 'cm', step: 0.5 },
];

const formatDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
const shortDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;
const parseValue = (text: string) => {
  const value = Number(text.replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
};

// Variação e se ela aproxima da meta. Perder gordura e ganhar músculo andam em
// sentidos opostos e os dois são progresso: o que importa é a direção da meta.
function summarize(series: MetricSeries) {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const delta = series.points.length > 1 ? last.value - first.value : 0;
  const toward = series.target != null ? Math.abs(last.value - series.target) < Math.abs(first.value - series.target) : null;
  return { first, last, delta, toward, count: series.points.length };
}

function DeltaChip({ series, className = '', short = false }: { series: MetricSeries; className?: string; short?: boolean }) {
  const { first, delta, toward, count } = summarize(series);
  if (count < 2) return <Chip className={className}>{short ? 'Novo' : 'Primeiro registro'}</Chip>;
  return (
    <Chip tone={toward === false ? 'sun' : 'violet'} className={className}>
      {signed(delta)} {series.unit}{short ? '' : ` desde ${shortDate(first.date)}`}
    </Chip>
  );
}

// Protagonista da tela: a evolução principal em número grande e gráfico.
function HeroSeries({ series }: { series: MetricSeries }) {
  const { last } = summarize(series);
  const remaining = series.target != null ? Math.abs(last.value - series.target) : null;
  return (
    <Card tint="violet" className="enter !p-5">
      <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{series.label}</p>
      <p className="num mt-1 text-[56px] leading-none text-violet">
        <CountUp value={last.value * 10} format={(n) => num(n / 10)} />
        <span className="ml-1.5 font-sans text-[17px] font-semibold text-muted">{series.unit}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DeltaChip series={series} />
        {remaining != null && remaining > 0 && <Chip>faltam {num(remaining)} {series.unit}</Chip>}
        {remaining === 0 && <Chip tone="ok">meta atingida</Chip>}
      </div>
      <div className="mt-4">
        <TrendChart points={series.points} target={series.target} unit={series.unit} />
      </div>
    </Card>
  );
}

function MiniSeries({ series, index }: { series: MetricSeries; index: number }) {
  const { last, count } = summarize(series);
  return (
    <div className="enter min-w-0" style={stagger(index + 1)}>
      <Card className="h-full !p-4">
        <p className="truncate text-[13px] font-semibold text-muted">{series.label}</p>
        <p className="num mt-1 text-[28px] leading-[1.05] text-fg">
          {num(last.value)}<span className="ml-1 font-sans text-[13px] font-semibold text-muted">{series.unit}</span>
        </p>
        <div className="mt-2"><DeltaChip series={series} short className="!h-7 max-w-full !px-2.5 !text-[13px]" /></div>
        {count > 1 && <div className="mt-3"><TrendChart points={series.points} unit={series.unit} compact /></div>}
      </Card>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-[14px] px-5 pb-24 pt-2" aria-busy="true" aria-label="Carregando resultados">
      <Skeleton className="h-[340px]" />
      <div className="grid grid-cols-2 gap-3"><Skeleton className="h-[150px]" /><Skeleton className="h-[150px]" /></div>
      <Skeleton className="h-[84px]" />
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 160 96" className="mx-auto h-24 w-40" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="152" height="80" rx="16" fill="rgb(var(--surface-2))" />
      <path d="M16 70 L50 56 L82 62 L116 36 L144 28" stroke="rgb(var(--violet))" strokeOpacity=".35" strokeWidth="5"
        strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 10" />
      <circle cx="144" cy="28" r="7" fill="rgb(var(--violet))" fillOpacity=".25" />
      <circle cx="144" cy="28" r="3.5" fill="rgb(var(--violet))" />
    </svg>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ResultsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const load = () => resultsApi.get()
    .then((d) => { setData(d); setLoadError(null); })
    .catch((e) => setLoadError(getErrorMessage(e)));

  const reload = () => { setIsLoading(true); void load().finally(() => setIsLoading(false)); };

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, []);

  // Pre-fills with the latest reading so only what changed has to be retyped.
  const latest = data?.measurements[0];
  const openForm = () => {
    setValues(Object.fromEntries(
      FIELDS.map(({ key }) => [key, latest?.[key] != null ? String(latest[key]) : '']),
    ));
    setNotes('');
    setDate(new Date().toISOString().slice(0, 10));
    setError(null);
    setShowForm(true);
  };

  const filledCount = useMemo(
    () => FIELDS.filter(({ key }) => parseValue(values[key] ?? '') != null).length,
    [values],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (filledCount === 0) {
      setError('Preencha pelo menos um indicador.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const input: SaveBodyMeasurementInput = { measured_at: date, notes };
      for (const { key } of FIELDS) input[key] = parseValue(values[key] ?? '');
      await resultsApi.save(input);
      await load();
      setShowForm(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm('Apagar este registro?')) return;
    try {
      await resultsApi.delete(id);
      await load();
    } catch (requestError) {
      setLoadError(getErrorMessage(requestError));
    }
  };

  const series = data?.series ?? [];
  // O peso é o protagonista quando existe; senão, a série com mais pontos.
  const hero = useMemo(
    () => series.find((s) => s.key === 'weight_kg' && s.points.length > 0)
      ?? [...series].filter((s) => s.points.length > 0).sort((a, b) => b.points.length - a.points.length)[0],
    [series],
  );
  const others = series.filter((s) => s !== hero && s.points.length > 0);
  const conditioning = data?.conditioning ?? [];
  const isEmpty = !!data && series.length === 0 && conditioning.length === 0;

  return (
    <>
      <Header title="Resultados" rightAction={data ? <Button size="md" onClick={openForm}>Registrar</Button> : undefined} />

      {isLoading && <ResultsSkeleton />}

      {!isLoading && !data && loadError && (
        <div className="px-5 pb-24 pt-2"><ErrorState message={loadError} onRetry={reload} /></div>
      )}

      {!isLoading && data && (
        <div className="space-y-[14px] px-5 pb-24 pt-2">
          {loadError && <Notice tone="danger">{loadError}</Notice>}

          {isEmpty ? (
            <Card tint="violet" className="enter py-8 text-center">
              <EmptyIllustration />
              <h2 className="num mt-5 text-[28px] leading-[1.05] text-fg">Sua evolução começa aqui</h2>
              <p className="mx-auto mt-2 max-w-[300px] text-[15px] leading-[1.45] text-muted">
                Registre peso, gordura ou medidas. Cada registro vira um ponto na linha da sua evolução.
              </p>
              <Button fullWidth size="lg" className="mt-6" onClick={openForm}>Registrar primeiro resultado</Button>
            </Card>
          ) : (
            <>
              {hero && <HeroSeries series={hero} />}
              {others.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {others.map((s, i) => <MiniSeries key={s.key} series={s} index={i} />)}
                </div>
              )}
            </>
          )}

          <div className="enter" style={stagger(2)}>
            <Card onClick={() => navigate('/results/review')} tint="violet" className="flex min-h-[72px] items-center gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-violet-soft text-violet">
                <Icon name="compass" className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-fg">Avaliar o resultado</p>
                <p className="mt-0.5 text-[13px] leading-[1.4] text-muted">O assistente cruza treinos, alimentação e medidas com seu objetivo.</p>
              </div>
              <Chevron />
            </Card>
          </div>

          {conditioning.length > 0 && (() => {
            const [now, before] = conditioning;
            const gain = before ? now.distance_meters - before.distance_meters : null;
            return (
              <section className="enter pt-2" style={stagger(3)}>
                <SectionTitle>Condicionamento</SectionTitle>
                <Card>
                  <p className="text-[13px] font-semibold text-muted">Caminhada de 6 minutos</p>
                  <div className="mt-1 flex items-end justify-between gap-3">
                    <p className="num text-[38px] leading-[1.05] text-fg">
                      <CountUp value={now.distance_meters} />
                      <span className="ml-1 font-sans text-[15px] font-semibold text-muted">m</span>
                    </p>
                    {gain != null && gain !== 0 && (
                      <Chip tone={gain > 0 ? 'violet' : 'sun'} className="mb-1.5">{signed(gain)} m</Chip>
                    )}
                  </div>
                  <p className="mt-2 text-[13px] text-muted">
                    {formatDate(now.performed_at)}, esforço {now.perceived_exertion} de 10
                    {conditioning.length > 1 && `, ${conditioning.length} testes`}
                  </p>
                </Card>
              </section>
            );
          })()}

          {data.measurements.length > 0 && (
            <section className="enter pt-2" style={stagger(4)}>
              <SectionTitle>Histórico</SectionTitle>
              <div className="space-y-2">
                {data.measurements.map((measurement) => (
                  <Card key={measurement.id} className="!py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold text-fg">{formatDate(measurement.measured_at)}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {FIELDS.filter(({ key }) => measurement[key] != null).map(({ key, label, unit }) => (
                            <Chip key={key} className="max-w-full">
                              {label} <strong className="font-bold text-fg">{num(Number(measurement[key]))} {unit}</strong>
                            </Chip>
                          ))}
                        </div>
                        {measurement.notes && <p className="mt-2 text-[15px] leading-[1.45] text-muted">{measurement.notes}</p>}
                      </div>
                      <button type="button" onClick={() => remove(measurement.id)}
                        className="press -mr-2 -mt-1 min-h-[48px] shrink-0 px-2 text-[15px] font-semibold text-danger">
                        Apagar
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl bg-surface p-5 shadow-sheet sheet-in"
            role="dialog" aria-modal="true" aria-label="Registrar resultado"
            onClick={(event) => event.stopPropagation()}>
            <h3 className="num text-[28px] leading-[1.05] text-fg">Registrar resultado</h3>
            <p className="mt-2 text-[15px] leading-[1.45] text-muted">
              Preencha só o que você mediu. Registrar de novo na mesma data corrige o registro anterior.
            </p>

            {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}

            <label className={`mt-5 ${fieldLabel}`}>
              Data
              <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
                className="mt-1.5 w-full min-w-0 text-fg" />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {FIELDS.map(({ key, label, unit, step }) => (
                <label key={key} className={fieldLabel}>
                  {label} <span className="font-medium text-dim">({unit})</span>
                  <input type="number" inputMode="decimal" step={step} min={0} placeholder="0,0"
                    value={values[key] ?? ''}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    className="mt-1.5 w-full min-w-0 text-center font-bold text-fg" />
                </label>
              ))}
            </div>

            <label className={`mt-4 ${fieldLabel}`}>
              Observações
              <textarea value={notes} rows={2} onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex.: em jejum, pela manhã"
                className="mt-1.5 w-full resize-none text-fg" />
            </label>

            <div className="mt-5 space-y-2">
              <Button type="submit" fullWidth size="lg" isLoading={isSaving} disabled={filledCount === 0}>
                Salvar{filledCount > 0 ? ` (${filledCount})` : ''}
              </Button>
              <Button type="button" variant="ghost" fullWidth onClick={() => setShowForm(false)}>Cancelar</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
