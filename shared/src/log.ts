/**
 * Session log: what happened at the table, recorded automatically while a
 * session runs, and turned into a "Last time on ..." recap for the DM.
 */

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

/** One line for the log list. */
export function describeLogEntry(e: LogEvent): string {
  const n = e.amount ?? 0;
  switch (e.kind) {
    case 'start': return e.what ? `Session started with ${e.what}.` : 'Session started.';
    case 'end': return 'Session ended.';
    case 'join': return `${e.who} joined.`;
    case 'damage': return `${e.who} took ${n} damage${e.what ? ` (${e.what})` : ''}.`;
    case 'heal': return `${e.who} regained ${n} HP${e.what ? ` (${e.what})` : ''}.`;
    case 'down': return `${e.who} dropped to 0 HP.`;
    case 'deathSave': return `${e.who} made a death save: ${e.what}.`;
    case 'loot': return `${e.who} got ${e.what}.`;
    case 'lost': return `${e.who} lost ${e.what}.`;
    case 'used': return `${e.who} used ${e.what}.`;
    case 'roll': return `${e.who} rolled ${e.what}.`;
    case 'rest': return `${e.who || 'The party'} took a ${e.what} rest.`;
    case 'level': return `${e.who} reached level ${n}.`;
    case 'fight': return e.what ? `A fight broke out against ${e.what}.` : 'A fight broke out.';
    case 'hit': return `${e.who} took ${n} damage.`;
    case 'defeated': return `${e.who} was defeated.`;
    case 'fightEnd': return `The fight ended after ${n} ${n === 1 ? 'round' : 'rounds'}.`;
    case 'handout': return `The DM showed "${e.what}".`;
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

/** The recap as sentences, ready to read out. */
export function recapLines(r: Recap): string[] {
  const lines: string[] = [];
  if (r.players) lines.push(`At the table: ${r.players}.`);
  for (const f of r.fights) {
    const who = f.opponents ? `against ${f.opponents}` : '';
    const rounds = f.rounds ? `, ${f.rounds} ${f.rounds === 1 ? 'round' : 'rounds'}` : '';
    const dead = f.defeated.length ? ` Defeated: ${f.defeated.join(', ')}.` : '';
    lines.push(`Fight ${who}${rounds}.${dead}`.replace('Fight ,', 'Fight,').replace('Fight .', 'A fight.'));
  }
  for (const c of r.characters) {
    const parts: string[] = [];
    if (c.level) parts.push(`reached level ${c.level}`);
    if (c.damage) parts.push(`took ${c.damage} damage`);
    if (c.healed) parts.push(`regained ${c.healed} HP`);
    if (c.downs) parts.push(`dropped to 0 HP ${c.downs === 1 ? 'once' : `${c.downs} times`}`);
    if (c.used.length) parts.push(`used ${c.used.join(', ')}`);
    if (c.loot.length) parts.push(`got ${c.loot.join(', ')}`);
    if (c.lost.length) parts.push(`lost ${c.lost.join(', ')}`);
    if (parts.length) lines.push(`${c.who} ${parts.join('; ')}.`);
  }
  if (r.rests.length) lines.push(`The party rested: ${tally(r.rests.map((k) => `${k} rest`)).join(', ')}.`);
  if (r.handouts.length) lines.push(`Handouts shown: ${r.handouts.join(', ')}.`);
  return lines;
}
