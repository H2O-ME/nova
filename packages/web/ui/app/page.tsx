'use client';

/**
 * The App Router page — the successor of `src/main.tsx`.
 *
 * TWO DECISIONS CARRY THIS FILE.
 *
 * 1. **The app is client-only (`ssr: false`).**
 *    Nova's UI is a consumer of a live `/ws` frame stream: on the server there
 *    is no socket, no kernel, and therefore nothing meaningful to render — the
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
import { useEffect } from 'react';
import { ErrorBoundary } from '../src/shell/ErrorBoundary.js';
import { SHELL_COPY } from '../src/shell/copy.js';
import { watchForStaleBuild } from '../src/shell/stale-build-watch.js';
import '../src/shell/input-modality.js';

/**
 * `dynamic` with `ssr: false` also gives the app its own boundary: the import
 * is split into a client chunk, so the page shell paints before the (large)
 * application graph evaluates, exactly as the Vite bundle did.
 */
const App = dynamic(() => import('../src/app/App.js').then((m) => m.App), {
  ssr: false,
  loading: () => null,
});

/** The client bundle's own URL, as the browser loaded it. */
function runningScriptUrl(): string {
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
  // The last script is the page's own entry chunk; Next's bootstrap scripts
  // precede it. Falling back to the location keeps this from throwing when the
  // probe runs before any script is reachable.
  const last = scripts[scripts.length - 1];
  return last?.src ?? document.location.href;
}

export default function Page(): JSX.Element {
  useEffect(() => {
    watchForStaleBuild(runningScriptUrl());
  }, []);

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
