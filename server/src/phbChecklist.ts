/**
 * What the 2024 Player's Handbook has, by name only, so `npm run content` can
 * say what the SRD plus the private packs still lack. Names only: the text of
 * these entries is never part of the repository (see docs/content-packs.md).
 * The spell list is the part most likely to be off by a name or two; it is
 * checked against the book as its pages come in.
 */
import type { Content } from '@dnd/shared';

export const PHB_SUBCLASSES: Record<string, string[]> = {
  barbarian: ['Path of the Berserker', 'Path of the Wild Heart', 'Path of the World Tree', 'Path of the Zealot'],
  bard: ['College of Dance', 'College of Glamour', 'College of Lore', 'College of Valor'],
  cleric: ['Life Domain', 'Light Domain', 'Trickery Domain', 'War Domain'],
  druid: ['Circle of the Land', 'Circle of the Moon', 'Circle of the Sea', 'Circle of the Stars'],
  fighter: ['Battle Master', 'Champion', 'Eldritch Knight', 'Psi Warrior'],
  monk: ['Warrior of Mercy', 'Warrior of Shadow', 'Warrior of the Elements', 'Warrior of the Open Hand'],
  paladin: ['Oath of Devotion', 'Oath of Glory', 'Oath of the Ancients', 'Oath of Vengeance'],
  ranger: ['Beast Master', 'Fey Wanderer', 'Gloom Stalker', 'Hunter'],
  rogue: ['Arcane Trickster', 'Assassin', 'Soulknife', 'Thief'],
  sorcerer: ['Aberrant Sorcery', 'Clockwork Sorcery', 'Draconic Sorcery', 'Wild Magic Sorcery'],
  warlock: ['Archfey Patron', 'Celestial Patron', 'Fiend Patron', 'Great Old One Patron'],
  wizard: ['Abjurer', 'Diviner', 'Evoker', 'Illusionist'],
};

export const PHB_BACKGROUNDS = [
  'Acolyte', 'Artisan', 'Charlatan', 'Criminal', 'Entertainer', 'Farmer', 'Guard', 'Guide',
  'Hermit', 'Merchant', 'Noble', 'Sage', 'Sailor', 'Scribe', 'Soldier', 'Wayfarer',
];

export const PHB_SPECIES = ['Aasimar', 'Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling'];

export const PHB_FEATS: Record<string, string[]> = {
  'Origin feats': ['Alert', 'Crafter', 'Healer', 'Lucky', 'Magic Initiate', 'Musician', 'Savage Attacker', 'Skilled', 'Tavern Brawler', 'Tough'],
  'General feats': [
    'Ability Score Improvement', 'Actor', 'Athlete', 'Charger', 'Chef', 'Crossbow Expert', 'Crusher', 'Defensive Duelist',
    'Dual Wielder', 'Durable', 'Elemental Adept', 'Fey-Touched', 'Grappler', 'Great Weapon Master', 'Heavily Armored',
    'Heavy Armor Master', 'Inspiring Leader', 'Keen Mind', 'Lightly Armored', 'Mage Slayer', 'Martial Weapon Training',
    'Medium Armor Master', 'Moderately Armored', 'Mounted Combatant', 'Observant', 'Piercer', 'Poisoner', 'Polearm Master',
    'Resilient', 'Ritual Caster', 'Sentinel', 'Shadow-Touched', 'Sharpshooter', 'Shield Master', 'Skill Expert', 'Skulker',
    'Slasher', 'Speedy', 'Spell Sniper', 'Telekinetic', 'Telepathic', 'War Caster', 'Weapon Master',
  ],
  'Fighting Style feats': [
    'Archery', 'Blind Fighting', 'Defense', 'Dueling', 'Great Weapon Fighting', 'Interception', 'Protection',
    'Thrown Weapon Fighting', 'Two-Weapon Fighting', 'Unarmed Fighting',
  ],
  'Epic Boon feats': [
    'Boon of Combat Prowess', 'Boon of Dimensional Travel', 'Boon of Energy Resistance', 'Boon of Fate', 'Boon of Fortitude',
    'Boon of Irresistible Offense', 'Boon of Recovery', 'Boon of Skill', 'Boon of Speed', 'Boon of Spell Recall',
    'Boon of the Night Spirit', 'Boon of Truesight',
  ],
};

/** Spells of the book that the SRD leaves out. */
export const PHB_EXTRA_SPELLS = [
  'Arcane Gate', 'Arcane Vigor', 'Armor of Agathys', 'Arms of Hadar', 'Aura of Purity', 'Aura of Vitality', 'Banishing Smite',
  'Beast Sense', 'Blade Ward', 'Blinding Smite', 'Circle of Power', 'Cloud of Daggers', 'Compelled Duel', 'Conjure Barrage',
  'Conjure Volley', 'Cordon of Arrows', 'Crown of Madness', "Crusader's Mantle", 'Destructive Wave', 'Elemental Weapon',
  'Feign Death', 'Fount of Moonlight', 'Friends', 'Grasping Vine', 'Hail of Thorns', 'Hunger of Hadar',
  "Jallarzi's Storm of Radiance", 'Lightning Arrow', 'Mind Sliver', 'Power Word Fortify', 'Staggering Smite',
  'Steel Wind Strike', 'Summon Aberration', 'Summon Beast', 'Summon Celestial', 'Summon Construct', 'Summon Elemental',
  'Summon Fey', 'Summon Fiend', 'Summon Undead', 'Swift Quiver', 'Sword Burst', 'Synaptic Static', "Tasha's Bubbling Cauldron",
  'Telepathy', 'Thorn Whip', 'Thunderclap', 'Thunderous Smite', 'Toll the Dead', 'Witch Bolt', 'Word of Radiance',
  'Wrathful Smite', "Yolande's Regal Presence",
];

export interface Coverage {
  /** e.g. "Subclasses" */
  group: string;
  total: number;
  /** Names the content doesn't have yet; subclasses as "Wizard: Diviner". */
  missing: string[];
}

/** "Two-Weapon Fighting" and "Two Weapon Fighting" are the same entry. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** What of the book the loaded content (SRD + packs) has, group by group. */
export function phbCoverage(content: Content): Coverage[] {
  const names = (list: { name: string }[]) => new Set(list.map((e) => key(e.name)));
  const out: Coverage[] = [];

  const subs: string[] = [];
  let subTotal = 0;
  for (const [classId, list] of Object.entries(PHB_SUBCLASSES)) {
    const have = names(content.subclassesOf(classId));
    const className = content.class(classId)?.name ?? classId;
    subTotal += list.length;
    for (const n of list) if (!have.has(key(n))) subs.push(`${className}: ${n}`);
  }
  out.push({ group: 'Subclasses', total: subTotal, missing: subs });

  const simple = (group: string, list: string[], have: Set<string>) =>
    out.push({ group, total: list.length, missing: list.filter((n) => !have.has(key(n))) });
  simple('Backgrounds', PHB_BACKGROUNDS, names(content.backgrounds));
  simple('Species', PHB_SPECIES, names(content.species));
  const feats = names(content.feats);
  for (const [group, list] of Object.entries(PHB_FEATS)) simple(group, list, feats);
  simple('Spells the free rules leave out', PHB_EXTRA_SPELLS, names(content.spells));
  return out;
}
