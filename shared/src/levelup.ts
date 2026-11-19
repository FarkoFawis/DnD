/**
 * Gaining a level (2024 rules): what the new level brings, the choices the
 * player makes in the level-up wizard, checks, and applying them to the sheet.
 * Pure and tested (levelup.test.ts); the server runs applyLevelUp() itself, so
 * a level-up is one atomic, validated change.
 */
import type { Content } from './content/index.ts';
import type { ClassDef, Feature, FeatDef, SpellDef, SubclassDef } from './content/types.ts';
import type { CharacterData, CharacterFeature, Spell } from './protocol.ts';
import { ABILITIES, ABILITY_NAMES, abilityModifier, proficiencyBonus, type Ability } from './rules.ts';
import { spellSlots } from './resources.ts';

/** Same marker as in creation.ts: "my own / homebrew" in a dropdown. */
const CUSTOM = 'custom';
export const ASI_FEAT = 'ability-score-improvement';
export const MAX_LEVEL = 20;

export interface LevelUpChoices {
  /** What the player rolled on the Hit Die, or null to take the fixed value. */
  hpRoll: number | null;
  /** Content id, or "custom" with customSubclass. Only when the level grants a subclass. */
  subclassId: string;
  customSubclass: string;
  /** Feat id, or "custom" with customFeat. Only at feat levels. */
  featId: string;
  customFeat: string;
  /** Ability score increases: +2 in total for Ability Score Improvement, up to +1 with other feats. */
  asi: Partial<Record<Ability, number>>;
  /** Content spell ids to add (new cantrips and newly prepared spells). */
  spells: string[];
}

export function emptyLevelUp(): LevelUpChoices {
  return { hpRoll: null, subclassId: '', customSubclass: '', featId: '', customFeat: '', asi: {}, spells: [] };
}

export type LevelUpStep = 'overview' | 'hp' | 'subclass' | 'feat' | 'spells' | 'review';

export interface LevelUpPlan {
  newLevel: number;
  /** The class from the content, null for a homebrew class. */
  cls: ClassDef | null;
  hitDie: number;
  /** HP for the level when not rolling: half the die + 1. */
  fixedHp: number;
  /** New class features at this level (without the subclass / feat placeholders). */
  features: Feature[];
  /** The subclass the character already has, if it is in the content. */
  subclass: SubclassDef | null;
  subclassFeatures: Feature[];
  needsSubclass: boolean;
  subclassOptions: SubclassDef[];
  /** Which kind of feat this level grants, if any. */
  feat: 'general' | 'epic-boon' | null;
  /** New spell picks, null for non-casters and homebrew classes. */
  spells: { newCantrips: number; newPrepared: number; maxLevel: number; cantrips: number; prepared: number } | null;
  pbFrom: number;
  pbTo: number;
  /** Spell slots after the level-up, e.g. [4, 3] (for display). */
  slots: { level: number; max: number; pact?: boolean }[];
  steps: LevelUpStep[];
}

const norm = (s: string) => s.trim().toLowerCase();

/** Levels at which a class picks a feat (Ability Score Improvement or another General feat). */
export function featLevels(classId: string): number[] {
  const base = [4, 8, 12, 16];
  if (classId === 'fighter') base.push(6, 14);
  if (classId === 'rogue') base.push(10);
  return base;
}

const PLACEHOLDER = /( Subclass$|^Ability Score Improvement$|^Epic Boon$|^Subclass feature$)/i;

/** What the next level brings. Null at level 20. */
export function levelUpPlan(c: CharacterData, content: Content): LevelUpPlan | null {
  if (c.level >= MAX_LEVEL) return null;
  const newLevel = c.level + 1;
  const cls = content.classes.find((x) => norm(x.name) === norm(c.className)) ?? null;
  const hitDie = c.hitDie || (cls?.hitDie ?? 8);
  const subclass = cls ? (content.subclassesOf(cls.id).find((s) => norm(s.name) === norm(c.subclass)) ?? null) : null;
  const needsSubclass = !!cls && newLevel >= cls.subclassLevel && !c.subclass.trim();
  const feat: LevelUpPlan['feat'] = newLevel === 19 ? 'epic-boon' : featLevels(cls?.id ?? '').includes(newLevel) ? 'general' : null;

  let spells: LevelUpPlan['spells'] = null;
  const table = cls?.spellcasting?.levels;
  const now = table?.[newLevel - 1];
  if (table && now) {
    const before = table[c.level - 1] ?? { cantrips: 0, prepared: 0, slots: [] };
    let maxLevel = 0;
    now.slots.forEach((n, i) => {
      if (n > 0) maxLevel = i + 1;
    });
    spells = {
      newCantrips: Math.max(0, now.cantrips - before.cantrips),
      newPrepared: Math.max(0, now.prepared - before.prepared),
      maxLevel,
      cantrips: now.cantrips,
      prepared: now.prepared,
    };
  }

  const steps: LevelUpStep[] = ['overview', 'hp'];
  if (needsSubclass) steps.push('subclass');
  if (feat) steps.push('feat');
  if (spells && (spells.newCantrips > 0 || spells.newPrepared > 0)) steps.push('spells');
  steps.push('review');

  return {
    newLevel,
    cls,
    hitDie,
    fixedHp: hitDie / 2 + 1,
    features: (cls?.features ?? []).filter((f) => f.level === newLevel && !PLACEHOLDER.test(f.name)),
    subclass,
    subclassFeatures: (subclass?.features ?? []).filter((f) => f.level === newLevel),
    needsSubclass,
    subclassOptions: cls ? content.subclassesOf(cls.id) : [],
    feat,
    spells,
    pbFrom: proficiencyBonus(c.level),
    pbTo: proficiencyBonus(newLevel),
    slots: spellSlots({ ...c, level: newLevel }),
    steps,
  };
}

