import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
// Document-wide pointer/keyboard tracking: the focus-ring styles and future
// tooltips read the attribute it publishes. Side-effect module, mounted once.
import './shell/input-modality.js';
import './index.css';

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
