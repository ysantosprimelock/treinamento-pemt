import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' faz o app funcionar em https://<usuario>.github.io/<repositorio>/
export default defineConfig({
  base: './',
  plugins: [react()]
});
