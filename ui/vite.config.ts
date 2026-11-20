import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

/** Local builds serve the demo video from the same origin (the static site has video.html instead). */
const demoVideo = { name: 'demo-video', closeBundle() { const f = '../docs/media/roll-call-demo.mp4'; if (existsSync(f)) { mkdirSync('dist/media', { recursive: true }); copyFileSync(f, 'dist/media/roll-call-demo.mp4'); } } };

export default defineConfig({
  base: './', // relative assets so the same build works at / and under a GitHub Pages sub-path
  plugins: [react(), demoVideo],
  server: { fs: { allow: ['..'] }, proxy: { '/v1': 'http://localhost:7100', '/replay': 'http://localhost:7100' } },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/echarts') || id.includes('node_modules/zrender') ? 'echarts' : id.includes('node_modules/motion') || id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-') ? 'motion' : id.includes('@radix-ui') ? 'radix' : undefined),
      },
    },
  },
});
