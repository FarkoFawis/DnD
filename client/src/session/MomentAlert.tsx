import { useEffect, useState, type CSSProperties } from 'react';
import { MOMENT_MS, onMoment, type Moment } from './moments.ts';

/**
 * Draws the moments of the session (moments.ts): two thin lines open from the
 * middle of the screen, the upper one with the fight alert's diamond on it,
 * and the words stand between them, then all of it fades. Never blocks taps.
 */
export function MomentLayer() {
  const [shown, setShown] = useState<{ id: number; moment: Moment } | null>(null);
  useEffect(() => onMoment((moment) => setShown((last) => ({ id: (last?.id ?? 0) + 1, moment }))), []);
  const id = shown?.id;
  const ms = shown ? MOMENT_MS[shown.moment.tone] : 0;
  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => setShown((s) => (s?.id === id ? null : s)), ms + 100);
    return () => clearTimeout(timer);
  }, [id, ms]);
  if (!shown) return null;
  const m = shown.moment;
  return (
    <div key={shown.id} className={`moment-alert ${m.tone}`} role="status" style={{ '--ma-ms': `${ms}ms` } as CSSProperties}>
      <span className="ma-veil" aria-hidden />
      <div className="ma-band">
        <span className="ma-rule" aria-hidden><i /></span>
        <p className="ma-text">
          {m.kicker && <span className="ma-kicker">{m.kicker}</span>}
          <strong className="ma-title">{m.title}</strong>
          {m.sub && <span className="ma-sub">{m.sub}</span>}
        </p>
        <span className="ma-rule" aria-hidden />
      </div>
    </div>
  );
}
