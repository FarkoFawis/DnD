import { useEffect, useState } from 'react';
import { LANGUAGES, languageFor, setLanguage, type Language } from '@dnd/shared';

/**
 * Settings of this phone, kept in localStorage (they are about how the app
 * looks to whoever holds the phone, so the server doesn't need them).
 */
export const THEMES = ['default', 'light', 'black'] as const;
export type Theme = (typeof THEMES)[number];

/** The page colour of each theme, for the browser's own bars around the app. */
const THEME_BAR: Record<Theme, string> = { default: '#1c1917', light: '#fafaf9', black: '#000000' };

export interface Settings {
  /**
   * Show the small grey texts that explain the screen ("Tap a player to open
   * their sheet…"). Anything marked with the `hint` class disappears when off.
   */
  hints: boolean;
  /**
   * The dice roller: tapping a skill, save or attack on your sheet rolls it and
   * shows the DM the result. Off by default, real dice stay the normal way.
   */
  dice: boolean;
  /** The colours of the app: styles.css defines a set of colour tokens per theme. */
  theme: Theme;
  /**
   * Animations and effects (pages sliding in, the burst when a spell is cast,
   * numbers counting). Off: everything simply appears. A phone set to "reduce
   * motion" never gets them, whatever this says.
   */
  effects: boolean;
  /**
   * The language of the texts (shared/src/i18n.ts). A phone that never chose
   * one gets its own language if we have it, English otherwise.
   */
  language: Language;
}

const KEY = 'dnd.settings';
/** What the phone itself is set to: the first of its languages that we have texts for. */
function phoneLanguage(): Language {
  const wanted = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const locale of wanted) {
    const short = (locale ?? '').slice(0, 2).toLowerCase();
    if (LANGUAGES.includes(short as Language)) return languageFor(locale);
  }
  return 'en';
}

const DEFAULTS: Settings = { hints: true, dice: false, theme: 'default', effects: true, language: phoneLanguage() };
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const saved = raw && typeof raw === 'object' ? (raw as Partial<Settings>) : {};
    return {
      hints: typeof saved.hints === 'boolean' ? saved.hints : DEFAULTS.hints,
      dice: typeof saved.dice === 'boolean' ? saved.dice : DEFAULTS.dice,
      theme: THEMES.includes(saved.theme as Theme) ? (saved.theme as Theme) : DEFAULTS.theme,
      effects: typeof saved.effects === 'boolean' ? saved.effects : DEFAULTS.effects,
      language: LANGUAGES.includes(saved.language as Language) ? (saved.language as Language) : DEFAULTS.language,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();

/** The phone itself asks for less motion (an accessibility setting of Android and iOS). */
const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Puts the settings on <html>, where styles.css reads them. index.html does the same for the theme before the app loads. */
function apply(s: Settings) {
  const root = document.documentElement;
  // Before anything is drawn: every t() from here on answers in this language.
  setLanguage(s.language);
  root.lang = s.language;
  root.dataset.hints = s.hints ? 'on' : 'off';
  root.dataset.theme = s.theme;
  // motion.css hangs every animation on this; effects in code ask motionOn().
  root.dataset.motion = s.effects && !reducedMotion?.matches ? 'on' : 'off';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BAR[s.theme]);
}

/** Call once before the first render. */
export function initSettings() {
  apply(current);
  reducedMotion?.addEventListener?.('change', () => apply(current));
}

/** Whether animations and effects may play right now (the Settings switch, and the phone's "reduce motion"). */
export function motionOn(): boolean {
  return document.documentElement.dataset.motion !== 'off';
}

export function changeSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* blocked storage: the setting lasts until the page is closed */
  }
  apply(current);
  for (const l of listeners) l(current);
}

export function useSettings(): Settings {
  const [settings, setSettings] = useState(current);
  useEffect(() => {
    listeners.add(setSettings);
    setSettings(current);
    return () => void listeners.delete(setSettings);
  }, []);
  return settings;
}
