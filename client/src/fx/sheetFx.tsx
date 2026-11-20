import { useEffect, useRef } from 'react';
import type { CharacterData, Content } from '@dnd/shared';
import { KIND_TINT, actionTint, burst, move, screenFx, tappedJustNow } from './fx.ts';
import { useChanges, useDelta, useTween } from './hooks.ts';

/** A number that counts to its new value instead of jumping there. */
export function Num({ value }: { value: number }) {
  return <>{useTween(value)}</>;
}

/** A counting number that also lights up for a moment when it changes (coins, how many of an item). */
export function FlashNum({ value }: { value: number }) {
  const { n } = useDelta(value);
  const shown = useTween(value);
  return <span key={n} className={n > 0 ? 'num-flash' : undefined}>{shown}</span>;
}

/**
 * Put inside a box that shows hit points (the box needs `position: relative`):
 * whenever `value` changes, the difference floats up from it ("−7" in red,
 * "+5" in green), the box flashes in that colour, and a hit shakes it.
 */
export function HpFx({ value }: { value: number }) {
  const { delta, n } = useDelta(value);
  const self = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (n > 0) move(self.current?.parentElement, delta < 0 ? 'shake' : 'pop');
  }, [n, delta]);
  if (n === 0) return null;
  return (
    <span key={n} ref={self} className={`hp-fx ${delta < 0 ? 'dmg' : 'heal'}`} aria-hidden>
      <span className="hp-fx-flash" />
      <span className="hp-fx-num">{delta > 0 ? `+${delta}` : `−${-delta}`}</span>
    </span>
  );
}

/** The bar under hit points. The part just lost stays for a moment, lighter, before it drains. */
export function HpBar({ current, max }: { current: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <span className="hpbar" aria-hidden>
      <span className="hpbar-ghost" style={{ width: `${pct}%` }} />
      <span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : ''} />
    </span>
  );
}

/**
 * On a party card: a ring of light over the portrait when that character
 * casts, attacks or uses something, in the colour of what it was.
 */
export function ActionRing({ character: c, content }: { character: CharacterData; content: Content | null }) {
  const n = useChanges(c.lastAction?.at);
  const a = c.lastAction;
  if (n === 0 || !a || a.roll || !a.kind) return null;
  return <span key={n} className={`card-ring fx-tint-${actionTint(c, content) ?? KIND_TINT[a.kind]}`} aria-hidden />;
}

/**
 * The effects on your own phone for what happens to your own character:
 * a red glow around the screen when you are hit (deeper when you drop to 0),
 * a green one when you are healed, a burst where you tapped when you cast,
 * attack or use something, and the celebration when you level up.
 */
export function useCharacterFx(
  c: CharacterData,
  content: Content | null,
  opts: {
    /** The glow around the screen for damage and healing. Only for the player whose character it is. */
    glow?: boolean;
    /** Bursts only for what was tapped on this phone (the DM looking at a player's sheet). */
    ownTapsOnly?: boolean;
  } = {},
) {
  const glow = opts.glow ?? true;
  const hp = useDelta(c.hpCurrent);
  useEffect(() => {
    if (hp.n === 0 || !glow) return;
    if (hp.delta > 0) screenFx('mend');
    else screenFx(c.hpCurrent === 0 ? 'down' : 'hurt');
    // Only a change of hit points sets this off, whatever else is new on the sheet.
  }, [hp.n]);

  const level = useDelta(c.level);
  useEffect(() => {
    if (level.n > 0 && level.delta > 0) screenFx('level', { title: `Level ${c.level}`, sub: c.name });
  }, [level.n]);

  const used = useChanges(c.lastAction?.at);
  useEffect(() => {
    const a = c.lastAction;
    if (used === 0 || !a || a.roll || !a.kind) return;
    if (opts.ownTapsOnly && !tappedJustNow()) return;
    burst(a.kind, undefined, actionTint(c, content));
  }, [used]);
}
