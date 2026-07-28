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
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
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
      },
    },
  },
  plugins: [],
};
