/**
 * Moments of the session that every phone they concern announces for two or
 * three seconds: your turn, a new round, an opponent revealed, the fight is
 * over, the session's title card, Heroic Inspiration. Like the effects
 * (fx/fx.ts) it is one small bus: anything calls `announce()`, `MomentLayer`
 * (MomentAlert.tsx) draws it. A new moment replaces the one still showing.
 *
 * They are the fight alert's quieter relatives: the same line with a diamond,
 * no glow over the screen, and they never block a tap. Because they say
 * something they also show with animations off, as a plain fade.
 */
import { useEffect, useRef } from 'react';
import { fightMoment, groupNames, shownName, type Combat } from '@dnd/shared';
import { plural, t } from '../i18n.tsx';

/** Picks the colour and the size: see `.moment-alert.<tone>` in styles.css. */
export type MomentTone = 'turn' | 'round' | 'reveal' | 'end' | 'title' | 'star';

export interface Moment {
  tone: MomentTone;
  /** The big line. */
  title: string;
  /** A small line above it ("Round 3", "Session 4"). */
  kicker?: string;
  /** A small line below it. */
  sub?: string;
}

/** How long each stays on the screen; the animation in motion.css takes the same time. */
export const MOMENT_MS: Record<MomentTone, number> = { turn: 2000, round: 1700, reveal: 2600, end: 2600, title: 4200, star: 2800 };

type Listener = (m: Moment) => void;
const listeners = new Set<Listener>();

export function onMoment(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function announce(moment: Moment) {
  for (const l of listeners) l(moment);
}

/**
 * Announces what happens in the fight on this phone. `myCharacterId`: the
 * player's character (none for the DM, who is never told "your turn" and does
 * the revealing). A new round is only worth a banner on the Fight page.
 */
export function useFightMoments(combat: Combat | null, opts: { myCharacterId?: string; onFightPage: boolean }) {
  const last = useRef(combat);
  const { myCharacterId, onFightPage } = opts;
  useEffect(() => {
    const before = last.current;
    last.current = combat;
    const m = fightMoment(before, combat, myCharacterId);
    if (!m) return;
    if (m.kind === 'turn') {
      // Android only; iOS Safari has no web vibration.
      navigator.vibrate?.([70, 60, 70]);
      announce({ tone: 'turn', kicker: t('Round {n}', { n: m.round }), title: t('Your turn') });
    } else if (m.kind === 'round') {
      if (onFightPage) announce({ tone: 'round', title: t('Round {n}', { n: m.round }), sub: m.active ? t('{name} goes first', { name: shownName(m.active) }) : undefined });
    } else if (m.kind === 'reveal') {
      if (myCharacterId) announce({ tone: 'reveal', kicker: t('Revealed'), title: groupNames(m.names) });
    } else {
      announce({ tone: 'end', title: t('Fight over'), sub: plural(m.rounds, '{n} round', '{n} rounds') });
    }
    // Only a change of the fight announces anything, not a change of page.
  }, [combat]);
}
