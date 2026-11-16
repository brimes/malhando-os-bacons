import { apiClient } from './client';
import { dropQueuedMutations, enqueueWrite, patchCacheLocally, readCache, resourceKeyForRequest } from '../lib/offline';
import { normalizeRoute } from '../lib/requestPath';
import type { BodyMeasurement, MetricSeries, ResultsData, SaveBodyMeasurementInput } from '../types';

const RESULTS_KEY = resourceKeyForRequest('/results');
const METRIC_KEYS = ['weight_kg', 'body_fat_percentage', 'muscle_mass_kg', 'waist_cm', 'hip_cm', 'arm_cm', 'thigh_cm', 'chest_cm'] as const;
const WEIGHT_SERIES: MetricSeries = { key: 'weight_kg', label: 'Peso', unit: 'kg', points: [] };

const day = (value: string) => value.slice(0, 10);

function withMeasurement(current: ResultsData, measurement: BodyMeasurement): ResultsData {
  // Registrar de novo na mesma data corrige o registro anterior (mesma regra do servidor).
  const measurements = [measurement, ...current.measurements.filter((m) => day(m.measured_at) !== day(measurement.measured_at))]
    .sort((a, b) => day(b.measured_at).localeCompare(day(a.measured_at)));
  const series = [...current.series];
  for (const key of METRIC_KEYS) {
    const value = measurement[key];
    if (typeof value !== 'number') continue;
    let index = series.findIndex((s) => s.key === key);
    if (index < 0 && key === 'weight_kg') { series.unshift({ ...WEIGHT_SERIES }); index = 0; }
    if (index < 0) continue;
    const points = series[index].points.filter((p) => day(p.date) !== day(measurement.measured_at));
    points.push({ date: day(measurement.measured_at), value });
    points.sort((a, b) => a.date.localeCompare(b.date));
    series[index] = { ...series[index], points };
  }
  return { ...current, measurements, series };
}

function withoutMeasurement(current: ResultsData, removed: BodyMeasurement): ResultsData {
  const series = current.series.map((s) => (
    typeof removed[s.key as keyof BodyMeasurement] === 'number'
      ? { ...s, points: s.points.filter((p) => day(p.date) !== day(removed.measured_at)) }
      : s
  ));
  return { ...current, measurements: current.measurements.filter((m) => m.id !== removed.id), series };
}

export const resultsApi = {
  get: async (): Promise<ResultsData> => (await apiClient.get<ResultsData>('/results')).data,

  /** Grava na hora no aparelho e envia em segundo plano; nunca espera a rede. */
  save: (input: SaveBodyMeasurementInput): void => {
    const now = new Date().toISOString();
    const measurement: BodyMeasurement = { id: -Date.now(), notes: '', created_at: now, ...stripNulls(input), measured_at: input.measured_at };
    enqueueWrite({
      method: 'POST',
      url: '/results',
      body: input,
      // Mesma data corrige o registro: reenviar converge para o mesmo estado.
      idempotent: true,
      optimistic: [{ key: RESULTS_KEY, apply: (cur?: ResultsData) => (cur ? withMeasurement(cur, measurement) : undefined) }],
    });
  },

  delete: (measurement: BodyMeasurement): void => {
    if (measurement.id < 0) {
      // Nunca chegou ao servidor: basta retirar o envio da fila.
      dropQueuedMutations((m) => m.method === 'POST' && normalizeRoute(m.url) === '/results'
        && day(String((m.body as { measured_at?: string } | undefined)?.measured_at ?? '')) === day(measurement.measured_at));
      const cur = readCache<ResultsData>(RESULTS_KEY);
      if (cur) patchCacheLocally(RESULTS_KEY, withoutMeasurement(cur, measurement));
      return;
    }
    enqueueWrite({
      method: 'DELETE',
      url: `/results/${measurement.id}`,
      idempotent: true,
      optimistic: [{ key: RESULTS_KEY, apply: (cur?: ResultsData) => (cur ? withoutMeasurement(cur, measurement) : undefined) }],
    });
  },
};

function stripNulls(input: SaveBodyMeasurementInput): Partial<BodyMeasurement> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== null && v !== undefined) out[k] = v;
  return out as Partial<BodyMeasurement>;
}
