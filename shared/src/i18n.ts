/**
 * Languages. The app is written in English; every text a person reads goes
 * through `t()`, which looks the English text up in the dictionary of the
 * chosen language (shared/src/i18n/de.ts) and falls back to the English.
 *
 *   t('Join a session')
 *   t('{who} took {n} damage.', { who, n })
 *   plural(n, '{n} round', '{n} rounds')
 *   t('Light##theme')      one English word, two meanings: the part after ## only tells them apart
 *
 * The language is one global of the running program: the phone sets it from
 * its Settings (client/src/settings.ts), the server never does and so always
 * writes English. That is on purpose: whatever is stored (characters, the
 * session log, the last action) and whatever the server answers stays English,
 * and each phone translates it when showing it, with `tx()`. Two phones in
 * one session can have different languages.
 *
 * Rules that follow from it:
 * - Never store a translated text, and never compare against one. `t()` and
 *   `tx()` are for the last step before the screen.
 * - A text built at module level (`const TABS = [{ label: msg('Roster') }]`)
 *   is marked with `msg()` and translated where it is drawn (`t(tab.label)`).
 * - shared/src/i18n.test.ts fails when a text in the code has no German.
 */
import { DE, DE_ANYWHERE } from './i18n/de.ts';

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language in its own words, for the picker. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', de: 'Deutsch' };

const DICTIONARIES: Record<Language, Record<string, string> | null> = { en: null, de: DE };
/** The part of a dictionary that `tx()` may recognise in a finished English sentence. */
const SENTENCES: Record<Language, Record<string, string>> = { en: {}, de: DE_ANYWHERE };

let current: Language = 'en';

export function setLanguage(language: Language) {
  current = LANGUAGES.includes(language) ? language : 'en';
}

export function getLanguage(): Language {
  return current;
}

/** The language of a phone ("de-AT" -> German), English for anything we have no texts for. */
export function languageFor(locale: string | undefined | null): Language {
  const short = (locale ?? '').slice(0, 2).toLowerCase();
  return LANGUAGES.includes(short as Language) ? (short as Language) : 'en';
}

export type Vars = Record<string, string | number>;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : text;

/** "Light##theme" -> "Light" */
const plain = (key: string) => {
  const at = key.indexOf('##');
  return at < 0 ? key : key.slice(0, at);
};

/** The text in the chosen language, `{name}` filled in from `vars`. */
export function t(text: string, vars?: Vars): string {
  return fill(DICTIONARIES[current]?.[text] ?? plain(text), vars);
}

/**
 * A rules text of the game content (a condition's description), which the
 * dictionary may hold under an id like "condition:blinded". The content
 * itself is English; without an entry the English text is shown.
 */
export function ruleText(id: string, english: string): string {
  return DICTIONARIES[current]?.[id] ?? english;
}

/** Marks a text for translation without translating it yet (module-level constants). Draw it with `t()`. */
export const msg = (text: string): string => text;

/** `t()` for a count: `one` when n is 1, `many` otherwise; `{n}` is filled in. */
export function plural(n: number, one: string, many: string, vars?: Vars): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

/** Dice as the language writes them: "2d6+3", German "2W6+3" (W for Würfel). */
export const diceText = (dice: string): string => (current === 'de' ? dice.replace(/\b(\d*)d(\d+)\b/g, '$1W$2') : dice);

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
/** "1st", "2nd", ... as far as spell levels go; German writes "1." */
export const ordinal = (n: number): string => (current === 'de' ? `${n}.` : (ORDINALS[n] ?? `${n}th`));

// ---------- texts that were made in English somewhere else ----------

interface Pattern {
  /** Letters outside the placeholders: the more, the more specific the pattern. */
  weight: number;
  re: RegExp;
  names: string[];
  to: string;
}

const patternCache = new Map<Language, Pattern[]>();

/** Placeholders that are always a number: "{n} feet" is "60 feet" and never "Boots of the feet". */
const NUMBER = '(-?\\d[\\d,]*)';
const SHAPE_OF: Record<string, string> = { n: NUMBER, min: NUMBER, max: NUMBER, cap: NUMBER, die: NUMBER, nth: '(\\d(?:st|nd|rd|th))' };

/** Every dictionary text with `{placeholders}`, turned around: a pattern that recognises the finished English sentence. */
function patterns(language: Language): Pattern[] {
  let list = patternCache.get(language);
  if (list) return list;
  list = [];
  for (const [key, to] of Object.entries(SENTENCES[language])) {
    if (!key.includes('{')) continue;
    const english = plain(key);
    const names: string[] = [];
    const literal = english.replace(/\{(\w+)\}/g, '');
    // "{who} {what}." would match any sentence.
    if (literal.replace(/[^\p{L}]/gu, '').length < 4) continue;
    const source = english
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // The same placeholder twice must be the same text twice.
        const again = names.indexOf(m[1]!);
        if (again >= 0) return `\\${again + 1}`;
        names.push(m[1]!);
        return SHAPE_OF[m[1]!] ?? '([\\s\\S]+?)';
      })
      .join('');
    list.push({ weight: literal.length, re: new RegExp(`^${source}$`), names, to });
  }
  list.sort((a, b) => b.weight - a.weight);
  patternCache.set(language, list);
  return list;
}

