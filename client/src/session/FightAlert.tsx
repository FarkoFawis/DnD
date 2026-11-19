import { useEffect, useRef, useState } from 'react';

/** Phones buzz like a heartbeat. iPhones have no web vibration, they only get the pulse. */
const BUZZ = [220, 120, 220, 120, 320];
const PULSE_MS = 2600;

/**
 * "Initiate fight": the whole screen pulses faintly red a few times and the
 * phone vibrates. `count` goes up by one for every alert from the DM.
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
      /* not supported or not allowed: the pulse is enough */
    }
    const timer = setTimeout(() => setActive(false), PULSE_MS);
    return () => clearTimeout(timer);
  }, [count]);
  if (!active) return null;
  return (
    <div key={count} className="fight-alert" role="alert">
      <span className="fight-alert-text">Fight!</span>
    </div>
  );
}
