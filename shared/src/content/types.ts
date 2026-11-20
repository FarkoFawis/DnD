/**
 * Game content (classes, species, spells, items, ...) as "content packs".
 *
 * The app ships with the SRD 5.2 pack (srd.json, CC-BY-4.0). Extra packs,
 * such as homebrew or entries the group types in from its own Player's
 * Handbook, live as JSON files on the server (server/data/content/*.json,
 * never committed) and are merged on top at runtime. See docs/content-packs.md.
 */
import type { Ability, Skill } from '../rules.ts';

/**
 * A counter for a feature, trait or feat that can only be used so often
 * (packs only; the SRD's own are in resources.ts). The sheet shows it with a
 * Use button and rests give it back.
 */
export interface UsesDef {
  /**
   * How many: a fixed number, "pb" (Proficiency Bonus), "level" (character
   * level), an ability like "wis" (its modifier, at least 1), or steps by
   * level: [[3, 4], [7, 5]] = 4 from level 3 on, 5 from level 7 on.
   */
  max: number | 'pb' | 'level' | Ability | [level: number, uses: number][];
  /** "short": all back on a Short Rest · "shortOne": one back per Short Rest · "long": Long Rest only. */
  resetOn: 'short' | 'shortOne' | 'long';
  /** A pool of points or dice spent several at a time. */
  pool?: boolean;
  /** Name of the counter when it isn't the feature's, e.g. "Superiority Dice". */
  name?: string;
}

export interface Feature {
  level: number;
  name: string;
  description: string;
  uses?: UsesDef;
}

/** One way to get starting equipment: a fixed list plus gold, e.g. option A or B. */
export interface EquipmentOption {
  label: string;
  items: EquipmentPiece[];
  gp: number;
}

export type EquipmentPiece =
  | { ref: string; qty: number; note?: string }
  /** "Choose one" slot, e.g. a Holy Symbol or a Musical Instrument. */
  | { choose: string; from: string[]; qty: number };

export interface ClassSpellcasting {
  ability: Ability;
  /** Index 0 = class level 1. */
  levels: { cantrips: number; prepared: number; slots: number[] }[];
  description?: string;
}

export interface ClassDef {
  id: string;
  name: string;
  hitDie: number;
  primaryAbility: string;
  saves: Ability[];
  skillChoices: { choose: number; from: Skill[] };
  toolChoice?: string;
  /** Armor, weapons and tools, as display text. */
  proficiencies: string[];
  spellcasting?: ClassSpellcasting;
  equipment: EquipmentOption[];
  equipmentText?: string;
  features: Feature[];
  subclassLevel: number;
  description?: string;
}

export interface SubclassDef {
  id: string;
  classId: string;
  name: string;
  summary?: string;
  description?: string;
  features: Feature[];
}

export interface SpeciesDef {
  id: string;
  name: string;
  /** "Medium", "Small" or "Small or Medium" */
  size: string;
  speed: number;
  traits: { name: string; description: string; uses?: UsesDef }[];
  /** Lineage / ancestry / legacy picked with the species. */
  subspecies?: { label: string; options: { id: string; name: string; description: string; uses?: UsesDef }[] };
  /** Human: one extra skill of your choice. */
  skillChoice?: number;
  /** Human: one extra Origin feat. */
  originFeatChoice?: boolean;
  description?: string;
}

export interface BackgroundDef {
  id: string;
  name: string;
  /** The three abilities the +2/+1 or +1/+1/+1 can go to. */
  abilities: Ability[];
  feat: string;
  featNote?: string;
  skills: Skill[];
  tool: string;
  equipment: EquipmentOption[];
  equipmentText?: string;
  description?: string;
}

export type FeatCategory = 'origin' | 'general' | 'fighting-style' | 'epic-boon';

export interface FeatDef {
  id: string;
  name: string;
  category: FeatCategory;
  prerequisite?: string;
  repeatable?: boolean;
  description: string;
  uses?: UsesDef;
}

export interface SpellDef {
  id: string;
  name: string;
  /** 0 = cantrip */
  level: number;
  school: string;
  /** Class ids whose spell list has this spell. */
  classes: string[];
  castingTime: string;
  ritual?: boolean;
  range: string;
  components: string;
  duration: string;
  concentration?: boolean;
  description: string;
  higherLevels?: string;
}

/** One of the 15 conditions (Blinded, Prone, ...) with its rules text. */
export interface ConditionDef {
  id: string;
  name: string;
  description: string;
}

export type ItemKind = 'weapon' | 'armor' | 'gear' | 'tool' | 'magic';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  category: string;
  cost?: string;
  weight?: number;
  rarity?: string;
  attunement?: boolean | string;
  /** One-line stats, e.g. "1d8 Slashing" or "AC 11 + Dex modifier". */
  summary?: string;
  weapon?: {
    damage: string;
    damageType: string;
    versatile?: string;
    properties: string[];
    mastery?: string;
    range?: string;
    finesse: boolean;
    ranged: boolean;
  };
  armor?: {
    type: 'light' | 'medium' | 'heavy' | 'shield';
    base: number;
    dex: 'full' | 'max2' | 'none';
    strength?: number;
    stealthDisadvantage?: boolean;
  };
  description: string;
}

export interface ContentPack {
  id: string;
  name: string;
  /** Required credit line (SRD) or a note on where the text came from. */
  attribution?: string;
  source?: string;
  classes?: ClassDef[];
  subclasses?: SubclassDef[];
  species?: SpeciesDef[];
  backgrounds?: BackgroundDef[];
  feats?: FeatDef[];
  languages?: { id: string; name: string; rare?: boolean }[];
  conditions?: ConditionDef[];
  spells?: SpellDef[];
  items?: ItemDef[];
}
