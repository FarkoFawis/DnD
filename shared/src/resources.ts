/**
 * Limited-use things on a 2024 character: spell slots, Pact Magic slots and
 * class/species features with a number of uses, and what a Short or Long Rest
 * gives back. Pure and tested (resources.test.ts).
 *
 * The sheet stores only how many of each are spent (`CharacterData.used`, keyed
 * by the ids below). The maximums are always computed from class, level and
 * ability scores, so a level-up or a new score changes them with no migration.
 */
import type { CharacterData, Concentration, LastAction } from './protocol.ts';
import { abilityModifier, proficiencyBonus } from './rules.ts';
import { applyDamageOrHealing, isDead } from './status.ts';

/** How a rest refreshes something. `shortOne`: one use back on a Short Rest, all on a Long Rest. */
export type ResetOn = 'short' | 'shortOne' | 'long';

export interface LimitedUse {
  /** Key in CharacterData.used. */
  id: string;
  name: string;
  max: number;
  resetOn: ResetOn;
  /** A pool of points spent several at a time (Lay on Hands, Focus Points, Sorcery Points). */
  pool?: boolean;
  /** Feature ref for its description (see describeRef). */
  ref?: string;
}

export interface SlotRow {
  /** Spell level of the slots. */
  level: number;
  /** Key in CharacterData.used: "slot1".."slot9", or "pact" for Warlock Pact Magic. */
  id: string;
  max: number;
  pact?: boolean;
}

/** 2024 full-caster spell slots by caster level (index 0 = level 1), slot levels 1-9. */
const FULL_CASTER: number[][] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const FULL = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'];
const HALF = ['paladin', 'ranger'];
/** Subclasses that cast like a third caster (their own book; matched by name). */
const THIRD_SUBCLASSES = ['eldritch knight', 'arcane trickster'];

const norm = (s: string) => s.trim().toLowerCase();
const clampLevel = (l: number) => Math.min(20, Math.max(1, Math.floor(l)));

/** Caster level for the slot table: full = level, half = level/2 rounded up, third = level/3 rounded up from 3. */
export function casterLevel(c: Pick<CharacterData, 'className' | 'subclass' | 'level'>): number {
  const cls = norm(c.className);
  const level = clampLevel(c.level);
  if (FULL.includes(cls)) return level;
  if (HALF.includes(cls)) return Math.ceil(level / 2);
  if (THIRD_SUBCLASSES.includes(norm(c.subclass)) && level >= 3) return Math.ceil(level / 3);
  return 0;
}

/** Spell slots (and Pact Magic) the character has at its level. */
export function spellSlots(c: Pick<CharacterData, 'className' | 'subclass' | 'level'>): SlotRow[] {
  const level = clampLevel(c.level);
  if (norm(c.className) === 'warlock') {
    const count = level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1;
    const slotLevel = Math.min(5, Math.ceil(level / 2));
    return [{ level: slotLevel, id: 'pact', max: count, pact: true }];
  }
  const cl = casterLevel(c);
  if (cl === 0) return [];
  return FULL_CASTER[cl - 1]!.map((max, i) => ({ level: i + 1, id: `slot${i + 1}`, max }));
}

const byLevel = (level: number, steps: [number, number][]) => {
  let v = 0;
  for (const [from, n] of steps) if (level >= from) v = n;
  return v;
};

