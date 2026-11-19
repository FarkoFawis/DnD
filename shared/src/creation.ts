/**
 * Guided character creation (2024 rules): the choices a player makes, checks
 * for missing/invalid picks, and turning the choices into a character sheet.
 * Pure and deterministic so it can be unit tested.
 */
import type { Content } from './content/index.ts';
import type { ClassDef, EquipmentOption, SpeciesDef } from './content/types.ts';
import type { CharacterData, CharacterFeature, Item, Spell } from './protocol.ts';
import { ABILITIES, ABILITY_NAMES, SKILLS, abilityModifier, proficiencyBonus, type Ability, type Skill } from './rules.ts';

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const SIZES = ['Small', 'Medium'] as const;
/** Every character knows Common plus two languages (2024 rules). */
export const EXTRA_LANGUAGES = 2;
export const CUSTOM = 'custom';

export type AbilityMethod = 'standard' | 'pointbuy' | 'manual';

export interface CustomClass {
  name: string;
  hitDie: number;
  saves: Ability[];
  spellAbility: Ability | null;
}
export interface CustomSpecies {
  name: string;
  size: string;
  speed: number;
  traits: string;
}
export interface CustomBackground {
  name: string;
  abilities: Ability[];
  skills: Skill[];
  tool: string;
}

export interface CreationChoices {
  name: string;
  level: number;

  classId: string;
  customClass: CustomClass;
  subclassId: string;
  customSubclass: string;
  classSkills: Skill[];

  backgroundId: string;
  customBackground: CustomBackground;
  /** Origin feat of a custom background. SRD backgrounds bring their own. */
  backgroundFeat: string;

  speciesId: string;
  customSpecies: CustomSpecies;
  subspeciesId: string;
  size: string;
  /** Human "Skillful". */
  speciesSkill: Skill | '';
  /** Human "Versatile". */
  speciesFeat: string;

  /** Picks for the "Skilled" feat (3 skills), from any source that grants it. */
  skilledPicks: Skill[];
  /** Picks for "Magic Initiate". */
  magicInitiate: { list: string; ability: Ability | ''; cantrips: string[]; spell: string };

  abilityMethod: AbilityMethod;
  /** Scores before background bonuses. 0 = not assigned yet (standard array). */
  baseScores: Record<Ability, number>;
  bonusMode: '2-1' | '1-1-1';
  plus2: Ability | '';
  plus1: Ability | '';

  languages: string[];

  /** Label of the chosen option ("A", "B", ...). */
  classEquipment: string;
  backgroundEquipment: string;
  /** "<class|background>:<label>:<index>" -> chosen item id for "choose one" slots. */
  equipmentPicks: Record<string, string>;

  cantrips: string[];
  preparedSpells: string[];
}

export function emptyChoices(): CreationChoices {
  return {
    name: '',
    level: 1,
    classId: '',
    customClass: { name: '', hitDie: 8, saves: [], spellAbility: null },
    subclassId: '',
    customSubclass: '',
    classSkills: [],
    backgroundId: '',
    customBackground: { name: '', abilities: [], skills: [], tool: '' },
    backgroundFeat: '',
    speciesId: '',
    customSpecies: { name: '', size: 'Medium', speed: 30, traits: '' },
    subspeciesId: '',
    size: '',
    speciesSkill: '',
    speciesFeat: '',
    skilledPicks: [],
    magicInitiate: { list: '', ability: '', cantrips: [], spell: '' },
    abilityMethod: 'standard',
    baseScores: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    bonusMode: '2-1',
    plus2: '',
    plus1: '',
    languages: [],
    classEquipment: '',
    backgroundEquipment: '',
    equipmentPicks: {},
    cantrips: [],
    preparedSpells: [],
  };
}

// ---------- what the choices resolve to ----------

/** The class as the rest of creation sees it, also for a homebrew class. */
export function chosenClass(c: CreationChoices, content: Content): ClassDef | null {
  if (c.classId === CUSTOM) {
    const cc = c.customClass;
    return {
      id: CUSTOM,
      name: cc.name || 'Custom class',
      hitDie: cc.hitDie,
      primaryAbility: '',
      saves: cc.saves,
      skillChoices: { choose: 2, from: Object.keys(SKILLS) as Skill[] },
      proficiencies: [],
      equipment: [],
      features: [],
      subclassLevel: 3,
    };
  }
  return content.class(c.classId) ?? null;
}

export function chosenSpecies(c: CreationChoices, content: Content): SpeciesDef | null {
  if (c.speciesId === CUSTOM) {
    const cs = c.customSpecies;
    return { id: CUSTOM, name: cs.name || 'Custom species', size: cs.size, speed: cs.speed, traits: [] };
  }
  return content.speciesById(c.speciesId) ?? null;
}

