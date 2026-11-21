import { useCallback, useEffect, useRef, useState } from 'react';
import { motionOn } from '../settings.ts';

/**
 * How much a number just changed by. `n` counts the changes since the screen
 * appeared (0 = nothing happened yet), so it can key an animation that should
 * replay each time. The value something starts with is never a change.
 */
export function useDelta(value: number): { delta: number; n: number } {
  const [state, setState] = useState({ delta: 0, n: 0 });
  const last = useRef(value);
  useEffect(() => {
    const delta = value - last.current;
    last.current = value;
    if (delta !== 0) setState((s) => ({ delta, n: s.n + 1 }));
  }, [value]);
  return state;
}

/** Counts how often a value changed since the screen appeared (0 = not yet). */
export function useChanges(value: unknown): number {
  const [n, setN] = useState(0);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    setN((x) => x + 1);
  }, [value]);
  return n;
}

/**
 * A number that counts up or down to its new value instead of jumping
 * (hit points, coins). With animations off it is just the number.
 */
export function useTween(value: number, ms = 420): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (!motionOn() || typeof requestAnimationFrame !== 'function') {
      from.current = value;
      return setShown(value);
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - t) ** 3;
      const current = Math.round(start + (value - start) * eased);
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

/**
 * Which entries of a list arrived after the screen appeared (an item the DM
 * just handed over, a new condition), so only those animate in.
 */
export function useFresh(keys: readonly string[]): ReadonlySet<string> {
  const first = useRef<Set<string> | null>(null);
  if (first.current === null) first.current = new Set(keys);
  const fresh = new Set<string>();
  for (const k of keys) if (!first.current.has(k)) fresh.add(k);
  return fresh;
}

/**
 * Lets something play its leaving animation before it is taken off the page:
 * call `close()` instead of `onClose`, and put `closing` on the element as a
 * class. `onClose` then runs `ms` later (at once while animations are off).
 */
export function useClosing(onClose: () => void, ms = 190): { closing: boolean; close: () => void } {
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  latest.current = onClose;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    if (!motionOn()) return latest.current();
    if (timer.current !== undefined) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      latest.current();
      // Still on the page (the owner kept it): ready for the next time.
      setClosing(false);
    }, ms);
  }, [ms]);
  return { closing, close };
}

/**
 * Which screen is showing, with a moment for the old one to leave: `go(next)`
 * first marks the current screen as leaving (`to` = where it is headed, so it
 * can slide out the fitting way), and swaps it for the next one `ms` later.
 * `from` is the screen before, so the new one can come in the fitting way.
 * With animations off, or with `now` (the old screen has already left by itself), the swap is immediate.
 */
export function useScene<T>(initial: T, ms = 200) {
  const [state, setState] = useState<{ scene: T; from: T | null; to: T | null }>({ scene: initial, from: null, to: null });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const go = useCallback(
    (next: T, now = false) => {
      clearTimeout(timer.current);
      const swap = () => setState((s) => (s.scene === next ? { ...s, to: null } : { scene: next, from: s.scene, to: null }));
      if (now || !motionOn()) return swap();
      setState((s) => (s.scene === next ? s : { ...s, to: next }));
      timer.current = setTimeout(swap, ms);
    },
    [ms],
  );
  /** Straight there, nothing leaves or arrives (the session started, the screen is gone anyway). */
  const jump = useCallback((next: T) => {
    clearTimeout(timer.current);
    setState({ scene: next, from: null, to: null });
  }, []);
  return { ...state, go, jump };
}