/** Feats offered at this level: General feats at feat levels, Epic Boons at 19 (plus General ones). */
export function featOptions(plan: LevelUpPlan, content: Content): FeatDef[] {
  if (!plan.feat) return [];
  const cats = plan.feat === 'epic-boon' ? ['epic-boon', 'general'] : ['general'];
  return content.feats.filter((f) => cats.includes(f.category));
}

/** Spells that can be added at this level: on the class list, castable, not on the sheet yet. */
export function levelUpSpellOptions(c: CharacterData, plan: LevelUpPlan, content: Content): SpellDef[] {
  if (!plan.cls || !plan.spells) return [];
  const have = new Set(c.spells.map((s) => s.ref ?? `name:${norm(s.name)}`));
  return content.spellsFor(plan.cls.id, plan.spells.maxLevel).filter((s) => !have.has(s.id) && !have.has(`name:${norm(s.name)}`));
}

/** Ability scores after the chosen increases. */
export function scoresAfter(c: CharacterData, choices: LevelUpChoices): Record<Ability, number> {
  const out = { ...c.abilities };
  for (const a of ABILITIES) out[a] += choices.asi[a] ?? 0;
  return out;
}

/** +1 HP per level from Dwarven Toughness and Draconic Resilience, +2 from the Tough feat. */
function hpBonusPerLevel(features: CharacterFeature[]): number {
  const has = (n: string) => features.some((f) => norm(f.name) === n);
  return (has('dwarven toughness') ? 1 : 0) + (has('draconic resilience') ? 1 : 0) + (has('tough') ? 2 : 0);
}

/**
 * HP gained: the Hit Die (rolled or fixed) + Constitution modifier, at least 1,
 * plus per-level bonuses. A higher Constitution modifier also adds 1 HP for
 * every earlier level.
 */
export function hpGain(c: CharacterData, plan: LevelUpPlan, choices: LevelUpChoices): number {
  const conBefore = abilityModifier(c.abilities.con);
  const conAfter = abilityModifier(scoresAfter(c, choices).con);
  const die = choices.hpRoll ?? plan.fixedHp;
  return Math.max(1, die + conAfter) + hpBonusPerLevel(c.features) + (conAfter - conBefore) * c.level;
}