export function chosenBackground(c: CreationChoices, content: Content) {
  if (c.backgroundId === CUSTOM) {
    const cb = c.customBackground;
    return {
      id: CUSTOM,
      name: cb.name || 'Custom background',
      abilities: cb.abilities,
      feat: c.backgroundFeat,
      skills: cb.skills,
      tool: cb.tool,
      equipment: [] as EquipmentOption[],
    };
  }
  return content.background(c.backgroundId) ?? null;
}

/** Spellcasting ability, or null for non-casters. */
export function spellAbility(c: CreationChoices, content: Content): Ability | null {
  if (c.classId === CUSTOM) return c.customClass.spellAbility;
  return chosenClass(c, content)?.spellcasting?.ability ?? null;
}

/** Cantrips, prepared spells and the highest spell level at this class level. */
export function spellAllowance(c: CreationChoices, content: Content): { cantrips: number; prepared: number; maxLevel: number } {
  const cls = chosenClass(c, content);
  const row = cls?.spellcasting?.levels[c.level - 1];
  if (!row) {
    // Homebrew casters: no table, so allow a generous pick and let the DM judge.
    return c.classId === CUSTOM && c.customClass.spellAbility ? { cantrips: 4, prepared: 6, maxLevel: Math.min(9, Math.ceil(c.level / 2)) } : { cantrips: 0, prepared: 0, maxLevel: 0 };
  }
  let maxLevel = 0;
  row.slots.forEach((n, i) => {
    if (n > 0) maxLevel = i + 1;
  });
  return { cantrips: row.cantrips, prepared: row.prepared, maxLevel };
}

/** Spells this class may pick from (its own list, or every spell for a homebrew class). */
export function spellOptions(c: CreationChoices, content: Content, maxLevel: number) {
  if (c.classId === CUSTOM) return content.spells.filter((s) => s.level <= maxLevel);
  return content.spellsFor(c.classId, maxLevel);
}

/** Feat ids the character gets during creation (background + species). */
export function originFeats(c: CreationChoices, content: Content): string[] {
  const bg = chosenBackground(c, content);
  const sp = chosenSpecies(c, content);
  return [bg?.feat, sp?.originFeatChoice ? c.speciesFeat : ''].filter((f): f is string => !!f);
}

/** The Magic Initiate list is fixed by some backgrounds (Acolyte: Cleric, Sage: Wizard). */
export function magicInitiateList(c: CreationChoices, content: Content): string | null {
  const bg = chosenBackground(c, content);
  const note = bg && 'featNote' in bg ? bg.featNote : undefined;
  if (bg?.feat === 'magic-initiate' && note) return note.toLowerCase();
  return null;
}

export const MAGIC_INITIATE_LISTS = ['cleric', 'druid', 'wizard'] as const;

export function scoresWithBonuses(c: CreationChoices, content: Content): Record<Ability, number> {
  const out = { ...c.baseScores };
  const bg = chosenBackground(c, content);
  if (c.bonusMode === '2-1') {
    if (c.plus2) out[c.plus2] += 2;
    if (c.plus1) out[c.plus1] += 1;
  } else if (bg) {
    for (const a of bg.abilities) out[a] += 1;
  }
  for (const a of ABILITIES) out[a] = Math.min(20, out[a]);
  return out;
}

export function pointBuySpent(scores: Record<Ability, number>): number {
  return ABILITIES.reduce((sum, a) => sum + (POINT_BUY_COST[scores[a]] ?? 99), 0);
}

// ---------- checks ----------

export type Step = 'class' | 'background' | 'species' | 'abilities' | 'equipment' | 'spells' | 'details';
export const STEPS: Step[] = ['class', 'background', 'species', 'abilities', 'equipment', 'spells', 'details'];

