import type { ReactNode } from 'react';
import { useClosing } from './fx/hooks.ts';
import { msg, t } from './i18n.tsx';

/**
 * The frame of the screens opened from the home screen (Play, Characters,
 * Settings): one panel with its sections as a list of tabs down the left
 * side, the chosen section on the right, a round ✕ at the top right corner
 * and Done at the bottom right. Both close the panel.
 */
export function Panel<T extends string>(props: {
  title: string;
  /** `label` in English, marked with msg(): the panel translates it. */
  tabs: readonly { id: T; label: string }[];
  tab: T;
  onTab: (id: T) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  // The panel sinks away before the screen behind it comes back.
  const { closing, close } = useClosing(props.onClose, 150);
  return (
    <section className={`panel ${closing ? 'closing' : ''}`} aria-label={props.title}>
      <button type="button" className="panel-close" aria-label={t('Close')} onClick={close}>✕</button>
      <nav className="panel-tabs" role="tablist" aria-orientation="vertical">
        {props.tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={tab.id === props.tab} onClick={() => props.onTab(tab.id)}>
            {t(tab.label)}
          </button>
        ))}
      </nav>
      <div className="panel-main">
        <h2 className="panel-title">{props.title}</h2>
        {/* Keyed by the tab: a newly chosen section fades in. */}
        <div key={props.tab} className="panel-body" role="tabpanel">{props.children}</div>
        <div className="panel-foot">
          <button type="button" className="primary panel-done" onClick={close}>{t('Done')}</button>
        </div>
      </div>
    </section>
  );
}
