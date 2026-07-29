import { apiClient } from './client';
import type { LlmSettings, LlmSettingsInput, SubscriptionMockInput } from '../types';

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: 'gemini',
  model: '',
  configured: false,
  key_preview: '',
  subscription_status: 'free',
  using_shared_credits: true,
};

/**
 * Only Gemini is listed because it is the only provider the backend implements:
 * PUT /api/llm-settings rejects anything else, and it validates the key against
 * Google before saving. Offering more here would only produce a 400 the person
 * cannot act on. `providerLabel` still falls back gracefully if the backend
 * starts returning a provider this list does not know.
 */
export const KNOWN_LLM_PROVIDERS: { value: string; label: string; models: string[]; keyHint: string }[] = [
  { value: 'gemini', label: 'Google Gemini', models: ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'], keyHint: 'Chave do Google AI Studio (aistudio.google.com/apikey)' },
];

export function providerLabel(provider: string): string {
  return KNOWN_LLM_PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

export function providerModels(provider: string): string[] {
  return KNOWN_LLM_PROVIDERS.find((item) => item.value === provider)?.models ?? [];
}

export const llmApi = {
  get: async (): Promise<LlmSettings> => (await apiClient.get<LlmSettings>('/llm-settings')).data,
  update: async (input: LlmSettingsInput): Promise<LlmSettings> => (
    await apiClient.put<LlmSettings>('/llm-settings', input)
  ).data,
  /**
   * Mock subscription flow — no real charge happens on the backend. The response
   * wraps the settings in {mock, settings}, unwrapped here so callers get the
   * same shape as get/update.
   */
  mockSubscription: async (input: SubscriptionMockInput): Promise<LlmSettings> => {
    const { data } = await apiClient.post<{ mock: boolean; settings: LlmSettings }>('/subscription/mock', input);
    return data.settings;
  },
};
