import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 开发流：先 `nova --web`（NOVA_WEB_PORT 固定端口），再在本目录 `pnpm dev`——
// http/ws 都代理过去，前后端热重载各管各的。生产：`vite build` 出 ../public，
// 由同一 node 进程静态托管（协议帧零改动，前端只认 ../../src/protocol.ts 的类型）。
const targetPort = process.env['NOVA_WEB_PORT'] ?? '8817';
const target = `http://127.0.0.1:${targetPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/ws': { target, ws: true }, '/index.html': { target }, '/src': { target }, '/@vite': { target } } },
});
