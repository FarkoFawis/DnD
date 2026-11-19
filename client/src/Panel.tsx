import type { ReactNode } from 'react';

/**
 * The frame of the screens opened from the home screen (Play, Characters,
 * Settings): one panel with its sections as a list of tabs down the left
 * side, the chosen section on the right, a round ✕ at the top right corner
 * and Done at the bottom right. Both close the panel.
 */
export function Panel<T extends string>(props: {
  title: string;
  tabs: readonly { id: T; label: string }[];
  tab: T;
  onTab: (id: T) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="panel" aria-label={props.title}>
      <button type="button" className="panel-close" aria-label="Close" onClick={props.onClose}>✕</button>
      <nav className="panel-tabs" role="tablist" aria-orientation="vertical">
        {props.tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === props.tab} onClick={() => props.onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="panel-main">
        <h2 className="panel-title">{props.title}</h2>
        <div className="panel-body" role="tabpanel">{props.children}</div>
        <div className="panel-foot">
          <button type="button" className="primary panel-done" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </section>
  );
}
