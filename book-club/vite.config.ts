import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind()],
  base: loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || './',
  resolve: { preserveSymlinks: true },
  test: {
    pool: 'threads',
    maxWorkers: 1,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tma.js')) return 'telegram';
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('zod')) return 'validation';
            if (id.includes('dexie')) return 'storage';
            if (/react|scheduler/.test(id)) return 'react';
          }
        },
      },
    },
  },
}));
