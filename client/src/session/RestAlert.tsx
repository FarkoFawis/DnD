import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.tsx';

/** A little longer than the animation in motion.css (2.4 s). */
const ALERT_MS = 2500;

/**
 * The DM called a rest: a warm line of light crosses the screen with a small
 * emblem on it (a campfire for a Short Rest, a moon for a Long Rest) and what
 * comes back, then fades. The calm counterpart of the fight alert: no
 * vibration, never blocks taps. `count` goes up by one with every rest.
 */
export function RestAlert({ count, rest }: { count: number; rest: 'short' | 'long' }) {
  const [active, setActive] = useState(false);
  /** Rests from before this screen appeared are old news. */
  const seen = useRef(count);
  useEffect(() => {
    if (count === seen.current) return;
    seen.current = count;
    setActive(true);
    const timer = setTimeout(() => setActive(false), ALERT_MS);
    return () => clearTimeout(timer);
  }, [count]);
  if (!active) return null;
  return (
    <div key={count} className={`rest-alert ${rest}`} role="status">
      <span className="ra-glow" aria-hidden />
      <div className="ra-band">
        <span className="ra-line" aria-hidden />
        <svg className="ra-emblem" viewBox="-40 -40 80 80" aria-hidden>
          <circle className="ra-disc" r="30" />
          {rest === 'long' ? (
            <>
              <path className="ra-icon" d="M8-17a18 18 0 1 0 10 27A14 14 0 0 1 8-17z" />
              <path className="ra-icon ra-twinkle" d="M-14-12v8M-18-8h8M-6 4v6M-9 7h6" />
            </>
          ) : (
            <>
              <path className="ra-icon ra-flame" d="M0-18c2 8 11 11 11 20a11 11 0 0 1-22 0c0-5 3-7 5-11 1 4 3 5 4 5 2-4 1-9 2-14z" />
              <path className="ra-icon" d="M-15 17 15 9M-15 9l30 8" />
            </>
          )}
        </svg>
        <p className="ra-text">
          <strong>{rest === 'long' ? t('Long rest') : t('Short rest')}</strong>
          <span>{rest === 'long' ? t('Hit points, spell slots and features are back.') : t('Short-rest features are back.')}</span>
        </p>
      </div>
    </div>
  );
}
