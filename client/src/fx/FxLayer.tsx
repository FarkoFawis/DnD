import { useEffect, useState, type CSSProperties } from 'react';
import { FX_MS, onFx, type BurstKind, type FxEvent } from './fx.ts';

/** `n` things spread evenly around a circle, starting at `turn` degrees. */
const around = (n: number, turn = 0) => Array.from({ length: n }, (_, i) => turn + (360 / n) * i);
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/** The pieces of each burst. They are plain shapes; motion.css moves and colours them. */
const BURSTS: Record<BurstKind, () => React.ReactNode> = {
  // A circle of light with a turning ring of runes inside and sparks flying out.
  spell: () => (
    <>
      <i className="fx-ring" />
      <svg className="fx-rune" viewBox="-50 -50 100 100">
        <circle r="34" strokeDasharray="5 7" />
        <path d="M0-26 22.5 13h-45zM0 26-22.5-13h45z" />
      </svg>
      {around(6, 30).map((a, i) => <i key={a} className="fx-star" style={vars({ '--a': `${a}deg`, '--d': `${i % 2 ? 58 : 44}px` })} />)}
    </>
  ),
  // Two blades crossing, and a few splinters.
  attack: () => (
    <>
      <i className="fx-slash" />
      <i className="fx-slash fx-slash2" />
      {[-60, 15, 130, 200].map((a) => <i key={a} className="fx-shard" style={vars({ '--a': `${a}deg`, '--d': '46px' })} />)}
    </>
  ),
  // A ring with rays, like a struck bell.
  feature: () => (
    <>
      <i className="fx-ring" />
      {around(8).map((a) => <i key={a} className="fx-ray" style={vars({ '--a': `${a}deg`, '--d': '40px' })} />)}
    </>
  ),
  // Plus signs drifting up.
  heal: () => (
    <>
      <i className="fx-ring fx-soft" />
      {[-34, -14, 6, 26, 40].map((x, i) => (
        <i key={x} className="fx-plus" style={vars({ '--x': `${x}px`, '--d': `${70 + (i % 3) * 22}px`, animationDelay: `${i * 70}ms` })} />
      ))}
    </>
  ),
  // A few glints.
  item: () => (
    <>
      {[[-22, -10, 0], [18, -22, 110], [6, 14, 220]].map(([x, y, delay]) => (
        <i key={delay} className="fx-glint" style={vars({ left: `${x}px`, top: `${y}px`, animationDelay: `${delay}ms` })} />
      ))}
    </>
  ),
  // A natural 20: long rays all around.
  crit: () => (
    <>
      <i className="fx-ring" />
      <i className="fx-ring fx-ring2" />
      {around(12).map((a, i) => <i key={a} className="fx-ray fx-long" style={vars({ '--a': `${a}deg`, '--d': `${i % 2 ? 84 : 62}px` })} />)}
    </>
  ),
};

/**
 * Draws the effects asked for with `burst()` and `screenFx()` over the whole
 * app. One of these sits next to the app in main.tsx. It never takes a tap.
 */
export function FxLayer() {
  const [events, setEvents] = useState<FxEvent[]>([]);
  useEffect(
    () =>
      onFx((e) => {
        // A handful at most: a burst of taps must not pile up work on a slow phone.
        setEvents((list) => [...list.slice(-5), e]);
        setTimeout(() => setEvents((list) => list.filter((x) => x.id !== e.id)), FX_MS[e.kind]);
      }),
    [],
  );
  if (events.length === 0) return null;
  return (
    <div className="fx-layer" aria-hidden>
      {events.map((e) =>
        e.type === 'burst' ? (
          <div key={e.id} className={`fx-burst fx-${e.kind} fx-tint-${e.tint}`} style={{ left: e.x, top: e.y }}>
            {BURSTS[e.kind]()}
          </div>
        ) : e.kind === 'level' ? (
          <div key={e.id} className="fx-screen fx-level">
            <i className="fx-level-rays" />
            <div className="fx-level-text">
              <svg className="fx-level-arrow" viewBox="0 0 48 40"><path d="M6 22 24 6l18 16M6 36l18-16 18 16" /></svg>
              <strong>{e.title}</strong>
              {e.sub && <span>{e.sub}</span>}
            </div>
          </div>
        ) : (
          <div key={e.id} className={`fx-screen fx-${e.kind}`} />
        ),
      )}
    </div>
  );
}
