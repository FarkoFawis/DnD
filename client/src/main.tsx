import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { FxLayer } from './fx/FxLayer.tsx';
import { initFx } from './fx/fx.ts';
import { initSettings, useSettings } from './settings.ts';
import './styles.css';
import './motion.css';

initSettings();
initFx();

/**
 * The language is a global (shared/src/i18n.ts), so a change of it has to draw
 * the whole app again. Listening to the settings here does that: no component
 * of the app is memoised, so everything below follows.
 */
function Root() {
  useSettings();
  return (
    <>
      <App />
      <FxLayer />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
