import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// base './' faz o app funcionar em https://<usuario>.github.io/<repositorio>/ e no domínio próprio.
// Duas páginas: o app do instrutor (index.html) e o painel admin (admin/index.html).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin/index.html', import.meta.url))
      }
    }
  }
});
