import { apiClient } from './client';
import { persistPlanDaysDurable } from '../lib/offline';
import type { AutomaticTrainingPlanInput, DynamicTrainingPlanInput, TrainingPlan, TrainingPlanInput, TrainingPlanJob } from '../types';

export const trainingPlansApi = {
  // Sem `archived`, o servidor já devolve só os não arquivados.
  list: async (params?: { archived?: boolean }) => (
    await apiClient.get<TrainingPlan[]>('/training-plans', params?.archived ? { params: { archived: true } } : undefined)
  ).data,
  get: async (id: number) => {
    const plan = (await apiClient.get<TrainingPlan>(`/training-plans/${id}`)).data;
    // Durable, so `findCachedPlanDay` (and therefore starting a session offline)
    // still works after this plan's generic cache entry has been pruned or the
    // quota-recovery path has wiped `cache` outright. See the field comment on
    // `planDays` in `lib/offlineStore.ts`.
    persistPlanDaysDurable(plan);
    return plan;
  },
  createManual: async (input: TrainingPlanInput) => (await apiClient.post<TrainingPlan>('/training-plans/manual', input)).data,
  // The assistant takes minutes, so this only enqueues the job — poll getJob until it settles.
  createAutomatic: async (input: AutomaticTrainingPlanInput) => (
    await apiClient.post<TrainingPlanJob>('/training-plans/automatic', input)
  ).data,
  // Diferente do automático: a criação em si não passa pelo assistente — só a
  // geração de cada dia depois — então volta o plano pronto na hora, sem job.
  createDynamic: async (input: DynamicTrainingPlanInput) => (
    await apiClient.post<TrainingPlan>('/training-plans/dynamic', input)
  ).data,
  getJob: async (id: number) => (await apiClient.get<TrainingPlanJob>(`/training-plans/jobs/${id}`)).data,
  // 204 when there is no cheat-day compensation currently valid.
  getCompensation: async (): Promise<TrainingPlan | null> => {
    const { data, status } = await apiClient.get<TrainingPlan | null>('/training-plans/compensation');
    return status === 204 ? null : data;
  },
  // Ajuste por texto livre: também assíncrono, com o mesmo polling de job.
  adjust: async (id: number, instructions: string) => (
    await apiClient.post<TrainingPlanJob>(`/training-plans/${id}/adjust`, { instructions })
  ).data,
  // Gera o próximo dia de um plano dinâmico. Roda minutos contra o assistente,
  // igual à criação automática — mesmo padrão de job + polling.
  generateDynamicDay: async (id: number) => (
    await apiClient.post<TrainingPlanJob>(`/training-plans/${id}/dynamic-day`)
  ).data,
  // 409 quando a data-alvo ainda não passou — a tela só oferece o botão depois dela.
  // Offline o POST vai para a fila e a resposta é 202 sem corpo (não há corpo
  // para o cliente inventar um plano otimista a partir dele), daí o `| null`:
  // quem chama aplica a mudança no plano que já tem em mãos.
  archive: async (id: number): Promise<TrainingPlan | null> => (
    await apiClient.post<TrainingPlan | null>(`/training-plans/${id}/archive`)
  ).data,
  unarchive: async (id: number): Promise<TrainingPlan | null> => (
    await apiClient.post<TrainingPlan | null>(`/training-plans/${id}/unarchive`)
  ).data,
  delete: async (id: number) => {
    await apiClient.delete(`/training-plans/${id}`);
  },
};