/** Class and species features with limited uses (2024 SRD), plus the character's own custom ones. */
export function limitedUses(c: CharacterData): LimitedUse[] {
  const level = clampLevel(c.level);
  const pb = proficiencyBonus(level);
  const mod = (a: keyof CharacterData['abilities']) => abilityModifier(c.abilities[a]);
  const cls = norm(c.className);
  const cref = (name: string) => `class:${cls}:${name}`;
  const out: LimitedUse[] = [];
  const add = (u: LimitedUse) => {
    if (u.max > 0) out.push(u);
  };

  switch (cls) {
    case 'barbarian':
      add({ id: 'rage', name: 'Rage', resetOn: 'shortOne', ref: cref('Rage'),
        max: byLevel(level, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]) });
      break;
    case 'bard':
      add({ id: 'bardic-inspiration', name: 'Bardic Inspiration', ref: cref('Bardic Inspiration'),
        resetOn: level >= 5 ? 'short' : 'long', max: Math.max(1, mod('cha')) });
      break;
    case 'cleric':
      add({ id: 'channel-divinity', name: 'Channel Divinity', resetOn: 'shortOne', ref: cref('Channel Divinity'),
        max: byLevel(level, [[2, 2], [6, 3], [18, 4]]) });
      break;
    case 'druid':
      add({ id: 'wild-shape', name: 'Wild Shape', resetOn: 'shortOne', ref: cref('Wild Shape'),
        max: byLevel(level, [[2, 2], [6, 3], [17, 4]]) });
      break;
    case 'fighter':
      add({ id: 'second-wind', name: 'Second Wind', resetOn: 'shortOne', ref: cref('Second Wind'),
        max: byLevel(level, [[1, 2], [4, 3], [10, 4]]) });
      add({ id: 'action-surge', name: 'Action Surge', resetOn: 'short', ref: cref('Action Surge'),
        max: byLevel(level, [[2, 1], [17, 2]]) });
      add({ id: 'indomitable', name: 'Indomitable', resetOn: 'long', ref: cref('Indomitable'),
        max: byLevel(level, [[9, 1], [13, 2], [17, 3]]) });
      break;
    case 'monk':
      add({ id: 'focus', name: 'Focus Points', resetOn: 'short', pool: true, ref: cref("Monk's Focus"),
        max: level >= 2 ? level : 0 });
      break;
    case 'paladin':
      add({ id: 'lay-on-hands', name: 'Lay on Hands (HP)', resetOn: 'long', pool: true, ref: cref('Lay On Hands'),
        max: 5 * level });
      add({ id: 'channel-divinity', name: 'Channel Divinity', resetOn: 'shortOne', ref: cref('Channel Divinity'),
        max: byLevel(level, [[3, 2], [11, 3]]) });
      break;
    case 'ranger':
      add({ id: 'favored-enemy', name: "Favored Enemy (free Hunter's Mark)", resetOn: 'long', ref: cref('Favored Enemy'),
        max: byLevel(level, [[1, 2], [5, 3], [9, 4], [13, 5], [17, 6]]) });
      break;
    case 'rogue':
      add({ id: 'stroke-of-luck', name: 'Stroke of Luck', resetOn: 'short', ref: cref('Stroke of Luck'),
        max: level >= 20 ? 1 : 0 });
      break;
    case 'sorcerer':
      add({ id: 'innate-sorcery', name: 'Innate Sorcery', resetOn: 'long', ref: cref('Innate Sorcery'), max: 2 });
      add({ id: 'sorcery-points', name: 'Sorcery Points', resetOn: 'long', pool: true, ref: cref('Font of Magic'),
        max: level >= 2 ? level : 0 });
      break;
    case 'warlock':
      add({ id: 'magical-cunning', name: 'Magical Cunning', resetOn: 'long', ref: cref('Magical Cunning'),
        max: level >= 2 ? 1 : 0 });
      break;
    case 'wizard':
      add({ id: 'arcane-recovery', name: 'Arcane Recovery', resetOn: 'long', ref: cref('Arcane Recovery'), max: 1 });
      break;
  }

  const sp = norm(c.species);
  const sref = (name: string) => `species:${sp}:${name}`;
  switch (sp) {
    case 'dragonborn':
      add({ id: 'breath-weapon', name: 'Breath Weapon', resetOn: 'long', max: pb });
      add({ id: 'draconic-flight', name: 'Draconic Flight', resetOn: 'long', ref: sref('Draconic Flight'), max: level >= 5 ? 1 : 0 });
      break;
    case 'dwarf':
      add({ id: 'stonecunning', name: 'Stonecunning', resetOn: 'long', ref: sref('Stonecunning'), max: pb });
      break;
    case 'goliath':
      add({ id: 'giant-ancestry', name: 'Giant Ancestry', resetOn: 'long', ref: sref('Giant Ancestry'), max: pb });
      add({ id: 'large-form', name: 'Large Form', resetOn: 'long', ref: sref('Large Form'), max: level >= 5 ? 1 : 0 });
      break;
    case 'orc':
      add({ id: 'adrenaline-rush', name: 'Adrenaline Rush', resetOn: 'short', ref: sref('Adrenaline Rush'), max: pb });
      add({ id: 'relentless-endurance', name: 'Relentless Endurance', resetOn: 'long', ref: sref('Relentless Endurance'), max: 1 });
      break;
  }

  for (const r of c.customResources) add({ id: `custom:${r.id}`, name: r.name, max: r.max, resetOn: r.resetOn });
  return out;
}