/** What's still missing or wrong on one step. Empty = the step is done. */
export function stepProblems(step: Step, c: CreationChoices, content: Content): string[] {
  const p: string[] = [];
  const cls = chosenClass(c, content);
  switch (step) {
    case 'class': {
      if (!cls) return ['Pick a class.'];
      if (c.classId === CUSTOM) {
        if (!c.customClass.name.trim()) p.push('Name your homebrew class.');
        if (c.customClass.saves.length !== 2) p.push('Pick two saving throws.');
      }
      if (c.level >= cls.subclassLevel && !c.subclassId) p.push(`Pick a subclass (you are level ${c.level}).`);
      if (c.subclassId === CUSTOM && !c.customSubclass.trim()) p.push('Name your homebrew subclass.');
      const n = cls.skillChoices.choose;
      if (new Set(c.classSkills).size !== n || c.classSkills.some((s) => !cls.skillChoices.from.includes(s)))
        p.push(`Pick ${n} class skills.`);
      break;
    }
    case 'background': {
      const bg = chosenBackground(c, content);
      if (!bg) return ['Pick a background.'];
      if (c.backgroundId === CUSTOM) {
        const cb = c.customBackground;
        if (!cb.name.trim()) p.push('Name your homebrew background.');
        if (new Set(cb.abilities).size !== 3) p.push('Pick three abilities for the background.');
        if (new Set(cb.skills).size !== 2) p.push('Pick two background skills.');
        if (!c.backgroundFeat) p.push('Pick an origin feat.');
      }
      p.push(...featProblems(c, content, [bg.feat]));
      break;
    }
    case 'species': {
      const sp = chosenSpecies(c, content);
      if (!sp) return ['Pick a species.'];
      if (c.speciesId === CUSTOM && !c.customSpecies.name.trim()) p.push('Name your homebrew species.');
      if (sp.subspecies && !c.subspeciesId) p.push(`Pick a ${sp.subspecies.label.toLowerCase()}.`);
      if (sp.size.includes(' or ') && !c.size) p.push('Pick a size.');
      if (sp.skillChoice && !c.speciesSkill) p.push('Pick a skill (Skillful).');
      if (sp.originFeatChoice && !c.speciesFeat) p.push('Pick an origin feat (Versatile).');
      // Same feat from background and species: its picks were already asked for there.
      const bgFeat = chosenBackground(c, content)?.feat;
      if (sp.originFeatChoice && c.speciesFeat !== bgFeat) p.push(...featProblems(c, content, [c.speciesFeat]));
      if (new Set(c.languages).size !== EXTRA_LANGUAGES) p.push(`Pick ${EXTRA_LANGUAGES} languages.`);
      break;
    }
    case 'abilities': {
      const s = c.baseScores;
      if (c.abilityMethod === 'standard') {
        const used = ABILITIES.map((a) => s[a]).sort((x, y) => y - x);
        if (used.join() !== [...STANDARD_ARRAY].join()) p.push('Give each ability one number from the standard array.');
      } else if (c.abilityMethod === 'pointbuy') {
        if (ABILITIES.some((a) => s[a] < 8 || s[a] > 15)) p.push('Point buy scores go from 8 to 15.');
        else if (pointBuySpent(s) > POINT_BUY_BUDGET) p.push(`You spent more than ${POINT_BUY_BUDGET} points.`);
      } else if (ABILITIES.some((a) => s[a] < 3 || s[a] > 18)) p.push('Rolled scores go from 3 to 18.');
      const bg = chosenBackground(c, content);
      if (bg && c.bonusMode === '2-1') {
        if (!c.plus2 || !c.plus1) p.push('Pick where your background bonuses (+2 and +1) go.');
        else if (c.plus2 === c.plus1) p.push('The +2 and +1 must go to different abilities.');
        else if (!bg.abilities.includes(c.plus2) || !bg.abilities.includes(c.plus1))
          p.push(`Background bonuses can only go to ${bg.abilities.map((a) => ABILITY_NAMES[a]).join(', ')}.`);
      }
      break;
    }
    case 'equipment': {
      for (const [src, opts, label] of equipmentSources(c, content)) {
        if (opts.length === 0) continue;
        const opt = opts.find((o) => o.label === label);
        if (!opt) {
          p.push(`Pick your ${src} equipment.`);
          continue;
        }
        opt.items.forEach((it, i) => {
          if ('choose' in it && !c.equipmentPicks[`${src}:${opt.label}:${i}`]) p.push(`Pick a ${it.choose.toLowerCase()}.`);
        });
      }
      break;
    }
    case 'spells': {
      const allow = spellAllowance(c, content);
      if (c.cantrips.length > allow.cantrips) p.push(`Pick at most ${allow.cantrips} cantrips.`);
      else if (c.cantrips.length < allow.cantrips) p.push(`Pick ${allow.cantrips - c.cantrips.length} more cantrip(s).`);
      if (c.preparedSpells.length > allow.prepared) p.push(`Pick at most ${allow.prepared} spells.`);
      else if (c.preparedSpells.length < allow.prepared) p.push(`Pick ${allow.prepared - c.preparedSpells.length} more spell(s).`);
      break;
    }
    case 'details':
      if (!c.name.trim()) p.push('Give your character a name.');
      break;
  }
  return p;
}

