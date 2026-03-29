import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appPort = Number(env.APP_PORT || 3001);

  return {
    plugins: [react()],
    build: {
      outDir: 'dist/web',
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://localhost:${appPort}`,
          changeOrigin: true
        }
      }
    }
  };
});