export const used = (c: Pick<CharacterData, 'used'>, id: string) => c.used[id] ?? 0;

/** Slot levels a leveled spell can be cast with right now (lowest first), and whether it is a pact slot. */
export function castOptions(c: CharacterData, spellLevel: number): SlotRow[] {
  if (spellLevel <= 0) return [];
  return spellSlots(c).filter((s) => s.level >= spellLevel && used(c, s.id) < s.max);
}

export type UseRequest =
  | { kind: 'spell'; spellId: string; slot?: string; ritual?: boolean }
  | { kind: 'feature'; useId: string; amount?: number }
  | { kind: 'attack'; name: string };

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
export const ordinal = (n: number) => ORD[n] ?? `${n}th`;

/**
 * Spends what a use needs and returns the new `used` map plus what to show the
 * DM. Throws an Error with a friendly message when it isn't possible.
 */
export function applyUse(
  c: CharacterData,
  req: UseRequest,
  /** Whether the spell being cast needs concentration (from the content; the sheet doesn't store it). */
  spellInfo: { concentration?: boolean; ref?: string } = {},
): { used: Record<string, number>; action: Omit<LastAction, 'at'>; concentration?: Concentration } {
  const next = { ...c.used };
  if (req.kind === 'attack') {
    const name = req.name.trim().slice(0, 80);
    if (!name) throw new Error('Nothing to use.');
    return { used: next, action: { name, detail: 'attack', kind: 'attack' } };
  }
  if (req.kind === 'spell') {
    const spell = c.spells.find((s) => s.id === req.spellId);
    if (!spell) throw new Error('That spell is not on your sheet.');
    // A new concentration spell replaces the one being held.
    const conc = spellInfo.concentration
      ? { concentration: { name: spell.name, ...(spell.ref ? { ref: spell.ref } : {}), saveDc: null } }
      : {};
    if (spell.level === 0) return { used: next, action: { name: spell.name, detail: 'cantrip', kind: 'spell' }, ...conc };
    if (req.ritual) return { used: next, action: { name: spell.name, detail: 'ritual', kind: 'spell' }, ...conc };
    const slot = spellSlots(c).find((s) => s.id === (req.slot ?? castOptions(c, spell.level)[0]?.id));
    if (!slot) throw new Error(`No spell slots of level ${spell.level} or higher left.`);
    if (slot.level < spell.level) throw new Error(`${spell.name} needs a level ${spell.level} slot or higher.`);
    if (used(c, slot.id) >= slot.max) throw new Error(`No level ${slot.level} slots left.`);
    next[slot.id] = used(c, slot.id) + 1;
    return { used: next, action: { name: spell.name, detail: `${ordinal(slot.level)}-level slot`, kind: 'spell' }, ...conc };
  }
  const u = limitedUses(c).find((x) => x.id === req.useId);
  if (!u) throw new Error('That feature has no limited uses.');
  const amount = u.pool ? Math.floor(req.amount ?? 1) : 1;
  if (!(amount >= 1)) throw new Error('Invalid amount.');
  const left = u.max - used(c, u.id);
  if (left <= 0) throw new Error(`No uses of ${u.name} left. It comes back after a ${u.resetOn === 'long' ? 'Long' : 'Short or Long'} Rest.`);
  if (amount > left) throw new Error(`Only ${left} left.`);
  next[u.id] = used(c, u.id) + amount;
  return { used: next, action: { name: u.name.replace(/ \(.*\)$/, ''), detail: u.pool ? `${amount}` : undefined, kind: 'feature' } };
}

