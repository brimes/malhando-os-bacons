// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ExerciseVideo } from '../../types';

// O índice de vídeos vem de um readdir assíncrono. Estes testes cobrem o bug em
// que o player decidia "indisponível offline" antes do índice carregar e nunca
// mais reavaliava.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = { catalog_name: 'Rosca martelo', webm: 'a.webm', mp4: 'a.mp4' } as unknown as ExerciseVideo;
const arquivo = (name: string, size = 5000) => ({ name, size, type: 'file', uri: `file:///data/videos/${name}` });

let online = true;
let readdirGate: Promise<void>;
let abrirReaddir: () => void;
let arquivosEmDisco: ReturnType<typeof arquivo>[];
const deleteFile = vi.fn(async () => undefined);
const post = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android', convertFileSrc: (u: string) => `local://${u}` },
}));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: async () => undefined,
    readdir: async () => {
      await readdirGate;
      return { files: arquivosEmDisco };
    },
    deleteFile: (...a: unknown[]) => deleteFile(...(a as [])),
  },
}));
vi.mock('../../api/client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a), get: vi.fn() },
  registerUnauthorizedHandler: vi.fn(),
  getErrorMessage: () => '',
  isConnectivityError: () => false,
}));
vi.mock('../../lib/offline', () => ({ isNetworkOnline: () => online, clearOfflineData: vi.fn(), discardPendingWrites: vi.fn() }));
vi.mock('../../lib/localDb', () => ({ getRecord: async () => undefined, putRecord: async () => undefined }));

let raiz: Root;
let div: HTMLDivElement;

async function montar() {
  const { ExerciseVideoPlayer } = await import('../ExerciseVideoPlayer');
  div = document.createElement('div');
  document.body.appendChild(div);
  raiz = createRoot(div);
  await act(async () => {
    raiz.render(createElement(ExerciseVideoPlayer, { video }));
  });
}

beforeEach(() => {
  vi.resetModules();
  online = true;
  deleteFile.mockClear();
  post.mockReset();
  post.mockReturnValue(new Promise(() => undefined));
  arquivosEmDisco = [arquivo('Rosca%20martelo.webm')];
  readdirGate = new Promise((r) => {
    abrirReaddir = r;
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  div.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ExerciseVideoPlayer offline', () => {
  it('índice carrega depois do primeiro render: passa a tocar local, sem rede', async () => {
    online = false;
    await montar();
    expect(div.textContent).toContain('Carregando vídeo');
    expect(div.textContent).not.toContain('Conecte-se');
    await act(async () => {
      abrirReaddir();
    });
    expect(div.querySelector('video')?.getAttribute('src')).toContain('Rosca%20martelo.webm');
    expect(post).not.toHaveBeenCalled();
  });

  it('arquivo presente + offline: toca local', async () => {
    online = false;
    abrirReaddir();
    await montar();
    expect(div.querySelector('video')).not.toBeNull();
  });

  it('ausente + offline: pede para conectar, sem erro', async () => {
    online = false;
    arquivosEmDisco = [];
    abrirReaddir();
    await montar();
    expect(div.textContent).toContain('Conecte-se à internet para baixar este vídeo');
    expect(div.textContent).not.toContain('indisponível');
  });

  it('URL assinada pendurada: mensagem após o limite, sem travar', async () => {
    arquivosEmDisco = [];
    abrirReaddir();
    post.mockReturnValue(new Promise(() => undefined));
    vi.useFakeTimers();
    await montar();
    expect(div.textContent).toContain('Carregando vídeo');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(div.textContent).toContain('Conecte-se à internet para baixar este vídeo');
  });

  it('arquivo corrompido (<1KB) é o único que o índice apaga', async () => {
    arquivosEmDisco = [arquivo('Rosca%20martelo.webm', 10), arquivo('Outro.webm', 9000)];
    abrirReaddir();
    await montar();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith({ path: 'videos/Rosca%20martelo.webm', directory: 'DATA' });
  });

  it('logout não apaga vídeos', async () => {
    abrirReaddir();
    await montar();
    deleteFile.mockClear();
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    });
    const { useAuthStore } = await import('../../stores/useAuthStore');
    useAuthStore.getState().logout();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