/** What's still missing or wrong on one step. Empty = the step is done. */
export function levelUpProblems(step: LevelUpStep, c: CharacterData, plan: LevelUpPlan, choices: LevelUpChoices, content: Content): string[] {
  const p: string[] = [];
  switch (step) {
    case 'hp': {
      const r = choices.hpRoll;
      if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= plan.hitDie)) p.push(`A d${plan.hitDie} roll is between 1 and ${plan.hitDie}.`);
      break;
    }
    case 'subclass': {
      if (!plan.needsSubclass) break;
      if (!choices.subclassId) p.push('Pick a subclass.');
      else if (choices.subclassId === CUSTOM) {
        if (!choices.customSubclass.trim()) p.push('Name your homebrew subclass.');
      } else if (!plan.subclassOptions.some((s) => s.id === choices.subclassId)) p.push('That subclass is not available for your class.');
      break;
    }
    case 'feat': {
      if (!plan.feat) break;
      if (!choices.featId) return ['Pick a feat.'];
      if (choices.featId === CUSTOM) {
        if (!choices.customFeat.trim()) p.push('Name your feat.');
      } else if (!featOptions(plan, content).some((f) => f.id === choices.featId)) p.push('That feat is not available at this level.');
      const points = ABILITIES.reduce((n, a) => n + (choices.asi[a] ?? 0), 0);
      const isAsi = choices.featId === ASI_FEAT;
      const cap = content.feat(choices.featId)?.category === 'epic-boon' ? 30 : 20;
      if (ABILITIES.some((a) => !Number.isInteger(choices.asi[a] ?? 0) || (choices.asi[a] ?? 0) < 0 || (choices.asi[a] ?? 0) > 2)) p.push('Invalid ability increase.');
      else if (isAsi && points !== 2) p.push('Raise one ability by 2, or two abilities by 1.');
      else if (!isAsi && points > (choices.featId === CUSTOM ? 2 : 1)) p.push('This feat raises one ability by 1 at most.');
      const after = scoresAfter(c, choices);
      for (const a of ABILITIES) if ((choices.asi[a] ?? 0) > 0 && after[a] > cap) p.push(`${ABILITY_NAMES[a]} can't go above ${cap}.`);
      break;
    }
    case 'spells': {
      if (!plan.spells) break;
      const options = levelUpSpellOptions(c, plan, content);
      const picked = choices.spells.map((id) => options.find((s) => s.id === id));
      if (picked.some((s) => !s) || new Set(choices.spells).size !== choices.spells.length) p.push('Pick spells from the list.');
      const cantrips = picked.filter((s) => s?.level === 0).length;
      const leveled = picked.filter((s) => s && s.level > 0).length;
      if (cantrips > plan.spells.newCantrips) p.push(`Pick ${plan.spells.newCantrips} new cantrip${plan.spells.newCantrips === 1 ? '' : 's'} at most.`);
      if (leveled > plan.spells.newPrepared) p.push(`Pick ${plan.spells.newPrepared} new spell${plan.spells.newPrepared === 1 ? '' : 's'} at most.`);
      break;
    }
    case 'overview':
    case 'review':
      break;
  }
  return p;
}

export function allLevelUpProblems(c: CharacterData, plan: LevelUpPlan, choices: LevelUpChoices, content: Content): string[] {
  return plan.steps.flatMap((s) => levelUpProblems(s, c, plan, choices, content));
}

/** The sheet changes of a level-up. Throws an Error with the first problem when the choices aren't valid. */
export function applyLevelUp(c: CharacterData, choices: LevelUpChoices, content: Content, newId: () => string): Partial<CharacterData> {
  const plan = levelUpPlan(c, content);
  if (!plan) throw new Error(`Level ${MAX_LEVEL} is the highest level.`);
  const problems = allLevelUpProblems(c, plan, choices, content);
  if (problems.length > 0) throw new Error(problems[0]);

  const useFeat = plan.feat !== null;
  const picks: LevelUpChoices = useFeat ? choices : { ...choices, asi: {} };
  const gain = hpGain(c, plan, picks);
  const className = plan.cls?.name ?? c.className;
  const features: CharacterFeature[] = [...c.features];
  const add = (name: string, source: string, ref?: string) => features.push({ id: newId(), name, source, ...(ref ? { ref } : {}) });

  for (const f of plan.features) add(f.name, `${className} ${f.level}`, plan.cls ? `class:${plan.cls.id}:${f.name}` : undefined);

  let subclass = c.subclass;
  if (plan.needsSubclass) {
    if (choices.subclassId === CUSTOM) subclass = choices.customSubclass.trim();
    else {
      const sub = plan.subclassOptions.find((s) => s.id === choices.subclassId)!;
      subclass = sub.name;
      for (const f of sub.features) if (f.level <= plan.newLevel) add(f.name, `${sub.name} ${f.level}`, `subclass:${sub.id}:${f.name}`);
    }
  } else if (plan.subclass) {
    for (const f of plan.subclassFeatures) add(f.name, `${plan.subclass.name} ${f.level}`, `subclass:${plan.subclass.id}:${f.name}`);
  }

  if (useFeat) {
    const raised = ABILITIES.filter((a) => (picks.asi[a] ?? 0) > 0).map((a) => `+${picks.asi[a]} ${ABILITY_NAMES[a]}`).join(', ');
    const source = `Feat, level ${plan.newLevel}${raised ? ` (${raised})` : ''}`;
    if (choices.featId === CUSTOM) add(choices.customFeat.trim(), source);
    else add(content.feat(choices.featId)!.name, source, `feat:${choices.featId}`);
  }

  const spells: Spell[] = [...c.spells];
  if (plan.spells) {
    for (const id of choices.spells) {
      const s = content.spell(id)!;
      spells.push({ id: newId(), name: s.name, level: s.level, prepared: true, ref: s.id });
    }
  }

  return {
    level: plan.newLevel,
    hpMax: c.hpMax + gain,
    hpCurrent: c.hpCurrent > 0 ? c.hpCurrent + gain : 0,
    abilities: scoresAfter(c, picks),
    subclass,
    features,
    spells,
  };
}
