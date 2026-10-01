import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// Document-wide pointer/keyboard tracking: the focus-ring styles and future
// tooltips read the attribute it publishes. Side-effect module, mounted once.
import './shell/input-modality.js';
// An installed PWA restores its page without navigating, so it would keep
// running an older bundle forever; this asks the host what it serves now.
import { watchForStaleBuild } from './shell/stale-build-watch.js';
import './index.css';

watchForStaleBuild(import.meta.url);

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