function featProblems(c: CreationChoices, content: Content, feats: string[]): string[] {
  const p: string[] = [];
  if (feats.includes('skilled') && new Set(c.skilledPicks).size !== 3) p.push('Pick 3 skills for the Skilled feat.');
  if (feats.includes('magic-initiate')) {
    const mi = c.magicInitiate;
    if (!(magicInitiateList(c, content) ?? mi.list)) p.push('Pick a spell list for Magic Initiate.');
    if (!mi.ability) p.push('Pick a spellcasting ability for Magic Initiate.');
    if (new Set(mi.cantrips).size !== 2) p.push('Pick 2 Magic Initiate cantrips.');
    if (!mi.spell) p.push('Pick a level 1 Magic Initiate spell.');
  }
  return p;
}

export function equipmentSources(c: CreationChoices, content: Content): [src: 'class' | 'background', options: EquipmentOption[], chosen: string][] {
  return [
    ['class', chosenClass(c, content)?.equipment ?? [], c.classEquipment],
    ['background', chosenBackground(c, content)?.equipment ?? [], c.backgroundEquipment],
  ];
}

export function allProblems(c: CreationChoices, content: Content): string[] {
  return STEPS.flatMap((s) => stepProblems(s, c, content));
}

// ---------- building the sheet ----------

/** Id generator, swappable in tests. */
export type IdFn = () => string;

/**
 * Turns finished choices into a character. Call allProblems() first: this
 * fills sensible defaults for anything missing rather than throwing.
 */
