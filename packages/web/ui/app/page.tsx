'use client';

/**
 * The App Router page — the successor of `src/main.tsx`.
 *
 * TWO DECISIONS CARRY THIS FILE.
 *
 * 1. **The app is client-only (`ssr: false`).**
 *    Nova's UI is a consumer of a live frame stream (the desktop shell's stdio
 *    bridge): on the server there is no bridge, no kernel, and therefore
 *    nothing meaningful to render — the
 *    old Vite entry proved this by mounting into an empty `<div id="root">`.
 *    Prerendering it bought nothing and cost real failures: `output: 'export'`
 *    renders the page in Node, where any module-scope `window`/`document` access
 *    throws. The first attempt died on `ReferenceError: document is not defined`
 *    and the second on `window is not defined`, both from modules that are
 *    perfectly valid on the client.
 *
 *    Fixing those one by one would mean sprinkling `typeof window` guards
 *    through 135 components to support a render nobody wants. `ssr: false`
 *    states the truth once: this tree only exists in a browser.
 *
 * 2. **Global CSS and `StrictMode` are not here.**
 *    Global styles live in `app/globals.css` (Next only allows them from the
 *    root layout), and strict mode comes from `reactStrictMode` in
 *    `next.config.ts`. Re-declaring either would duplicate it.
 */
import dynamic from 'next/dynamic';
import { ErrorBoundary } from '../src/shell/ErrorBoundary.js';
import { SHELL_COPY } from '../src/shell/copy.js';
import '../src/shell/input-modality.js';

/**
 * `dynamic` with `ssr: false` also gives the app its own boundary: the import
 * is split into a client chunk, so the page shell paints before the (large)
 * application graph evaluates, exactly as the Vite bundle did.
 */
/**
 * The cast reconciles two copies of React's types, not two components.
 *
 * `apps/tauri-bench` ships React 19, and pnpm hoists its `@types/react` into
 * `.pnpm/node_modules` — the place `next`'s own `.d.ts` resolves `react` from.
 * So `next/dynamic` hands back a `ComponentType` typed against React 19's
 * `Component` while this package still runs 18, and the value is the same
 * component either way. Remove the cast when the tree has one React.
 */
const App = dynamic(() => import('../src/app/App.js').then((m) => m.App), {
  ssr: false,
  loading: () => null,
}) as unknown as () => JSX.Element;

export default function Page(): JSX.Element {
  // The boundary stays here rather than inside `App`: without it React unmounts
  // the whole tree on the first render error and the reader gets a blank page
  // (measured: a `process.platform` read inside the files panel did exactly
  // that). The right column has its own boundary on top of this one.
  return (
    <ErrorBoundary label={SHELL_COPY['error.label.app']}>
      <App />
    </ErrorBoundary>
  );
}
