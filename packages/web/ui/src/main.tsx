import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const host = document.getElementById('root');
if (host === null) throw new Error('#root missing');
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
