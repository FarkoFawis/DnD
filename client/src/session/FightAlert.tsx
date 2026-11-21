import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '../i18n.tsx';

/** Phones buzz like a heartbeat. iPhones have no web vibration, they only get the alert. */
const BUZZ = [220, 120, 220, 120, 320];
/** A little longer than the animation in styles.css (2.6 s). */
const ALERT_MS = 2700;

/** Where the sparks sit when the line breaks up: across the screen, a little above or below the line. */
const SPARKS: Array<{ left: number; dy: number; size: number }> = [
  { left: 9, dy: -13, size: 22 },
  { left: 24, dy: 11, size: 24 },
  { left: 41, dy: -9, size: 28 },
  { left: 58, dy: 14, size: 18 },
  { left: 74, dy: -15, size: 16 },
  { left: 90, dy: 8, size: 17 },
];

/**
 * "Initiate fight": a red line shoots across the screen with a diamond in its
 * middle. The diamond pulses with crossed swords, flips to an exclamation
 * mark, pulses again and collapses; the line then breaks up into sparks.
 * The whole screen glows faintly red with every pulse and the phone vibrates.
 * `count` goes up by one for every alert from the DM. Never blocks taps.
 */
export function FightAlert({ count }: { count: number }) {
  const [active, setActive] = useState(false);
  /** Alerts from before this screen appeared are old news. */
  const seen = useRef(count);
  useEffect(() => {
    if (count === seen.current) return;
    seen.current = count;
    setActive(true);
    try {
      navigator.vibrate?.(BUZZ);
    } catch {
      /* not supported or not allowed: the alert is enough */
    }
    const timer = setTimeout(() => setActive(false), ALERT_MS);
    return () => clearTimeout(timer);
  }, [count]);
  if (!active) return null;
  return (
    <div key={count} className="fight-alert" role="alert">
      <span className="sr-only">{t('A fight starts!')}</span>
      <span className="fa-tint" aria-hidden />
      <div className="fa-band" aria-hidden>
        <span className="fa-line" />
        {SPARKS.map((s, i) => (
          <svg
            key={i}
            className="fa-spark"
            viewBox="-10 -10 20 20"
            style={{ left: `${s.left}%`, top: s.dy - s.size / 2, width: s.size, height: s.size, marginLeft: -s.size / 2, animationDelay: `${1.85 + (SPARKS.length - 1 - i) * 0.07}s` } as CSSProperties}
          >
            <path d="M0-10 2-2 10 0 2 2 0 10-2 2-10 0-2-2z" />
          </svg>
        ))}
        <svg className="fa-emblem" viewBox="-76 -54 152 108">
          <path className="fa-chevron" d="M-58-13-71 0l13 13M58-13 71 0 58 13" />
          <path className="fa-diamond" d="M0-45 45 0 0 45-45 0z" />
          <g className="fa-swords" transform="scale(1.15)">
            <path d="M-12 14 13-17M12 14-13-17" />
            <path className="fa-guard" d="M-10.8 3.8-2.2 10.6M10.8 3.8 2.2 10.6" />
            <circle cx="-13.6" cy="16" r="2.8" />
            <circle cx="13.6" cy="16" r="2.8" />
          </g>
          <g className="fa-bang">
            <path d="M0-24V5" />
            <circle cx="0" cy="20" r="5.5" />
          </g>
        </svg>
      </div>
    </div>
  );
}
