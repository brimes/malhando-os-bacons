// Preferência de tema: sistema (padrão), claro ou escuro. Aplica `.dark` no <html>.
// O script inline do index.html faz o mesmo antes do primeiro paint; aqui fica a
// parte reativa (troca em runtime e mudança do tema do sistema).
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'mob-theme';
const COLORS = { dark: '#120d0b', light: '#f7f4f2' };

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage indisponível: segue o sistema */ }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePreference = getThemePreference()): void {
  const theme = resolveTheme(pref);
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme]);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch { /* sem storage: vale só nesta sessão */ }
  applyTheme(pref);
}

export function initTheme(): void {
  applyTheme();
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system');
  });
}
