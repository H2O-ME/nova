import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发流：先 `nova --web`（NOVA_WEB_PORT 固定端口），再在本目录 `pnpm dev`——
// http/ws 都代理过去，前后端热重载各管各的。生产：`vite build` 出 ../public，
// 由同一 node 进程静态托管（协议帧零改动，前端只认 ../../src/protocol.ts 的类型）。
//
// Tailwind 插件已移除：它从落地起就没有被用过——`index.css` 没有
// `@import "tailwindcss"`，全仓 0 个工具类、0 处 `@apply`。样式一律 CSS Modules +
// `design/tokens` 的 `--nova-*`。留着一个装了却没人用的构建插件，只会让下一个人
// 以为这里有第二套样式体系。
const targetPort = process.env['NOVA_WEB_PORT'] ?? '8817';
const target = `http://127.0.0.1:${targetPort}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/ws': { target, ws: true }, '/index.html': { target }, '/src': { target }, '/@vite': { target } } },
});
