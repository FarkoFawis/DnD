import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n.tsx';

export interface PagerTab {
  /** -1 = the page on the left, 0 = the middle one, 1 = the page on the right. */
  page: number;
  label: ReactNode;
  /** `alert` (it's your turn) or `live` (a fight is running). */
  className?: string;
}

/**
 * The pill at the bottom of a session screen: one tab per page. A gold outline
 * marks the open page; it glides to the next tab when the page changes and
 * follows the finger while a page is being dragged (`position`, see usePager).
 */
export function PagerPill(props: { tabs: PagerTab[]; page: number; position: number; dragging: boolean; onPage: (page: number) => void }) {
  const { tabs, position } = props;
  const nav = useRef<HTMLElement>(null);
  const [boxes, setBoxes] = useState<Array<{ left: number; width: number }>>([]);
  // Labels change ("Fight" becomes "Your turn!"), so the tabs are measured after every render.
  useLayoutEffect(() => {
    const next = [...(nav.current?.querySelectorAll<HTMLElement>('.pager-tab') ?? [])].map((b) => ({ left: b.offsetLeft, width: b.offsetWidth }));
    setBoxes((old) => (old.length === next.length && old.every((b, i) => b.left === next[i]!.left && b.width === next[i]!.width) ? old : next));
  });

  // Between two pages the outline is between their two tabs, by as much as the page has moved.
  const at = (page: number) => boxes[tabs.findIndex((t) => t.page === page)];
  const from = at(Math.floor(position));
  const to = at(Math.ceil(position));
  const mix = position - Math.floor(position);
  const box = from && to ? { left: from.left + (to.left - from.left) * mix, width: from.width + (to.width - from.width) * mix } : (from ?? to);

  return (
    <nav className="pager" aria-label={t('Pages')} ref={nav}>
      {box && <span className={`pager-mark ${props.dragging ? '' : 'settle'}`} style={{ transform: `translateX(${box.left}px)`, width: box.width }} aria-hidden />}
      {tabs.map((t) => (
        <button
          key={t.page}
          type="button"
          className={`pager-tab ${props.page === t.page ? 'on' : ''} ${t.className ?? ''}`}
          aria-pressed={props.page === t.page}
          onClick={() => props.onPage(t.page)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
