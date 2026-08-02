import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Separate from `vite.config.ts` on purpose: the dev server config carries a
// proxy target and manual chunking that mean nothing to the test runner, and
// keeping them apart avoids `loadEnv`/`mode` plumbing neither file needs.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
