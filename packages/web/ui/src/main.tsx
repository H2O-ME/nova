import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { ErrorBoundary } from './shell/ErrorBoundary.js';
import { SHELL_COPY } from './shell/copy.js';
// Document-wide pointer/keyboard tracking: the focus-ring styles and future
// tooltips read the attribute it publishes. Side-effect module, mounted once.
import './shell/input-modality.js';
// An installed PWA restores its page without navigating, so it would keep
// running an older bundle forever; this asks the host what it serves now.
import { watchForStaleBuild } from './shell/stale-build-watch.js';
import './index.css';
// The Nova design layer mounts after the ported sheets so its tokens win the
// cascade. New UI reads `--nova-*`; see `docs/NOVA-DESIGN-SYSTEM.md`.
import './design/index.css';

watchForStaleBuild(import.meta.url);

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing');
// The last resort: without a boundary React unmounts the whole tree on the
// first render error, and the reader gets an empty page (measured: a
// `process.platform` read inside the files panel did exactly that). The right
// column has its own boundary on top of this one; this is for everything else.
createRoot(host).render(
  <StrictMode>
    <ErrorBoundary label={SHELL_COPY['error.label.app']}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