export function buildCharacter(c: CreationChoices, content: Content, newId: IdFn): Partial<CharacterData> & { name: string } {
  const cls = chosenClass(c, content);
  const sp = chosenSpecies(c, content);
  const bg = chosenBackground(c, content);
  const level = Math.min(20, Math.max(1, c.level));
  const abilities = scoresWithBonuses(c, content);
  const mod = (a: Ability) => abilityModifier(abilities[a]);
  const pb = proficiencyBonus(level);
  const feats = originFeats(c, content);

  // Skills
  const skills = new Set<Skill>([...c.classSkills, ...(bg?.skills ?? [])]);
  if (sp?.skillChoice && c.speciesSkill) skills.add(c.speciesSkill);
  if (feats.includes('skilled')) c.skilledPicks.forEach((s) => skills.add(s));

  // Hit points: max die at level 1, then the fixed average per level.
  const die = cls?.hitDie ?? 8;
  const con = mod('con');
  // Dwarven Toughness: +1 HP per level.
  const hpMax = Math.max(1, die + con) + (level - 1) * Math.max(1, die / 2 + 1 + con) + (sp?.id === 'dwarf' ? level : 0);

  // Equipment
  const inventory: Item[] = [];
  let gp = 0;
  for (const [src, opts, label] of equipmentSources(c, content)) {
    const opt = opts.find((o) => o.label === label);
    if (!opt) continue;
    gp += opt.gp;
    opt.items.forEach((it, i) => {
      const ref = 'ref' in it ? it.ref : c.equipmentPicks[`${src}:${opt.label}:${i}`];
      const def = ref ? content.item(ref) : undefined;
      if (!def) return;
      const note = 'note' in it && it.note ? it.note : '';
      const existing = inventory.find((x) => x.ref === def.id && x.notes === note);
      if (existing) existing.qty += it.qty;
      else inventory.push({ id: newId(), name: def.name, qty: it.qty, notes: note, ref: def.id });
    });
  }

  // Armor Class from what's carried (the best armor you're proficient with + shield).
  const armorClass = computeArmorClass(cls, inventory, content, abilities);

  // Speed
  let speed = sp?.speed ?? 30;
  if (c.subspeciesId === 'elven-lineage-wood-elf') speed = 35;

  // Features
  const features: CharacterFeature[] = [];
  const add = (name: string, source: string, ref?: string, description?: string) =>
    features.push({ id: newId(), name, source, ...(ref ? { ref } : {}), ...(description ? { description } : {}) });
  for (const f of cls?.features ?? []) {
    if (f.level > level || /Subclass$/.test(f.name)) continue;
    add(f.name, `${cls!.name} ${f.level}`, `class:${cls!.id}:${f.name}`);
  }
  const sub = c.subclassId && c.subclassId !== CUSTOM ? content.subclass(c.subclassId) : undefined;
  for (const f of sub?.features ?? []) if (f.level <= level) add(f.name, `${sub!.name} ${f.level}`, `subclass:${sub!.id}:${f.name}`);
  if (sp && sp.id !== CUSTOM) for (const t of sp.traits) add(t.name, sp.name, `species:${sp.id}:${t.name}`);
  if (sp?.id === CUSTOM && c.customSpecies.traits.trim()) add('Species traits', sp.name, undefined, c.customSpecies.traits.trim());
  const subOpt = sp?.subspecies?.options.find((o) => o.id === c.subspeciesId);
  if (subOpt && sp) add(subOpt.name, sp.subspecies!.label, `subspecies:${sp.id}:${subOpt.id}`);
  for (const f of feats) {
    const def = content.feat(f);
    if (def) add(def.name, 'Origin feat', `feat:${def.id}`);
  }

  // Spells
  const spells: Spell[] = [];
  const addSpell = (id: string) => {
    const s = content.spell(id);
    if (s && !spells.some((x) => x.ref === s.id)) spells.push({ id: newId(), name: s.name, level: s.level, prepared: true, ref: s.id });
  };
  c.cantrips.forEach(addSpell);
  c.preparedSpells.forEach(addSpell);
  if (feats.includes('magic-initiate')) {
    c.magicInitiate.cantrips.forEach(addSpell);
    addSpell(c.magicInitiate.spell);
  }
  let spellcastingAbility = spellAbility(c, content);
  if (!spellcastingAbility && feats.includes('magic-initiate') && c.magicInitiate.ability) spellcastingAbility = c.magicInitiate.ability;

  // Proficiencies & languages go to notes so they're visible on the sheet.
  const tools = [bg?.tool].filter(Boolean);
  const langs = ['Common', ...c.languages.map((id) => content.languages.find((l) => l.id === id)?.name ?? id)];
  const size = sp?.size.includes(' or ') ? c.size || 'Medium' : sp?.size ?? 'Medium';
  const notes = [
    `Size: ${size}`,
    `Languages: ${langs.join(', ')}`,
    cls?.proficiencies.length ? `Armor & weapons: ${cls.proficiencies.join(', ')}` : '',
    tools.length ? `Tools: ${tools.join(', ')}` : '',
    cls?.toolChoice ? `Class tools: ${cls.toolChoice}` : '',
    level >= 4 ? 'Reminder: pick your Ability Score Improvement / feats for levels 4, 8, 12, 16 (and an Epic Boon at 19) with your DM.' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const subName = c.subclassId === CUSTOM ? c.customSubclass.trim() : sub?.name ?? '';

  return {
    name: c.name.trim(),
    className: cls?.name ?? '',
    subclass: subName,
    species: sp?.name ?? '',
    subspecies: subOpt?.name ?? '',
    background: bg?.name ?? '',
    level,
    // A homebrew class isn't in the content, so the sheet remembers its Hit Die.
    hitDie: c.classId === CUSTOM && cls ? cls.hitDie : 0,
    hpMax,
    hpCurrent: hpMax,
    hpTemp: 0,
    armorClass,
    speed,
    initiativeBonus: feats.includes('alert') ? pb : 0,
    abilities,
    saveProficiencies: [...(cls?.saves ?? [])],
    skillProficiencies: [...skills],
    skillExpertise: [],
    spellcastingAbility,
    spells,
    features,
    inventory,
    coins: { cp: 0, sp: 0, ep: 0, gp, pp: 0 },
    notes,
  };
}

export function computeArmorClass(
  cls: ClassDef | null,
  inventory: Item[],
  content: Content,
  abilities: Record<Ability, number>,
): number {
  const dex = abilityModifier(abilities.dex);
  const profs = (cls?.proficiencies ?? []).join(' ').toLowerCase();
  const carried = inventory.map((i) => (i.ref ? content.item(i.ref) : undefined)).filter((d) => d?.armor);
  const proficient = (type: string) => cls?.id === CUSTOM || profs.includes('all armor') || profs.includes(`${type} armor`);
  const body = carried.filter((d) => d!.armor!.type !== 'shield' && proficient(d!.armor!.type));
  const hasShield = carried.some((d) => d!.armor!.type === 'shield') && (cls?.id === CUSTOM || profs.includes('shields'));
  const armorAc = (a: NonNullable<(typeof body)[number]>['armor']) =>
    a!.base + (a!.dex === 'full' ? dex : a!.dex === 'max2' ? Math.min(2, dex) : 0);
  let best = 10 + dex;
  if (cls?.id === 'barbarian') best = 10 + dex + abilityModifier(abilities.con);
  if (cls?.id === 'monk' && !hasShield) best = 10 + dex + abilityModifier(abilities.wis);
  for (const d of body) best = Math.max(best, armorAc(d!.armor));
  return best + (hasShield ? 2 : 0);
}
