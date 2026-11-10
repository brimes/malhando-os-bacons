/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(
          ['bg', 'surface', 'surface-2', 'line', 'fg', 'muted', 'dim', 'brand', 'brand-fg',
           'teal', 'violet', 'sun', 'ok', 'danger', 'on-sun', 'on-teal'].map((k) => [k, `rgb(var(--${k}) / <alpha-value>)`]),
        ),
        'brand-soft': 'var(--brand-soft)',
        'teal-soft': 'var(--teal-soft)',
        'violet-soft': 'var(--violet-soft)',
        'sun-soft': 'var(--sun-soft)',
        'ok-soft': 'var(--ok-soft)',
        'danger-soft': 'var(--danger-soft)',
        primary: {
          50: '#fff7ed',
          100: '#ffead8',
          200: '#fbd1ad',
          300: '#f3a261',
          400: '#e8783c',
          500: '#d95c2b',
          600: '#c34522',
          700: '#9f321f',
          800: '#84291f',
          900: '#6a251d',
          950: '#3a120e',
        },
        bacon: {
          red: '#d8392e',
          orange: '#e8783c',
          cream: '#f3a261',
          aqua: '#d9f2ef',
          brown: '#541b15',
        },
      },
      // Tokens semânticos (MASTER.md) apontam para variáveis CSS de index.css.
      // Os `-soft` já trazem alfa próprio, então não usam o formato com <alpha-value>.
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        display: ['"Archivo Variable"', '"Arial Narrow"', '"Roboto Condensed"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        chip: '999px',
        sm: '12px',
        md: '16px',
        lg: '22px',
        xl: '26px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        sheet: 'var(--shadow-sheet)',
      },
      transitionTimingFunction: {
        mob: 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      transitionDuration: {
        press: '120ms',
        enter: '260ms',
        exit: '180ms',
        count: '600ms',
        ring: '700ms',
        celebrate: '500ms',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        // Para a troca de fase no treino guiado: o painel que entra cresce um
        // pouco em vez de simplesmente trocar de conteúdo. Curto de propósito —
        // isto acontece a cada série, e animação longa vira espera.
        'scale-in': 'scaleIn 0.22s cubic-bezier(0.2, 0.8, 0.3, 1)',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.92)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