/**
 * What a rest changes. Short Rest: Pact Magic slots and short-rest features
 * come back (one use of `shortOne` features); Hit Dice are spent separately
 * (spendHitDie). Long Rest: everything comes back, all Hit Dice too, HP goes to
 * max, temporary HP goes away, one Exhaustion level is removed and
 * concentration ends (2024 rules).
 */
export function applyRest(c: CharacterData, kind: 'short' | 'long'): Partial<CharacterData> {
  if (c.deathSaves.failures >= 3) return {}; // the dead don't rest
  if (kind === 'long') {
    return {
      used: {},
      hpCurrent: c.hpMax,
      hpTemp: 0,
      exhaustion: Math.max(0, c.exhaustion - 1),
      concentration: null,
      deathSaves: { successes: 0, failures: 0 },
      resting: false,
    };
  }
  const next = { ...c.used };
  for (const s of spellSlots(c)) if (s.pact) delete next[s.id];
  for (const u of limitedUses(c)) {
    if (u.resetOn === 'short') delete next[u.id];
    else if (u.resetOn === 'shortOne' && next[u.id]) next[u.id] = next[u.id]! - 1;
  }
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  return { used: next };
}

// ---------- Hit Dice (2024: Hit Point Dice) ----------

/** Key in CharacterData.used for spent Hit Dice. */
export const HIT_DICE_ID = 'hitDice';

/** The classes in the content, as far as Hit Dice need them (a Content fits). */
interface ClassDice {
  classes: { name: string; hitDie: number }[];
}

/**
 * Size of the character's Hit Die: the one set on the sheet (homebrew classes),
 * else the class's from the content, else a d8.
 */
export function hitDieSize(c: Pick<CharacterData, 'className' | 'hitDie'>, content?: ClassDice | null): number {
  if (c.hitDie) return c.hitDie;
  return content?.classes.find((x) => norm(x.name) === norm(c.className))?.hitDie ?? 8;
}

/** One Hit Die per level; a Long Rest brings all of them back. */
export const hitDiceLeft = (c: Pick<CharacterData, 'level' | 'used'>) => Math.max(0, clampLevel(c.level) - used(c, HIT_DICE_ID));

/**
 * Spends one Hit Die on a Short Rest: heals the roll plus the Constitution
 * modifier, at least 1 HP. Throws an Error with a friendly message when it
 * isn't possible. A rest that has nothing more to give ends by itself.
 */
export function spendHitDie(c: CharacterData, die: number, roll: number): { patch: Partial<CharacterData>; healed: number; modifier: number } {
  if (isDead(c)) throw new Error('This character is dead.');
  if (hitDiceLeft(c) <= 0) throw new Error('No Hit Dice left. They come back after a Long Rest.');
  if (c.hpCurrent >= c.hpMax) throw new Error('Already at full HP.');
  if (!Number.isInteger(roll) || roll < 1 || roll > die) throw new Error(`A d${die} roll is between 1 and ${die}.`);
  const modifier = abilityModifier(c.abilities.con);
  const heal = applyDamageOrHealing(c, Math.max(1, roll + modifier));
  const usedNow = { ...c.used, [HIT_DICE_ID]: used(c, HIT_DICE_ID) + 1 };
  const after = { ...c, ...heal, used: usedNow };
  return {
    patch: { ...heal, used: usedNow, ...(c.resting && !canSpendHitDice(after) ? { resting: false } : {}) },
    healed: after.hpCurrent - c.hpCurrent,
    modifier,
  };
}

/** Whether spending a Hit Die would do anything right now. */
export const canSpendHitDice = (c: Pick<CharacterData, 'level' | 'used' | 'hpCurrent' | 'hpMax' | 'deathSaves' | 'exhaustion'>) =>
  !isDead(c) && hitDiceLeft(c) > 0 && c.hpCurrent < c.hpMax;

export const RESET_LABEL: Record<ResetOn, string> = {
  short: 'Back after a Short or Long Rest',
  shortOne: 'One back per Short Rest, all after a Long Rest',
  long: 'Back after a Long Rest',
};

