import type { NextConfig } from 'next';

/**
 * Next.js config — STATIC EXPORT, and that word is load-bearing.
 *
 * Nova's web surface is ONE node:http process (packages/web/src/server.ts) that
 * already does four jobs on one port:
 *
 *   1. `/ws` upgrade → the kernel's frame protocol
 *   2. the launch-token / cookie auth gate
 *   3. plugin-registered routes run BEFORE static serving
 *   4. static serving of the built frontend
 *
 * If Next.js ran as its own server it would take over the HTTP handler and
 * jobs 1–3 would disappear: the app would load and then never connect, because
 * there is no `/ws` on Next's port. So Next is a BUILD TOOL here, not a
 * runtime. `output: 'export'` emits a plain tree of HTML + assets that the
 * existing process serves exactly as it served Vite's `dist` before. The build
 * pipeline is replaced; the transport is untouched.
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
