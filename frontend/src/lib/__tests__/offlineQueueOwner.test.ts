// @vitest-environment jsdom
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, registerUnauthorizedHandler } from '../../api/client';
import { discardPendingWrites, getQueue, useOfflineStore } from '../offlineStore';
import { enqueueMutation, flushQueue, adoptLegacyMutations, legacyMutations } from '../offlineSync';

// O probe de rede do boot ainda não terminou no jsdom; aqui o aparelho está online.
vi.mock('../network', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../network')>()),
  isNetworkOnline: () => true,
}));

function login(id: number, token = `tok-${id}`) {
  localStorage.setItem('mob_token', token);
  localStorage.setItem('mob_user', JSON.stringify({ id }));
}

function stubAdapter(handler: (config: { url?: string; headers: { Authorization?: string } }) => number) {
  const calls: Array<{ url?: string; auth?: string }> = [];
  apiClient.defaults.adapter = async (config) => {
    const auth = (config.headers as unknown as { Authorization?: string }).Authorization;
    calls.push({ url: config.url, auth });
    const status = handler({ url: config.url, headers: { Authorization: auth } });
    const response = { data: { id: 1 }, status, statusText: '', headers: { 'content-type': 'application/json' }, config };
    if (status >= 400) throw new axios.AxiosError('x', String(status), config, null, response as never);
    return response as never;
  };
  return calls;
}

describe('fila offline com dono', () => {
  beforeEach(() => {
    localStorage.clear();
    discardPendingWrites();
    useOfflineStore.setState({ isOnline: true });
  });

  it('o reenvio anexa o token atual', async () => {
    login(7, 'token-atual');
    enqueueMutation({ method: 'POST', url: '/workouts/start', body: {} });
    const calls = stubAdapter(() => 200);
    await flushQueue();
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe('Bearer token-atual');
    expect(getQueue()).toHaveLength(0);
  });

  it('item de outro user_id não é enviado nem apagado', async () => {
    login(7);
    enqueueMutation({ method: 'POST', url: '/workouts/start', body: {} });
    localStorage.setItem('mob_user', JSON.stringify({ id: 8 }));
    const calls = stubAdapter(() => 200);
    await flushQueue();
    expect(calls).toHaveLength(0);
    expect(getQueue()).toHaveLength(1);
  });

  it('legado sem user_id fica retido até "Enviar para esta conta"', async () => {
    login(7);
    useOfflineStore.setState({
      queue: [{ localId: 'a', method: 'POST', url: '/workouts/start', createdAt: 1, attempts: 0 }],
    });
    const calls = stubAdapter(() => 200);
    await flushQueue();
    expect(calls).toHaveLength(0);
    expect(legacyMutations()).toHaveLength(1);
    expect(adoptLegacyMutations()).toBe(1);
    await flushQueue();
    expect(calls).toHaveLength(1);
    expect(getQueue()).toHaveLength(0);
  });

  it('401 no reenvio não chama onUnauthorized nem apaga o token', async () => {
    login(7);
    enqueueMutation({ method: 'POST', url: '/workouts/start', body: {} });
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);
    stubAdapter(() => 401);
    await flushQueue();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(localStorage.getItem('mob_token')).toBe('tok-7');
    expect(getQueue()).toHaveLength(1);
  });

  it('401 numa requisição de tela continua deslogando', async () => {
    login(7);
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);
    stubAdapter(() => 401);
    await expect(apiClient.get('/auth/me')).rejects.toBeTruthy();
    expect(onUnauthorized).toHaveBeenCalled();
    expect(localStorage.getItem('mob_token')).toBeNull();
  });

  it('a resposta do login não dispara reenvio antes de o token existir', async () => {
    useOfflineStore.setState({
      queue: [{ localId: 'a', method: 'POST', url: '/workouts/start', createdAt: 1, attempts: 0, userId: 7 }],
    });
    const calls = stubAdapter(() => 200);
    await apiClient.post('/auth/login', {});
    await Promise.resolve();
    expect(calls.map((call) => call.url)).toEqual(['/auth/login']);
  });
});
