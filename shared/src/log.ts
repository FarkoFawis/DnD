/**
 * Session log: what happened at the table, recorded automatically while a
 * session runs, and turned into a "Last time on ..." recap for the DM.
 */
import { plural, t, tx } from './i18n.ts';

export const LOG_KINDS = [
  'start', // session started; `what` = who is playing
  'end',
  'join', // a player joined late
  'damage', // a player character took `amount` damage
  'heal',
  'down', // a player character dropped to 0 HP
  'deathSave', // `what` = how it went
  'loot', // got an item / coins; `what` = "2× Rope"
  'lost', // gave away / used up / paid
  'used', // cast a spell or used an ability; `what` = its name
  'roll', // a roll of the dice roller; `what` = "Stealth check: 19 (14 + 5)"
  'rest', // `what` = 'short' | 'long'; who '' = the whole party
  'level', // reached level `amount`
  'fight', // a fight started; `what` = the opponents
  'hit', // an opponent took `amount` damage
  'defeated', // an opponent dropped to 0 HP or was removed at 0
  'fightEnd', // `amount` = rounds
  'handout', // the DM showed a handout; `what` = its title
  'inspiration', // Heroic Inspiration; `what` = 'gained' | 'used'
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export interface LogEvent {
  kind: LogKind;
  /** Character or opponent the entry is about ('' for the whole table). */
  who: string;
  amount?: number;
  what?: string;
}

export interface LogEntry extends LogEvent {
  id: number;
  /** 1 for the campaign's first session, 2 for the second, ... */
  session: number;
  /** SQLite UTC timestamp, "2026-11-19 21:03:47". */
  at: string;
}

/** One line for the log list, in the language of this phone (the entries themselves are stored in English). */
export function describeLogEntry(e: LogEvent): string {
  const n = e.amount ?? 0;
  const who = e.who;
  const what = tx(e.what ?? '');
  const extra = e.what ? ` (${what})` : '';
  switch (e.kind) {
    case 'start': return e.what ? t('Session started with {players}.', { players: e.what }) : t('Session started.');
    case 'end': return t('Session ended.');
    case 'join': return t('{who} joined.', { who });
    case 'damage': return `${t('{who} took {n} damage', { who, n })}${extra}.`;
    case 'heal': return `${t('{who} regained {n} HP', { who, n })}${extra}.`;
    case 'down': return t('{who} dropped to 0 HP.', { who });
    case 'deathSave': return t('{who} made a death save: {what}.', { who, what });
    case 'loot': return t('{who} got {what}.', { who, what });
    case 'lost': return t('{who} lost {what}.', { who, what });
    case 'used': return t('{who} used {what}.', { who, what });
    case 'roll': return t('{who} rolled {what}.', { who, what });
    case 'rest':
      if (!who) return e.what === 'long' ? t('The party took a long rest.') : t('The party took a short rest.');
      return e.what === 'long' ? t('{who} took a long rest.', { who }) : t('{who} took a short rest.', { who });
    case 'level': return t('{who} reached level {n}.', { who, n });
    case 'fight': return e.what ? t('A fight broke out against {opponents}.', { opponents: e.what }) : t('A fight broke out.');
    case 'hit': return t('{who} took {n} damage.', { who, n });
    case 'defeated': return t('{who} was defeated.', { who });
    case 'fightEnd': return plural(n, 'The fight ended after {n} round.', 'The fight ended after {n} rounds.');
    case 'handout': return t('The DM showed "{title}".', { title: e.what ?? '' });
    case 'inspiration': return e.what === 'used' ? t('{who} used Heroic Inspiration.', { who }) : t('{who} gained Heroic Inspiration.', { who });
  }
}

export interface Recap {
  session: number;
  /** Timestamp of the first entry. */
  at: string;
  players: string;
  fights: { opponents: string; rounds: number | null; defeated: string[] }[];
  /** Per character: totals over the session. */
  characters: { who: string; damage: number; healed: number; downs: number; loot: string[]; lost: string[]; used: string[]; level: number | null }[];
  handouts: string[];
  /** Rests of the whole party, in order: 'short' | 'long'. */
  rests: string[];
}

/** "Fire Bolt ×3, Shield" */
function tally(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([name, c]) => (c > 1 ? `${name} ×${c}` : name));
}

/** Sums up one session's entries (all with the same `session`). */
export function buildRecap(entries: LogEntry[]): Recap | null {
  if (entries.length === 0) return null;
  const recap: Recap = { session: entries[0]!.session, at: entries[0]!.at, players: '', fights: [], characters: [], handouts: [], rests: [] };
  const used = new Map<string, string[]>();
  const of = (who: string) => {
    let c = recap.characters.find((x) => x.who === who);
    if (!c) recap.characters.push((c = { who, damage: 0, healed: 0, downs: 0, loot: [], lost: [], used: [], level: null }));
    return c;
  };
  let fight: Recap['fights'][number] | null = null;
  for (const e of entries) {
    switch (e.kind) {
      case 'start': recap.players = e.what ?? ''; break;
      case 'damage': of(e.who).damage += e.amount ?? 0; break;
      case 'heal': of(e.who).healed += e.amount ?? 0; break;
      case 'down': of(e.who).downs += 1; break;
      case 'loot': if (e.what) of(e.who).loot.push(e.what); break;
      case 'lost': if (e.what) of(e.who).lost.push(e.what); break;
      case 'used': if (e.what) { of(e.who); used.set(e.who, [...(used.get(e.who) ?? []), e.what]); } break;
      case 'level': of(e.who).level = e.amount ?? null; break;
      case 'fight': recap.fights.push((fight = { opponents: e.what ?? '', rounds: null, defeated: [] })); break;
      case 'defeated': fight?.defeated.push(e.who); break;
      case 'fightEnd': if (fight) fight.rounds = e.amount ?? null; fight = null; break;
      case 'rest': if (e.who === '' && e.what) recap.rests.push(e.what); break;
      case 'handout': if (e.what && !recap.handouts.includes(e.what)) recap.handouts.push(e.what); break;
      default: break;
    }
  }
  for (const c of recap.characters) c.used = tally(used.get(c.who) ?? []);
  return recap;
}

