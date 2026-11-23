import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { FxLayer } from './fx/FxLayer.tsx';
import { initFx } from './fx/fx.ts';
import { initSettings, useSettings } from './settings.ts';
import './fonts/fonts.css';
import './styles.css';
import './motion.css';

initSettings();
initFx();

/**
 * A phone that has the app from the service worker's cache opens the version
 * it already had, and fetches a new one in the background. Without this the
 * new version would only show on the open after that, which looks like "the
 * update is not there". So: when a new version takes over a page that an
 * older one had drawn, load the page again. (A first visit has no older
 * version, and is left alone.)
 */
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

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
