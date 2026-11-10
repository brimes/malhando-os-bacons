import { useState } from 'react';
import { getThemePreference, setThemePreference, ThemePreference } from '../lib/theme';

const options: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

export function ThemeSelector() {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);
  return (
    <div role="radiogroup" aria-label="Tema" className="flex gap-1 rounded-md bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => { setPref(o.value); setThemePreference(o.value); }}
          className={`press min-h-[44px] flex-1 rounded-sm text-[15px] font-semibold ${
            pref === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
