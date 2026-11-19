import type { Content } from './index.ts';
import type { BackgroundDef, ClassDef, ConditionDef, FeatDef, ItemDef, SpeciesDef, SpellDef, SubclassDef } from './types.ts';
import { ABILITY_NAMES, SKILLS } from '../rules.ts';

/** What the long-press / hover popup shows. `body` uses **bold** and newlines. */
export interface InfoEntry {
  title: string;
  subtitle?: string;
  facts?: [label: string, value: string][];
  body: string;
  /** e.g. "Homebrew" when the entry is not from the SRD. */
  source?: string;
}

const ordinal = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

export function spellLevelText(level: number, school?: string): string {
  if (level === 0) return school ? `${school} cantrip` : 'Cantrip';
  return `${ordinal(level)}-level${school ? ` ${school.toLowerCase()}` : ''}`;
}

export function spellInfo(s: SpellDef): InfoEntry {
  const tags = [s.ritual && 'ritual', s.concentration && 'concentration'].filter(Boolean).join(', ');
  return {
    title: s.name,
    subtitle: `${spellLevelText(s.level, s.school)}${tags ? ` (${tags})` : ''}`,
    facts: [
      ['Casting time', s.castingTime + (s.ritual ? ' or Ritual' : '')],
      ['Range', s.range],
      ['Components', s.components],
      ['Duration', (s.concentration ? 'Concentration, ' : '') + s.duration],
    ].filter(([, v]) => v) as [string, string][],
    body: s.description + (s.higherLevels ? `\n**Using a Higher-Level Spell Slot.** ${s.higherLevels}` : ''),
  };
}

export function itemInfo(i: ItemDef): InfoEntry {
  const facts: [string, string][] = [];
  if (i.rarity) facts.push(['Rarity', i.rarity]);
  if (i.attunement) facts.push(['Attunement', typeof i.attunement === 'string' ? i.attunement : 'Required']);
  if (i.cost) facts.push(['Cost', i.cost]);
  if (i.weight) facts.push(['Weight', `${i.weight} lb.`]);
  return { title: i.name, subtitle: i.category, facts, body: i.description };
}

export function conditionInfo(c: ConditionDef): InfoEntry {
  return { title: c.name, subtitle: 'Condition', body: c.description };
}

export function featInfo(f: FeatDef): InfoEntry {
  const cat = { origin: 'Origin feat', general: 'General feat', 'fighting-style': 'Fighting Style feat', 'epic-boon': 'Epic Boon feat' }[f.category];
  return {
    title: f.name,
    subtitle: cat + (f.prerequisite ? ` (Prerequisite: ${f.prerequisite})` : ''),
    body: f.description + (f.repeatable ? '\n**Repeatable.** You can take this feat more than once.' : ''),
  };
}

export function classInfo(c: ClassDef): InfoEntry {
  const lvl1 = c.features.filter((f) => f.level === 1).map((f) => f.name);
  return {
    title: c.name,
    subtitle: `Hit Die d${c.hitDie} · Primary ability: ${c.primaryAbility}`,
    facts: [
      ['Saving throws', c.saves.map((a) => ABILITY_NAMES[a]).join(', ')],
      ['Skills', `Choose ${c.skillChoices.choose}: ${c.skillChoices.from.map((s) => SKILLS[s].name).join(', ')}`],
      ['Proficiencies', c.proficiencies.join(', ') || 'None'],
      ...(c.spellcasting ? ([['Spellcasting', ABILITY_NAMES[c.spellcasting.ability]]] as [string, string][]) : []),
      ['Level 1 features', lvl1.join(', ')],
    ],
    body: c.description ?? '',
  };
}

export function subclassInfo(s: SubclassDef): InfoEntry {
  return {
    title: s.name,
    subtitle: s.summary,
    body: [s.description, ...s.features.map((f) => `**Level ${f.level}: ${f.name}.** ${f.description}`)].filter(Boolean).join('\n'),
  };
}

export function speciesInfo(s: SpeciesDef): InfoEntry {
  return {
    title: s.name,
    subtitle: `${s.size} · Speed ${s.speed} ft.`,
    body: [s.description, ...s.traits.map((t) => `**${t.name}.** ${t.description}`)].filter(Boolean).join('\n'),
  };
}

export function backgroundInfo(b: BackgroundDef, content?: Content): InfoEntry {
  const feat = content?.feat(b.feat);
  return {
    title: b.name,
    facts: [
      ['Ability scores', b.abilities.map((a) => ABILITY_NAMES[a]).join(', ')],
      ['Feat', (feat?.name ?? b.feat) + (b.featNote ? ` (${b.featNote})` : '')],
      ['Skills', b.skills.map((s) => SKILLS[s].name).join(', ')],
      ['Tool', b.tool || 'None'],
      ...(b.equipmentText ? ([['Equipment', b.equipmentText]] as [string, string][]) : []),
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
      return f && c ? { title: f.name, subtitle: `${c.name} level ${f.level}`, body: f.description } : null;
    }
    case 'subclass': {
      const s = content.subclass(id);
      const f = s?.features.find((x) => x.name === name);
      return f && s ? { title: f.name, subtitle: `${s.name} level ${f.level}`, body: f.description } : null;
    }
    case 'species': {
      const s = content.speciesById(id);
      const t = s?.traits.find((x) => x.name === name);
      return t && s ? { title: t.name, subtitle: `${s.name} trait`, body: t.description } : null;
    }
    case 'subspecies': {
      const s = content.speciesById(id);
      const o = s?.subspecies?.options.find((x) => x.id === name);
      return o && s ? { title: o.name, subtitle: `${s.name}: ${s.subspecies!.label}`, body: o.description } : null;
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
