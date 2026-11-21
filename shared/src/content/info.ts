import type { Content } from './index.ts';
import type { BackgroundDef, ClassDef, ConditionDef, FeatDef, ItemDef, SpeciesDef, SpellDef, SubclassDef } from './types.ts';
import { ABILITY_NAMES, SKILLS } from '../rules.ts';
import { msg, ordinal, ruleText, t, tx } from '../i18n.ts';

/** What the long-press / hover popup shows. `body` uses **bold** and newlines. */
export interface InfoEntry {
  title: string;
  subtitle?: string;
  facts?: [label: string, value: string][];
  body: string;
  /** e.g. "Homebrew" when the entry is not from the SRD. */
  source?: string;
}

/** "1st-level evocation", "Evocation cantrip" */
export function spellLevelText(level: number, school?: string): string {
  if (level === 0) return school ? t('{school} cantrip', { school: tx(school) }) : t('Cantrip');
  return school ? t('{nth}-level {school}', { nth: ordinal(level), school: tx(school.toLowerCase()) }) : t('{nth}-level', { nth: ordinal(level) });
}

export function spellInfo(s: SpellDef): InfoEntry {
  const tags = [s.ritual && t('ritual'), s.concentration && t('concentration')].filter(Boolean).join(', ');
  return {
    title: s.name,
    subtitle: `${spellLevelText(s.level, s.school)}${tags ? ` (${tags})` : ''}`,
    facts: [
      [t('Casting time'), tx(s.castingTime) + (s.ritual ? ` ${t('or Ritual')}` : '')],
      [t('Range'), tx(s.range)],
      [t('Components'), s.components],
      [t('Duration'), (s.concentration ? `${t('Concentration')}, ` : '') + tx(s.duration)],
    ].filter(([, v]) => v) as [string, string][],
    body: s.description + (s.higherLevels ? `\n**${t('Using a Higher-Level Spell Slot.')}** ${s.higherLevels}` : ''),
  };
}

export function itemInfo(i: ItemDef): InfoEntry {
  const facts: [string, string][] = [];
  if (i.rarity) facts.push([t('Rarity'), tx(i.rarity)]);
  if (i.attunement) facts.push([t('Attunement'), typeof i.attunement === 'string' ? i.attunement : t('Required')]);
  if (i.cost) facts.push([t('Cost'), tx(i.cost)]);
  if (i.weight) facts.push([t('Weight'), `${i.weight} lb.`]);
  return { title: i.name, subtitle: tx(i.category), facts, body: i.description };
}

export function conditionInfo(c: ConditionDef): InfoEntry {
  return { title: tx(c.name), subtitle: t('Condition'), body: ruleText(`condition:${c.id}`, c.description) };
}

const FEAT_CATEGORY = { origin: msg('Origin feat'), general: msg('General feat'), 'fighting-style': msg('Fighting Style feat'), 'epic-boon': msg('Epic Boon feat') };

export function featInfo(f: FeatDef): InfoEntry {
  return {
    title: f.name,
    subtitle: t(FEAT_CATEGORY[f.category]) + (f.prerequisite ? ` (${t('Prerequisite: {what}', { what: f.prerequisite })})` : ''),
    body: f.description + (f.repeatable ? `\n**${t('Repeatable.')}** ${t('You can take this feat more than once.')}` : ''),
  };
}

export function classInfo(c: ClassDef): InfoEntry {
  const lvl1 = c.features.filter((f) => f.level === 1).map((f) => f.name);
  return {
    title: tx(c.name),
    subtitle: t('Hit Die d{die} · Primary ability: {ability}', { die: c.hitDie, ability: tx(c.primaryAbility) }),
    facts: [
      [t('Saving throws'), c.saves.map((a) => t(ABILITY_NAMES[a])).join(', ')],
      [t('Skills'), t('Choose {n}: {skills}', { n: c.skillChoices.choose, skills: c.skillChoices.from.map((s) => t(SKILLS[s].name)).join(', ') })],
      [t('Proficiencies'), c.proficiencies.map((p) => tx(p)).join(', ') || t('None')],
      ...(c.spellcasting ? ([[t('Spellcasting'), t(ABILITY_NAMES[c.spellcasting.ability])]] as [string, string][]) : []),
      [t('Level 1 features'), lvl1.join(', ')],
    ],
    body: c.description ?? '',
  };
}

export function subclassInfo(s: SubclassDef): InfoEntry {
  return {
    title: tx(s.name),
    subtitle: s.summary,
    body: [s.description, ...s.features.map((f) => `**${t('Level {n}', { n: f.level })}: ${f.name}.** ${f.description}`)].filter(Boolean).join('\n'),
  };
}

export function speciesInfo(s: SpeciesDef): InfoEntry {
  return {
    title: tx(s.name),
    subtitle: t('{size} · Speed {speed} ft.', { size: tx(s.size), speed: s.speed }),
    body: [s.description, ...s.traits.map((trait) => `**${trait.name}.** ${trait.description}`)].filter(Boolean).join('\n'),
  };
}

export function backgroundInfo(b: BackgroundDef, content?: Content): InfoEntry {
  const feat = content?.feat(b.feat);
  return {
    title: tx(b.name),
    facts: [
      [t('Ability scores'), b.abilities.map((a) => t(ABILITY_NAMES[a])).join(', ')],
      [t('Feat'), (feat?.name ?? b.feat) + (b.featNote ? ` (${b.featNote})` : '')],
      [t('Skills'), b.skills.map((s) => t(SKILLS[s].name)).join(', ')],
      [t('Tool'), b.tool || t('None')],
      ...(b.equipmentText ? ([[t('Equipment'), b.equipmentText]] as [string, string][]) : []),
    ],
    body: b.description ?? '',
  };
}

/**
 * Feature refs saved on a character point back into the content:
 * class:<classId>:<name> · subclass:<id>:<name> · species:<id>:<trait> ·
 * subspecies:<speciesId>:<optionId> · feat:<id> · background:<id>
 */
export function describeRef(content: Content, ref: string): InfoEntry | null {
  const [kind, id = '', name = ''] = ref.split(':');
  switch (kind) {
    case 'class': {
      const c = content.class(id);
      const f = c?.features.find((x) => x.name === name);
      return f && c ? { title: f.name, subtitle: t('{name} level {n}', { name: tx(c.name), n: f.level }), body: f.description } : null;
    }
    case 'subclass': {
      const s = content.subclass(id);
      const f = s?.features.find((x) => x.name === name);
      return f && s ? { title: f.name, subtitle: t('{name} level {n}', { name: tx(s.name), n: f.level }), body: f.description } : null;
    }
    case 'species': {
      const s = content.speciesById(id);
      const trait = s?.traits.find((x) => x.name === name);
      return trait && s ? { title: trait.name, subtitle: t('{name} trait', { name: tx(s.name) }), body: trait.description } : null;
    }
    case 'subspecies': {
      const s = content.speciesById(id);
      const o = s?.subspecies?.options.find((x) => x.id === name);
      return o && s ? { title: o.name, subtitle: `${tx(s.name)}: ${tx(s.subspecies!.label)}`, body: o.description } : null;
    }
    case 'feat': {
      const f = content.feat(id);
      return f ? featInfo(f) : null;
    }
    case 'background': {
      const b = content.background(id);
      return b ? backgroundInfo(b, content) : null;
    }
    default:
      return null;
  }
}
