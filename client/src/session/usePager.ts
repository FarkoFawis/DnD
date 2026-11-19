import { useEffect, useRef, useState } from 'react';

/** Touches that start on these never turn the page. */
const NO_SWIPE =
  'input, textarea, select, [role="dialog"], .info-backdrop, .picker-backdrop, .drawer, .levelup-overlay, .handout-overlay, .panel';

/**
 * Pages side by side that follow the finger: page 0 in the middle, page 1 to
 * its right, page -1 to its left (when `min` is -1). Swiping right-to-left
 * moves to the next page on the right. Letting go past a third of the way, or
 * with a quick flick, finishes the move; otherwise the page springs back.
 *
 * Returns the current page and, while a finger is dragging, the position in
 * between (e.g. 0.4 = 40% of the way from page 0 to page 1).
 */
export function usePager(min: -1 | 0, max: 1 = 1) {
  const [page, setPage] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const live = useRef({ page, min, max });
  live.current = { page, min, max };

  // A page that no longer exists (the fight is over) can't stay open.
  useEffect(() => {
    if (page < min) setPage(min);
  }, [page, min]);

  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    let horizontal: boolean | null = null;
    let progress: number | null = null;
    const blocked = (target: EventTarget | null) => target instanceof Element && target.closest(NO_SWIPE) !== null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked(e.target)) return (start = null);
      const t = e.touches[0]!;
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
      horizontal = null;
      progress = null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0]!;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (horizontal === null) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
        if (!horizontal) return (start = null);
      }
      const { page: from, min: lo, max: hi } = live.current;
      progress = Math.max(lo, Math.min(hi, from - dx / (window.innerWidth || 1)));
      setDrag(progress);
    };
    const onEnd = () => {
      if (start && horizontal && progress !== null) {
        const { page: from, min: lo, max: hi } = live.current;
        const moved = progress - from;
        const quick = Date.now() - start.t < 300;
        const step = (quick ? Math.abs(moved) > 0.08 : Math.abs(moved) > 0.33) ? Math.sign(moved) : 0;
        setPage(Math.max(lo, Math.min(hi, from + step)));
      }
      start = null;
      setDrag(null);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  useEffect(() => {
    if (page === 0) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPage(0);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page]);

  return { page, setPage, dragging: drag !== null, position: drag ?? page };
}
