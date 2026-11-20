/**
 * Visual effects, as one small event bus: anything in the app calls `burst()`
 * (a short effect at a point of the screen, usually where the finger was) or
 * `screenFx()` (a glow over the whole screen), and `FxLayer` draws it on top of
 * everything. Effects never block taps, last about a second at most, and
 * simply don't happen while animations are off (Settings, or the phone's
 * "reduce motion").
 */
import type { ActionKind, CharacterData, Content } from '@dnd/shared';
import { motionOn } from '../settings.ts';

/** `item`: something was given; `crit`: a natural 20. The rest are the kinds of things a character uses. */
export type BurstKind = ActionKind | 'item' | 'crit';
/** The colour of an effect, as one of the theme's tokens (see motion.css, `.fx-tint-…`). */
export type Tint = 'info' | 'gold' | 'red' | 'ok' | 'warn';
/** `hurt` / `mend`: you lost or regained hit points; `down`: you dropped to 0; `level`: you levelled up. */
export type ScreenKind = 'hurt' | 'mend' | 'down' | 'level';

export type FxEvent =
  | { id: number; type: 'burst'; kind: BurstKind; x: number; y: number; tint: Tint }
  | { id: number; type: 'screen'; kind: ScreenKind; title?: string; sub?: string };

/** How long each effect stays in the page, a little longer than its animation in motion.css. */
export const FX_MS: Record<BurstKind | ScreenKind, number> = {
  spell: 900,
  attack: 600,
  feature: 800,
  heal: 1100,
  item: 900,
  crit: 1000,
  hurt: 650,
  mend: 900,
  down: 1500,
  level: 2600,
};

/** The usual colour of each kind of effect. */
export const KIND_TINT: Record<BurstKind, Tint> = { spell: 'info', attack: 'red', feature: 'gold', heal: 'ok', item: 'gold', crit: 'gold' };

type Listener = (e: FxEvent) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function onFx(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function emit(e: FxEvent) {
  if (!motionOn()) return;
  for (const l of listeners) l(e);
}

/** Where the finger last touched the screen, so an effect can start at the button that caused it. */
let lastTap: { x: number; y: number; at: number } | null = null;

/** Call once at startup. */
export function initFx() {
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastTap = { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    { capture: true, passive: true },
  );
  // iPhones only apply :active (the press feedback on buttons) while something listens for touches.
  document.addEventListener('touchstart', () => {}, { passive: true });
}

/** Whether this phone was tapped a moment ago, i.e. what just happened was probably done here. */
export function tappedJustNow(): boolean {
  return lastTap !== null && Date.now() - lastTap.at < 2000;
}

type Origin = { x: number; y: number } | Element | null | undefined;

function point(origin: Origin): { x: number; y: number } {
  if (origin instanceof Element) {
    const r = origin.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  if (origin) return origin;
  // A tap moments ago caused this (Cast, Use, Attack): start there. Otherwise (the DM did it) upper middle.
  if (lastTap && tappedJustNow()) return { x: lastTap.x, y: lastTap.y };
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.3 };
}

/** A short effect at a point: the last tap by default, or an element's middle, or a position. */
export function burst(kind: BurstKind, origin?: Origin, tint?: Tint) {
  const { x, y } = point(origin);
  emit({ id: nextId++, type: 'burst', kind, x, y, tint: tint ?? KIND_TINT[kind] });
}

/** A glow over the whole screen. `level` shows `title` ("Level 5") and `sub` (the character's name). */
export function screenFx(kind: ScreenKind, text?: { title: string; sub?: string }) {
  emit({ id: nextId++, type: 'screen', kind, ...text });
}

/** Each school of magic has its colour; spells without one (homebrew) are arcane blue. */
const SCHOOL_TINT: Record<string, Tint> = {
  abjuration: 'info',
  conjuration: 'gold',
  divination: 'info',
  enchantment: 'gold',
  evocation: 'warn',
  illusion: 'info',
  necromancy: 'ok',
  transmutation: 'gold',
};

/** The colour for what a character just did: a spell's school, else the usual colour of that kind of action. */
export function actionTint(c: CharacterData, content: Content | null): Tint | undefined {
  const a = c.lastAction;
  if (a?.kind !== 'spell') return undefined;
  const ref = c.spells.find((s) => s.name === a.name)?.ref;
  const school = ref ? content?.spell(ref)?.school : undefined;
  return school ? SCHOOL_TINT[school.toLowerCase()] : undefined;
}

/** Shakes, pops and the like on an element that is already on the page, without re-creating it. */
const MOVES = {
  /** Hit: a quick sideways shake. */
  shake: {
    frames: [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'translateX(2px)' },
      { transform: 'translateX(0)' },
    ],
    ms: 320,
  },
  /** Something good arrived: swell a little and settle. */
  pop: { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], ms: 320 },
} as const;

export function move(el: Element | null | undefined, name: keyof typeof MOVES) {
  if (!el || !motionOn() || typeof el.animate !== 'function') return;
  const m = MOVES[name];
  el.animate(m.frames as unknown as Keyframe[], { duration: m.ms, easing: 'ease-out' });
}
