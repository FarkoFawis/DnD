/**
 * A fight: who is in it, their initiative and whose turn it is.
 * Pure functions; the server stores the result with the live session.
 *
 * 2024 rules: initiative is a Dexterity check (d20 + DEX modifier + bonuses),
 * highest goes first. On a tie the DM decides; we put the higher modifier
 * first and keep the DM's manual values as the way to settle the rest.
 */

export interface Combatant {
  id: string;
  kind: 'player' | 'npc';
  /** Character id (players) or NPC id from the campaign prep. */
  ref: string;
  name: string;
  /** Initiative modifier used when rolling. */
  bonus: number;
  /** Total initiative, or null while not rolled / entered yet. */
  initiative: number | null;
  /** The d20 behind an automatic roll; null when the DM typed the total in. */
  d20: number | null;
  /** NPCs only, and only sent to the DM. Players' HP lives on their sheets. */
  hp?: { current: number; max: number };
  armorClass?: number;
  /**
   * NPCs only: the players don't know yet who this is. They get it without its
   * name (see publicCombat) until the DM reveals it.
   */
  hidden?: boolean;
}

export interface Combat {
  round: number;
  /** Combatant whose turn it is; null until the DM starts the first turn. */
  activeId: string | null;
  /** Always in turn order. */
  combatants: Combatant[];
}

export type CombatAction =
  /** Roll d20 + modifier for the given combatants (default: everyone). */
  | { type: 'roll'; ids?: string[] }
  /** Enter an initiative total by hand (null clears it). */
  | { type: 'set'; id: string; value: number | null }
  | { type: 'next' }
  | { type: 'prev' }
  /** Damage (negative) or heal (positive) an NPC. */
  | { type: 'hp'; id: string; delta: number }
  /** Hide an opponent's name from the players, or reveal it. Without `id`: every opponent. */
  | { type: 'reveal'; id?: string; hidden: boolean }
  | { type: 'remove'; id: string };

/** Returns 1..20. */
export type D20 = () => number;
export const rollD20: D20 = () => 1 + Math.floor(Math.random() * 20);

export function sortCombatants(list: Combatant[]): Combatant[] {
  // Array.prototype.sort is stable, so remaining ties keep their order.
  return [...list].sort((a, b) => {
    if (a.initiative === null || b.initiative === null) {
      return a.initiative === b.initiative ? 0 : a.initiative === null ? 1 : -1;
    }
    return b.initiative - a.initiative || b.bonus - a.bonus;
  });
}

export function newCombat(combatants: Combatant[]): Combat {
  return { round: 1, activeId: null, combatants: sortCombatants(combatants) };
}

