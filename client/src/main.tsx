import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { FxLayer } from './fx/FxLayer.tsx';
import { initFx } from './fx/fx.ts';
import { initSettings } from './settings.ts';
import './fonts/fonts.css';
import './styles.css';
import './motion.css';

initSettings();
initFx();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <FxLayer />
  </StrictMode>,
);
