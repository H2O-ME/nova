import type { NextConfig } from 'next';

/**
 * Next.js config — STATIC EXPORT, and that word is load-bearing.
 *
 * Nova's UI ships as a static tree: the desktop shell loads it via Tauri's
 * `frontendDist` and frames travel over the shell's stdio bridge
 * (`packages/web/src/desktop-host.ts` + `pipe.ts`), never over HTTP. There is
 * no server process to attach Next.js to — `output: 'export'` emits the same
 * plain HTML + assets the previous Vite build produced, and the build pipeline
 * is the only thing Next owns here.
 *
 * If Next ran as its own server it would be a second, frameless app: the
 * window would load and then never connect. So Next is a BUILD TOOL, not a
 * runtime.
 *
 * `images.unoptimized` is REQUIRED by static export — the Image Optimization
 * API is a server feature and there is no server in this mode.
 */
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,

  /**
   * `extensionAlias` is THE reason this migration is viable at all.
   *
   * The whole repo writes ESM-correct TypeScript imports — `./foo.js` pointing
   * at `./foo.ts` — because the packages ship real ESM and TypeScript's
   * `nodenext` semantics require the runtime extension. That is 753 imports in
   * `src/` alone. Vite tolerated them; Turbopack and webpack both refuse,
   * failing with `Can't resolve './x.js'`.
   *
   * Rewriting 753 imports across 89 sheets and 135 components would be a
   * mechanical edit with a real chance of breaking the Node-side ESM graph that
   * the same sources also feed. Teaching the bundler the repo's convention is
   * one line and zero source churn: `.js` resolves to `.ts`, then `.tsx`, then
   * the literal file.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
