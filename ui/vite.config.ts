import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // relative assets so the same build works at / and under a GitHub Pages sub-path
  plugins: [react()],
  server: { proxy: { '/v1': 'http://localhost:7100', '/replay': 'http://localhost:7100' } },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/echarts') || id.includes('node_modules/zrender') ? 'echarts' : id.includes('node_modules/motion') || id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-') ? 'motion' : id.includes('@radix-ui') ? 'radix' : undefined),
      },
    },
  },
});