/** The recap as sentences, ready to read out, in the language of this phone. */
export function recapLines(r: Recap): string[] {
  const lines: string[] = [];
  const list = (items: string[]) => items.map((i) => tx(i)).join(', ');
  if (r.players) lines.push(t('At the table: {players}.', { players: r.players }));
  for (const f of r.fights) {
    const head = f.opponents ? t('Fight against {opponents}', { opponents: f.opponents }) : f.rounds ? t('Fight') : t('A fight');
    const rounds = f.rounds ? `, ${plural(f.rounds, '{n} round', '{n} rounds')}` : '';
    const dead = f.defeated.length ? ` ${t('Defeated: {names}.', { names: f.defeated.join(', ') })}` : '';
    lines.push(`${head}${rounds}.${dead}`);
  }
  for (const c of r.characters) {
    const parts: string[] = [];
    if (c.level) parts.push(t('reached level {n}', { n: c.level }));
    if (c.damage) parts.push(t('took {n} damage', { n: c.damage }));
    if (c.healed) parts.push(t('regained {n} HP', { n: c.healed }));
    if (c.downs) parts.push(c.downs === 1 ? t('dropped to 0 HP once') : t('dropped to 0 HP {n} times', { n: c.downs }));
    if (c.used.length) parts.push(t('used {what}', { what: list(c.used) }));
    if (c.loot.length) parts.push(t('got {what}', { what: list(c.loot) }));
    if (c.lost.length) parts.push(t('lost {what}', { what: list(c.lost) }));
    if (parts.length) lines.push(`${c.who} ${parts.join('; ')}.`);
  }
  if (r.rests.length) lines.push(t('The party rested: {rests}.', { rests: tally(r.rests.map((k) => (k === 'long' ? t('long rest') : t('short rest')))).join(', ') }));
  if (r.handouts.length) lines.push(t('Handouts shown: {titles}.', { titles: r.handouts.join(', ') }));
  return lines;
}

/** A log timestamp ("2026-11-19 21:03:47", UTC) as milliseconds. */
export function logTime(at: string): number {
  const ms = Date.parse(`${at.replace(' ', 'T')}Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * What every phone shows when the DM ends a session: the evening in numbers.
 * Unlike the recap it is for the players too, so it never names an opponent
 * (one of them may still be a secret).
 */
export interface SessionSummary {
  session: number;
  campaign: string;
  /** From the first to the last entry of the log. */
  minutes: number;
  fights: number;
  rounds: number;
  /** Opponents defeated. */
  defeated: number;
  rests: { short: number; long: number };
  characters: {
    who: string;
    damage: number;
    healed: number;
    downs: number;
    /** Spells cast and abilities used. */
    used: number;
    /** The one used most often, if any was used at least twice. */
    favourite: string | null;
    loot: string[];
    /** The level reached this session, if any. */
    level: number | null;
  }[];
}

/**
 * Sums up one session for the summary screen. `players` are the characters at
 * the table when it ended; they come first, in that order, also when nothing
 * was logged about them. Characters who left earlier follow.
 */
export function buildSummary(entries: LogEntry[], about: { campaign: string; players: string[] }): SessionSummary | null {
  const recap = buildRecap(entries);
  if (!recap) return null;
  const names = [...about.players, ...recap.characters.map((c) => c.who).filter((who) => !about.players.includes(who))];
  const uses = (who: string) => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.kind !== 'used' || e.who !== who || !e.what) continue;
      // "Fire Bolt (cantrip)" and "Fire Bolt (1st-level slot)" are the same thing used.
      const name = e.what.replace(/ \([^)]*\)$/, '');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    return { used: [...counts.values()].reduce((a, b) => a + b, 0), favourite: top && top[1] > 1 ? top[0] : null };
  };
  return {
    session: recap.session,
    campaign: about.campaign,
    minutes: Math.max(0, Math.round((logTime(entries[entries.length - 1]!.at) - logTime(entries[0]!.at)) / 60000)),
    fights: recap.fights.length,
    rounds: recap.fights.reduce((sum, f) => sum + (f.rounds ?? 0), 0),
    defeated: recap.fights.reduce((sum, f) => sum + f.defeated.length, 0),
    rests: { short: recap.rests.filter((r) => r === 'short').length, long: recap.rests.filter((r) => r === 'long').length },
    characters: names.map((who) => {
      const c = recap.characters.find((x) => x.who === who);
      return {
        who,
        damage: c?.damage ?? 0,
        healed: c?.healed ?? 0,
        downs: c?.downs ?? 0,
        ...uses(who),
        loot: c?.loot ?? [],
        level: c?.level ?? null,
      };
    }),
  };
}

/** Minutes as hours and minutes: 125 -> "2:05", 45 -> "0:45". */
export function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
