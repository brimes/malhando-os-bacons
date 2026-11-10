import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { resultsApi } from '../api/results';
import { getErrorMessage } from '../api/client';
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
const parseValue = (text: string) => {
  const value = Number(text.replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
};

/** Sparkline drawn inline — the chart lib is only worth loading on bigger views. */
function Sparkline({ series }: { series: MetricSeries }) {
  if (series.points.length < 2) return null;
  const values = series.points.map((point) => point.value);
  const min = Math.min(...values, series.target ?? Infinity);
  const max = Math.max(...values, series.target ?? -Infinity);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const path = series.points
    .map((point, index) => {
      const x = (index / (series.points.length - 1)) * width;
      const y = height - ((point.value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const targetY = series.target != null ? height - ((series.target - min) / range) * height : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-2 h-8 w-full">
      {targetY != null && (
        <line x1="0" y1={targetY} x2={width} y2={targetY} stroke="currentColor" strokeWidth="0.5"
          strokeDasharray="3 2" className="text-violet" />
      )}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SeriesCard({ series }: { series: MetricSeries }) {
  const last = series.points[series.points.length - 1];
  const first = series.points[0];
  const delta = series.points.length > 1 ? last.value - first.value : 0;
  // Toward the goal is what matters, not up or down: losing fat and gaining
  // muscle move in opposite directions and both can be progress.
  const towardTarget = series.target != null
    ? Math.abs(last.value - series.target) < Math.abs(first.value - series.target)
    : null;

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-fg">{series.label}</span>
        <span className="text-lg font-black tabular-nums text-fg">
          {last.value.toLocaleString('pt-BR')}<span className="ml-1 text-xs font-semibold text-dim">{series.unit}</span>
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className={towardTarget === null ? 'text-muted' : towardTarget ? 'text-ok' : 'text-sun'}>
          {series.points.length > 1
            ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${series.unit} desde ${formatDate(first.date)}`
            : 'primeiro registro'}
        </span>
        {series.target != null && <span className="text-dim">meta {series.target} {series.unit}</span>}
      </div>
      <Sparkline series={series} />
    </Card>
  );
}

export function ResultsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<ResultsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const load = () => resultsApi.get().then(setData).catch((e) => setError(getErrorMessage(e)));

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
      setError(getErrorMessage(requestError));
    }
  };

  if (isLoading) return <div className="py-20 text-center text-muted">Carregando resultados...</div>;

  return (
    <>
      <Header title="Resultados" rightAction={<Button size="sm" onClick={openForm}>Registrar</Button>} />
      <div className="space-y-5 px-4 py-5 pb-24">
        {error && !showForm && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

        {data && data.series.length === 0 && data.conditioning.length === 0 ? (
          <Card className="text-center">
            <p className="text-4xl">📊</p>
            <h2 className="mt-3 font-bold text-fg">Nenhum resultado ainda</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Registre peso, gordura corporal, massa muscular ou medidas. Cada registro vira um ponto na
              sua evolução ao longo do tempo.
            </p>
            <Button fullWidth className="mt-4" onClick={openForm}>Registrar primeiro resultado</Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {data?.series.map((series) => <SeriesCard key={series.key} series={series} />)}
          </div>
        )}

        <Card onClick={() => navigate('/results/review')} className="bg-violet-soft">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧭</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-fg">Avaliar o resultado</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                O assistente lê treinos, alimentação e medições do período e compara com o seu objetivo.
              </p>
            </div>
            <span className="text-lg text-dim">›</span>
          </div>
        </Card>

        {data && data.conditioning.length > 0 && (
          <div>
            <h3 className="mb-2 px-1 text-xs uppercase tracking-wide text-dim">Condicionamento</h3>
            <Card>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted">Caminhada de 6 minutos</span>
                <span className="text-lg font-black text-fg">
                  {data.conditioning[0].distance_meters}<span className="ml-1 text-xs text-dim">m</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-dim">
                {formatDate(data.conditioning[0].performed_at)} · esforço {data.conditioning[0].perceived_exertion}/10
                {data.conditioning.length > 1 && ` · ${data.conditioning.length} testes registrados`}
              </p>
            </Card>
          </div>
        )}

        {data && data.measurements.length > 0 && (
          <div>
            <h3 className="mb-2 px-1 text-xs uppercase tracking-wide text-dim">Histórico</h3>
            <div className="space-y-2">
              {data.measurements.map((measurement) => (
                <Card key={measurement.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">{formatDate(measurement.measured_at)}</p>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                        {FIELDS.filter(({ key }) => measurement[key] != null).map(({ key, label, unit }) => (
                          <span key={key}>{label}: <strong className="text-fg">{measurement[key]}{unit}</strong></span>
                        ))}
                      </div>
                      {measurement.notes && <p className="mt-1 text-xs italic text-dim">{measurement.notes}</p>}
                    </div>
                    <button type="button" onClick={() => remove(measurement.id)} className="shrink-0 text-xs text-danger">
                      Apagar
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <form onSubmit={submit} className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl bg-surface shadow-sheet sheet-in p-5"
            onClick={(event) => event.stopPropagation()}>
            <h3 className="text-lg font-bold text-fg">Registrar resultado</h3>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              Preencha só o que você mediu. Registrar de novo na mesma data corrige o registro anterior.
            </p>

            {error && <div className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

            <label className="mt-4 block text-xs uppercase tracking-wide text-dim">
              Data
              <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDate(event.target.value)}
                className="mt-1 w-full rounded-md border border-transparent bg-surface-2 px-4 py-3 text-fg" />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {FIELDS.map(({ key, label, unit, step }) => (
                <label key={key} className="block text-xs text-muted">
                  {label} <span className="text-dim">({unit})</span>
                  <input type="number" inputMode="decimal" step={step} min={0} placeholder="—"
                    value={values[key] ?? ''}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-transparent bg-surface-2 px-3 py-2.5 text-center font-bold text-fg placeholder:text-dim" />
                </label>
              ))}
            </div>

            <label className="mt-4 block text-xs uppercase tracking-wide text-dim">
              Observações
              <textarea value={notes} rows={2} onChange={(event) => setNotes(event.target.value)}
                placeholder="Ex: medido em jejum, pela manhã"
                className="mt-1 w-full resize-none rounded-md border border-transparent bg-surface-2 px-4 py-3 text-sm text-fg placeholder:text-dim" />
            </label>

            <div className="mt-5 space-y-2">
              <Button type="submit" fullWidth size="lg" isLoading={isSaving} disabled={filledCount === 0}>
                Salvar{filledCount > 0 ? ` (${filledCount})` : ''}
              </Button>
              <button type="button" onClick={() => setShowForm(false)} className="w-full py-3 text-sm text-muted">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
