import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defense around the authenticated routes. A screen that calls
 * the API directly (bypassing `readThrough`) can still receive something it
 * does not expect — a captive portal slipping through, an unusual payload, a
 * render bug — and React unmounts the *entire* tree the moment any component
 * throws while rendering. Without this, that is a blank screen with no way
 * out, which is worse than whatever the original error was: someone mid-workout
 * loses the whole app, not just the one screen that broke.
 *
 * Deliberately placed around the routes rather than inside any single one —
 * especially not inside the guided workout session. The session's own data
 * (sets recorded, the session itself, the offline queue) lives in
 * `offlineStore`'s persisted, non-evictable slot, entirely outside React
 * state, so catching a render error here — even one thrown by the session
 * screen — cannot lose it. Reaching further in to give the session screen its
 * own boundary would only add a second place for this logic to drift from,
 * for no safety this one does not already give it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // No tracking service wired up yet (see Dashboard.tsx's own `.catch(console.error)`)
    // — this is the same convention, not a new one.
    console.error('ErrorBoundary capturou um erro de render:', error, info.componentStack);
  }

  private goHome = () => {
    // A full navigation, not a state reset: whatever broke may be sitting in a
    // module-level store that a re-render alone would not clear, and a fresh
    // load is the only way to be sure the same crash does not just repeat.
    // Nothing recorded on the device is lost by this — the offline queue and
    // any in-progress workout are persisted to localStorage, not held only in
    // memory, so they survive the reload and pick up right where they were.
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 px-8 pb-safe pt-safe text-center">
        <p className="text-4xl">⚠️</p>
        <h1 className="text-lg font-bold text-white">Algo deu errado nesta tela</h1>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-400">
          Não foi possível mostrar essa parte do app. Nada que já foi registrado neste
          aparelho — treino em andamento ou séries pendentes de envio — foi perdido.
        </p>
        <button
          type="button"
          onClick={this.goHome}
          className="mt-2 rounded-2xl bg-primary-600 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-primary-500"
        >
          Voltar ao início
        </button>
      </div>
    );
  }
}