export function addCombatants(combat: Combat, more: Combatant[]): Combat {
  return { ...combat, combatants: sortCombatants([...combat.combatants, ...more]) };
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Applies a DM action. Throws an Error with a message for the user on bad input. */
export function applyCombatAction(combat: Combat, action: CombatAction, d20: D20 = rollD20): Combat {
  const find = (id: unknown) => {
    const c = combat.combatants.find((x) => x.id === id);
    if (!c) throw new Error('They are no longer in the fight.');
    return c;
  };
  const replace = (next: Combatant) =>
    ({ ...combat, combatants: sortCombatants(combat.combatants.map((c) => (c.id === next.id ? next : c))) });

  switch (action?.type) {
    case 'roll': {
      const ids = Array.isArray(action.ids) ? new Set(action.ids) : null;
      return {
        ...combat,
        combatants: sortCombatants(
          combat.combatants.map((c) => {
            if (ids && !ids.has(c.id)) return c;
            const roll = d20();
            return { ...c, d20: roll, initiative: roll + c.bonus };
          }),
        ),
      };
    }
    case 'set': {
      const c = find(action.id);
      if (action.value !== null && !isInt(action.value, -50, 99)) throw new Error('Enter a whole number.');
      return replace({ ...c, initiative: action.value, d20: null });
    }
    case 'next':
    case 'prev': {
      const order = combat.combatants;
      if (order.length === 0) return combat;
      const i = order.findIndex((c) => c.id === combat.activeId);
      if (action.type === 'next') {
        if (i < 0) return { ...combat, activeId: order[0]!.id };
        const wrap = i === order.length - 1;
        return { ...combat, activeId: order[wrap ? 0 : i + 1]!.id, round: combat.round + (wrap ? 1 : 0) };
      }
      if (i < 0) return combat;
      if (i === 0) {
        return combat.round > 1
          ? { ...combat, activeId: order[order.length - 1]!.id, round: combat.round - 1 }
          : { ...combat, activeId: null };
      }
      return { ...combat, activeId: order[i - 1]!.id };
    }
    case 'hp': {
      const c = find(action.id);
      if (!c.hp) throw new Error("Change a player's HP on their sheet.");
      if (!isInt(action.delta, -9999, 9999)) throw new Error('Invalid amount.');
      const current = Math.max(0, Math.min(c.hp.max, c.hp.current + action.delta));
      return replace({ ...c, hp: { ...c.hp, current } });
    }
    case 'reveal': {
      if (typeof action.hidden !== 'boolean') throw new Error('Unknown action.');
      if (action.id !== undefined && find(action.id).kind !== 'npc') throw new Error('Only opponents can be hidden.');
      return {
        ...combat,
        combatants: combat.combatants.map((c) => {
          if (c.kind !== 'npc' || (action.id !== undefined && c.id !== action.id)) return c;
          const { hidden: _hidden, ...shown } = c;
          return action.hidden ? { ...shown, hidden: true } : shown;
        }),
      };
    }
    case 'remove': {
      const c = find(action.id);
      const order = combat.combatants;
      let activeId = combat.activeId;
      let round = combat.round;
      const rest = order.filter((x) => x.id !== c.id);
      if (activeId === c.id) {
        // Their turn passes to whoever was next.
        const i = order.indexOf(c);
        if (rest.length === 0) activeId = null;
        else if (i >= rest.length) {
          activeId = rest[0]!.id;
          round += 1;
        } else activeId = rest[i]!.id;
      }
      return { round, activeId, combatants: rest };
    }
    default:
      throw new Error('Unknown action.');
  }
}

/** What the players read in place of a hidden opponent's name. */
export const UNKNOWN_NAME = 'Unknown';

/**
 * What players get to see: no opponent HP or AC, and nothing that tells who a
 * hidden opponent is (it keeps its place in the turn order).
 */
export function publicCombat(combat: Combat): Combat {
  return {
    ...combat,
    combatants: combat.combatants.map(({ hp: _hp, armorClass: _ac, ...c }) =>
      c.hidden ? { ...c, name: UNKNOWN_NAME, ref: '', bonus: 0, d20: null } : c,
    ),
  };
}

/** Several combatants in a few words: "Bandit captain", "3× Goblin, Bandit captain". Copies are numbered ("Goblin 2"). */
export function groupNames(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const base = names.length > 1 ? n.replace(/ \d+$/, '') : n;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(', ');
}

/**
 * A moment of the fight worth a banner on a phone, read off two states of it:
 * - `turn`: it just became this player's turn;
 * - `round`: a new round began (and it is not this player's turn);
 * - `reveal`: the DM revealed opponents that were hidden;
 * - `end`: the fight is over.
 */
export type FightMoment =
  | { kind: 'turn'; round: number }
  | { kind: 'round'; round: number; active: string | null }
  | { kind: 'reveal'; names: string[] }
  | { kind: 'end'; rounds: number };

/**
 * What just happened between two states of the fight, for one phone
 * (`myCharacterId`: the player's character; none for the DM). Null when it is
 * nothing to announce: a fight that starts has its own alert.
 */
export function fightMoment(before: Combat | null, after: Combat | null, myCharacterId?: string): FightMoment | null {
  if (!before) return null;
  if (!after) return { kind: 'end', rounds: before.round };
  const was = new Map(before.combatants.map((c) => [c.id, c]));
  const revealed = after.combatants.filter((c) => !c.hidden && was.get(c.id)?.hidden).map((c) => c.name);
  if (revealed.length > 0) return { kind: 'reveal', names: revealed };
  const active = after.combatants.find((c) => c.id === after.activeId);
  const mine = !!active && !!myCharacterId && active.kind === 'player' && active.ref === myCharacterId;
  if (mine && after.activeId !== before.activeId) return { kind: 'turn', round: after.round };
  // A fight that was started over begins at round 1 again: nobody in it is the same.
  const sameFight = after.combatants.some((c) => was.has(c.id)) || after.combatants.length === 0;
  if (sameFight && after.round > before.round) return { kind: 'round', round: after.round, active: active?.name ?? null };
  return null;
}