/** Special shapes that no single dictionary text describes. */
const SHAPES: Array<(text: string) => string | null> = [
  // describeRoll(): "Stealth check: 19 (14 + 5)", "Longsword damage: 9 slashing (6 + 3)"
  (text) => {
    const m = /^(.+): (-?\d+)( [a-z]+)? \((.+)\)$/.exec(text);
    if (!m) return null;
    const [, label, total, note, how] = m;
    const breakdown = how!
      .split(', ')
      .map((part) => {
        const keeps = /^keeps (-?\d+)(.*)$/.exec(part);
        if (keeps) return `${t('keeps {n}', { n: keeps[1]! })}${keeps[2]}`;
        const natural = /^natural (\d+)$/.exec(part);
        if (natural) return t('natural {n}', { n: natural[1]! });
        if (/^\d+( and \d+)+$/.test(part)) return part.split(' and ').join(` ${t('and')} `);
        return tx(part);
      })
      .join(', ');
    return `${tx(label!)}: ${total}${note ? ` ${tx(note.trim())}` : ''} (${breakdown})`;
  },
  // "12/20 HP", "+7 HP"
  (text) => {
    const m = /^(\+?\d+(?:\/\d+)?) HP$/.exec(text);
    return m ? `${m[1]} ${t('HP')}` : null;
  },
  // Coins: "5 gp", "1,500 GP"
  (text) => {
    const m = /^([\d,.]+) (cp|sp|ep|gp|pp)$/i.exec(text);
    return m ? `${m[1]} ${t(m[2]!.toLowerCase())}` : null;
  },
  // What a roll leaves as the last action: "19 · natural 20", "9 slashing"
  (text) => {
    const m = /^(-?\d+) (?:· )?([a-z][a-z0-9 ]*)$/.exec(text);
    if (!m) return null;
    const rest = tx(m[2]!);
    return rest === m[2] ? null : `${m[1]}${text.includes('·') ? ' ·' : ''} ${rest}`;
  },
  (text) => {
    const m = /^natural (\d+)$/.exec(text);
    return m ? t('natural {n}', { n: m[1]! }) : null;
  },
  // "2× Rope", "Fire Bolt ×3"
  (text) => {
    const before = /^(\d+)× (.+)$/.exec(text);
    if (before) return `${before[1]}× ${tx(before[2]!)}`;
    const after = /^(.+) ×(\d+)$/.exec(text);
    return after ? `${tx(after[1]!)} ×${after[2]}` : null;
  },
  // "Fire Bolt (cantrip)", "Rage (2)"
  (text) => {
    const m = /^(.+) \(([^()]+)\)$/.exec(text);
    if (!m) return null;
    const inner = tx(m[2]!);
    const outer = tx(m[1]!);
    return inner === m[2] && outer === m[1] ? null : `${outer} (${inner})`;
  },
  // Lists: "Hit Die, 12/20 HP", "5 gp, 3 sp". Only when every part is known, or "Poison, Basic" would be one.
  (text) => {
    if (!text.includes(', ')) return null;
    const parts = text.split(', ');
    const done = parts.map((p) => tx(p));
    return done.every((p, i) => p !== parts[i]) ? done.join(', ') : null;
  },
  // "Goblin 2": a numbered copy
  (text) => {
    const m = /^(.+) (\d+)$/.exec(text);
    if (!m) return null;
    const name = tx(m[1]!);
    return name === m[1] ? null : `${name} ${m[2]}`;
  },
];

let depth = 0;

/**
 * Translates a text that was put together in English before it got here: an
 * error from the server, a line of the session log, the name of a class or a
 * condition, a roll. Tries the whole text, then the dictionary's sentences
 * with their `{placeholders}` (what was filled in is translated too), then a
 * few special shapes. Whatever it doesn't know comes back unchanged, so names
 * the players made up pass through.
 */
export function tx(text: string): string {
  const dict = DICTIONARIES[current];
  if (!dict || !text) return text;
  const exact = dict[text];
  if (exact !== undefined) return exact;
  if (depth > 4 || text.length > 600) return text;
  depth += 1;
  try {
    for (const p of patterns(current)) {
      const m = p.re.exec(text);
      if (!m) continue;
      const vars: Vars = {};
      p.names.forEach((name, i) => (vars[name] = tx(m[i + 1]!)));
      return fill(p.to, vars);
    }
    for (const shape of SHAPES) {
      const done = shape(text);
      if (done !== null) return done;
    }
    return text;
  } finally {
    depth -= 1;
  }
}

const reverseCache = new Map<Language, Map<string, string>>();

/**
 * The other way round, for the few things people type that the rules look up
 * by their English name (class, species, background): "Magier" -> "Wizard".
 * Anything else comes back as typed.
 */
export function toEnglish(text: string): string {
  const dict = DICTIONARIES[current];
  if (!dict) return text;
  let reverse = reverseCache.get(current);
  if (!reverse) {
    reverse = new Map();
    // Single names only: sentences and texts with placeholders are never typed in.
    for (const [key, to] of Object.entries(dict)) {
      if (key.includes('{') || key.includes('##') || key.length > 40 || !/^\p{Lu}/u.test(key)) continue;
      if (!reverse.has(to.toLowerCase())) reverse.set(to.toLowerCase(), key);
    }
    reverseCache.set(current, reverse);
  }
  return reverse.get(text.trim().toLowerCase()) ?? text;
}

/** "a, b and c" */
export function listing(items: string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${t('and')} ${items[items.length - 1]}`;
}
