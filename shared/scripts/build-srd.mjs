/**
 * Converts the SRD 5.2 (2024 rules) data from the 5e-bits/5e-database
 * project into the compact content pack the app ships with.
 *
 *   git clone --depth 1 https://github.com/5e-bits/5e-database /tmp/5e-database
 *   node shared/scripts/build-srd.mjs /tmp/5e-database
 *
 * Writes shared/src/content/srd.json. The text is the System Reference
 * Document 5.2 by Wizards of the Coast, CC-BY-4.0 (see SRD-LICENSE.md).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = process.argv[2];
if (!repo) {
  console.error('Usage: node shared/scripts/build-srd.mjs <path to 5e-database checkout>');
  process.exit(1);
}
const dir = join(repo, 'src/2024/en');
const load = (name) => JSON.parse(readFileSync(join(dir, `5e-SRD-${name}.json`), 'utf8'));
let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {}

// ---------- text cleanup ----------
const MOJIBAKE = { 'â€™': '’', 'â€œ': '“', 'â€\u009d': '”', 'â€"': '—', 'â€“': '–', 'Ã—': '×' };
function clean(s) {
  if (s == null) return undefined;
  let t = String(s);
  for (const [bad, good] of Object.entries(MOJIBAKE)) t = t.split(bad).join(good);
  t = t
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    // PDF line-break hyphenation: "ex- pended" -> "expended"
    .replace(/([a-z])- ([a-z])/g, '$1$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t;
}

/** Bold the run-in headings the source left plain, e.g. "Cantrip Upgrade. The damage..." */
function boldHeadings(text) {
  if (!text) return text;
  const head = /^((?:[A-Z][\w'’()-]*)(?: (?:of|the|a|an|and|or|to|in|on|with|per|[A-Z0-9][\w'’()+-]*)){0,5})\. (?=[A-Z])/;
  return text
    .split('\n')
    .map((line, i) => (i > 0 && !line.startsWith('**') ? line.replace(head, '**$1.** ') : line))
    .join('\n');
}

const ABIL = { str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' };
const skillKey = (index) => {
  const s = index.replace(/^skill-/, '');
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
};

// ---------- equipment ----------
const equipment = load('Equipment');
const eqById = new Map(equipment.map((e) => [e.index, e]));
const categories = load('Equipment-Categories');
const catById = new Map(categories.map((c) => [c.index, c]));
const props = new Map(load('Weapon-Properties').map((p) => [p.index, p]));
const masteries = new Map(load('Weapon-Mastery-Properties').map((p) => [p.index, p]));

const catNames = (e) => e.equipment_categories.map((c) => c.index);
function kindOf(e) {
  const c = catNames(e);
  if (c.includes('weapons') || c.includes('ammunition')) return c.includes('ammunition') ? 'gear' : 'weapon';
  if (c.includes('armor')) return 'armor';
  if (c.includes('tools')) return 'tool';
  return 'gear';
}
const cost = (c) => (c ? `${c.quantity} ${c.unit.toUpperCase()}` : undefined);

function itemFromEquipment(e) {
  const kind = kindOf(e);
  const out = {
    id: e.index,
    name: clean(e.name),
    kind,
    category: clean(e.equipment_categories.at(-1)?.name ?? 'Gear'),
    cost: cost(e.cost),
    weight: e.weight,
  };
  const lines = [];
  if (kind === 'weapon') {
    const cat = e.equipment_categories.find((c) => /^(simple|martial)-(melee|ranged)-weapons$/.test(c.index));
    if (cat) out.category = cat.name.replace(/s$/, '');
    const dmg = e.damage ? `${e.damage.damage_dice} ${e.damage.damage_type.name}` : '';
    out.weapon = {
      damage: e.damage?.damage_dice ?? '',
      damageType: e.damage?.damage_type?.name ?? '',
      versatile: e.two_handed_damage?.damage_dice,
      properties: (e.properties ?? []).map((p) => p.name),
      mastery: e.mastery?.name,
      range: e.range?.long ? `${e.range.normal}/${e.range.long} ft.` : undefined,
      finesse: (e.properties ?? []).some((p) => p.index === 'finesse'),
      ranged: catNames(e).includes('ranged-weapons'),
    };
    out.summary = [dmg, e.two_handed_damage && `two-handed ${e.two_handed_damage.damage_dice}`].filter(Boolean).join(', ');
    lines.push(`**Damage.** ${dmg}${e.two_handed_damage ? ` (${e.two_handed_damage.damage_dice} two-handed)` : ''}`);
    if (e.range?.long) lines.push(`**Range.** ${e.range.normal}/${e.range.long} feet`);
    if (e.throw_range) lines.push(`**Thrown range.** ${e.throw_range.normal}/${e.throw_range.long} feet`);
    for (const p of e.properties ?? []) {
      const d = props.get(p.index);
      lines.push(`**${p.name}.** ${clean(d?.description ?? '')}`);
    }
    if (e.mastery) {
      const m = masteries.get(e.mastery.index);
      lines.push(`**Mastery: ${e.mastery.name}.** ${clean(m?.description ?? '')}`);
    }
  } else if (kind === 'armor') {
    const ac = e.armor_class;
    const isShield = catNames(e).includes('shields');
    const type = catNames(e).find((c) => /-armor$/.test(c));
    out.armor = {
      type: isShield ? 'shield' : (type ?? 'light-armor').replace('-armor', ''),
      base: ac.base,
      dex: isShield ? 'none' : ac.dex_bonus ? (ac.max_bonus ? 'max2' : 'full') : 'none',
      strength: e.str_minimum || undefined,
      stealthDisadvantage: e.stealth_disadvantage || undefined,
    };
    out.category = isShield ? 'Shield' : catById.get(type)?.name ?? 'Armor';
    const acText = isShield ? `+${ac.base}` : `${ac.base}${ac.dex_bonus ? (ac.max_bonus ? ' + Dex modifier (max 2)' : ' + Dex modifier') : ''}`;
    out.summary = `AC ${acText}`;
    lines.push(`**Armor Class.** ${acText}`);
    if (e.str_minimum) lines.push(`**Strength.** Needs Strength ${e.str_minimum}, otherwise your Speed drops by 10 feet.`);
    if (e.stealth_disadvantage) lines.push('**Stealth.** Disadvantage on Dexterity (Stealth) checks.');
    if (e.don_time) lines.push(`**Don / doff.** ${e.don_time} / ${e.doff_time}`);
  } else if (kind === 'tool') {
    if (e.ability) lines.push(`**Ability.** ${e.ability.name}`);
    for (const u of e.utilize ?? []) lines.push(`**Utilize.** ${clean(u.name)}${u.dc ? ` (DC ${u.dc.dc_value})` : ''}`);
    if (e.craft?.length) lines.push(`**Craft.** ${e.craft.map((c) => c.name).join(', ')}`);
  }
  if (e.description) lines.push(clean(e.description));
  if (e.contents?.length)
    lines.push(`**Contains.** ${e.contents.map((c) => `${c.quantity > 1 ? `${c.quantity} ` : ''}${c.item.name}`).join(', ')}`);
  out.description = lines.join('\n');
  return out;
}

const items = equipment.map(itemFromEquipment);

// ---------- magic items ----------
for (const m of load('Magic-Items')) {
  const desc = clean(m.desc);
  const [header, ...rest] = desc.split('\n');
  items.push({
    id: `magic-${m.index}`,
    name: clean(m.name),
    kind: 'magic',
    category: clean(header),
    rarity: clean(m.rarity?.name),
    attunement: m.attunement || undefined,
    description: boldHeadings(rest.join('\n').trim()),
  });
}

// ---------- spells ----------
const spells = load('Spells').map((s) => ({
  id: s.index,
  name: clean(s.name),
  level: s.level,
  school: s.school.name,
  classes: s.classes.map((c) => c.index),
  castingTime: clean(s.casting_time),
  ritual: s.ritual || undefined,
  range: clean(s.range),
  components: s.components.join(', ') + (s.material ? ` (${clean(s.material)})` : ''),
  duration: clean(s.duration),
  concentration: s.concentration || undefined,
  description: boldHeadings(clean(s.description)),
  higherLevels: clean(s.higher_level),
}));

// ---------- equipment option sets ----------
function categoryItems(index) {
  const c = catById.get(index);
  return (c?.equipment ?? []).map((e) => e.index).filter((i) => eqById.has(i));
}
function pieces(option) {
  const list = option.option_type === 'multiple' ? option.items : [option];
  const out = { items: [], gp: 0 };
  for (const it of list) {
    if (it.option_type === 'money') out.gp += it.unit === 'gp' ? it.count : 0;
    else if (it.option_type === 'counted_reference') {
      const ref = it.of.index;
      if (eqById.has(ref)) out.items.push({ ref, qty: it.count, ...(it.of.note ? { note: clean(it.of.note) } : {}) });
      else out.items.push({ choose: clean(it.of.name).replace(/s$/, ''), from: categoryItems(ref), qty: it.count });
    } else if (it.option_type === 'choice') {
      const f = it.choice.from;
      let from = [];
      if (f.option_set_type === 'equipment_category') from = categoryItems(f.equipment_category.index);
      else
        for (const o of f.options) {
          if (o.option_type === 'choice' && o.choice.from.option_set_type === 'equipment_category')
            from.push(...categoryItems(o.choice.from.equipment_category.index));
          else if (o.option_type === 'counted_reference') from.push(o.of.index);
        }
      out.items.push({ choose: clean(it.choice.desc ?? 'Choose one'), from, qty: 1 });
    }
  }
  return out;
}
function equipmentOptions(sets, desc) {
  const set = sets?.[0];
  if (!set) return [];
  const labels = 'ABCDE';
  return set.from.options.map((o, i) => ({ label: labels[i], ...pieces(o) }));
}

// ---------- classes ----------
const levels = load('Levels');
const features = load('Features');
const subclassesRaw = load('Subclasses');
const featureText = (f) => clean(f.description);

const classes = load('Classes').map((c) => {
  const skillSet = c.proficiency_choices.find((p) => p.from.options.some((o) => o.item?.index?.startsWith('skill-')));
  const toolSet = c.proficiency_choices.find((p) => p !== skillSet);
  const lv = levels.filter((l) => l.class.index === c.index && !l.subclass).sort((a, b) => a.level - b.level);
  const sc = c.spellcasting;
  return {
    id: c.index,
    name: c.name,
    hitDie: c.hit_die,
    primaryAbility: clean(c.primary_ability.desc),
    saves: c.saving_throws.map((s) => ABIL[s.index]),
    skillChoices: {
      choose: skillSet.choose,
      from: skillSet.from.options.map((o) => skillKey(o.item.index)),
    },
    toolChoice: toolSet ? clean(toolSet.desc) : undefined,
    proficiencies: c.proficiencies.filter((p) => !p.index.startsWith('saving-throw')).map((p) => clean(p.name.replace(/^Tool: /, ''))),
    spellcasting: sc
      ? {
          ability: ABIL[sc.spellcasting_ability.index],
          levels: lv.map((l) => ({
            cantrips: l.spellcasting?.cantrips_known ?? 0,
            prepared: l.spellcasting?.prepared_spells ?? 0,
            slots: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => l.spellcasting?.[`spell_slots_level_${n}`] ?? 0),
          })),
          description: clean(sc.info.map((i) => `**${i.name}.** ${i.desc.join('\n')}`).join('\n')),
        }
      : undefined,
    equipment: equipmentOptions(c.starting_equipment_options),
    equipmentText: clean(c.starting_equipment_options?.[0]?.desc),
    features: features
      .filter((f) => f.class.index === c.index && !f.subclass)
      .map((f) => ({ level: Number(f.level.index.split('-').at(-1)), name: clean(f.name), description: featureText(f) }))
      .sort((a, b) => a.level - b.level),
    subclassLevel: 3,
  };
});

const subclasses = subclassesRaw.map((s) => ({
  id: s.index,
  classId: s.class.index,
  name: clean(s.name),
  summary: clean(s.summary),
  description: clean(s.description),
  features: (s.features ?? []).map((f) => ({ level: f.level, name: clean(f.name), description: clean(f.description) })),
}));

// ---------- species ----------
const traits = new Map(load('Traits').map((t) => [t.index, t]));
const subspeciesRaw = new Map(load('Subspecies').map((s) => [s.index, s]));
const SUB_LABEL = { dragonborn: 'Draconic Ancestry', elf: 'Elven Lineage', gnome: 'Gnomish Lineage', goliath: 'Giant Ancestry', tiefling: 'Fiendish Legacy' };
const species = load('Species').map((s) => {
  if (s.index === 'human') s.size = 'Small or Medium';
  const out = {
    id: s.index,
    name: s.name,
    size: s.size ?? s.size_options.from.options.map((o) => o.size).join(' or '),
    speed: s.speed,
    traits: s.traits.map((t) => ({ name: clean(traits.get(t.index)?.name ?? t.name), description: clean(traits.get(t.index)?.description ?? '') })),
  };
  if (s.subspecies?.length) {
    out.subspecies = {
      label: SUB_LABEL[s.index] ?? 'Lineage',
      options: s.subspecies.map((ref) => {
        const sub = subspeciesRaw.get(ref.index);
        const name = clean(sub.name).replace(/^[^:]+:\s*/, '');
        const tr = (sub.traits ?? []).map((t) => {
          const full = traits.get(t.index);
          return `**${clean(t.name)}${t.level > 1 ? ` (level ${t.level})` : ''}.** ${clean(full?.description ?? '')}`.trim();
        });
        return { id: sub.index, name, description: tr.join('\n') };
      }),
    };
  }
  if (s.index === 'human') {
    out.skillChoice = 1;
    out.originFeatChoice = true;
  }
  return out;
});

// ---------- backgrounds & feats ----------
const backgrounds = load('Backgrounds').map((b) => {
  const pr = b.proficiencies;
  return {
    id: b.index,
    name: b.name,
    abilities: b.ability_scores.map((a) => ABIL[a.index]),
    feat: b.feat.index,
    featNote: clean(b.feat.note),
    skills: pr.filter((p) => p.index.startsWith('skill-')).map((p) => skillKey(p.index)),
    tool: pr.filter((p) => p.index.startsWith('tool-')).map((p) => clean(p.name.replace(/^Tool: /, ''))).join(', '),
    equipment: equipmentOptions(b.equipment_options),
    equipmentText: clean(b.equipment_options?.[0]?.desc),
  };
});

const feats = load('Feats').map((f) => ({
  id: f.index,
  name: f.name,
  category: f.type,
  prerequisite: f.prerequisite_options?.desc
    ? clean(f.prerequisite_options.desc)
    : f.prerequisites?.minimum_level
      ? `Level ${f.prerequisites.minimum_level}+${f.prerequisites.feature_named ? `, ${f.prerequisites.feature_named} feature` : ''}`
      : f.prerequisites?.feature_named
        ? `${f.prerequisites.feature_named} feature`
        : undefined,
  repeatable: f.repeatable ? true : undefined,
  description: clean(f.description),
}));

const conditions = load('Conditions').map((c) => ({ id: c.index, name: c.name, description: clean(c.description) }));

const languages = load('Languages').map((l) => ({ id: l.index, name: l.name, rare: l.is_rare || undefined }));

// ---------- small fixes where the source data is incomplete ----------
const bard = classes.find((c) => c.id === 'bard');
bard?.equipment[0]?.items.splice(2, 0, { choose: 'Musical Instrument', from: categoryItems('musical-instruments'), qty: 1 });
const soldier = backgrounds.find((b) => b.id === 'soldier');
if (soldier && !soldier.tool) soldier.tool = 'One kind of Gaming Set';
// SRD 5.2: Sage gets Magic Initiate (Wizard); the source data drops the note.
const sage = backgrounds.find((b) => b.id === 'sage');
if (sage && !sage.featNote) sage.featNote = 'Wizard';
for (const b of backgrounds)
  for (const o of b.equipment) for (const it of o.items) if (it.choose === 'Choose one') it.choose = 'Gaming Set';

const pack = {
  id: 'srd',
  name: 'System Reference Document 5.2',
  attribution:
    'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  source: `5e-bits/5e-database@${commit.slice(0, 12)} (src/2024/en)`,
  classes,
  subclasses,
  species,
  backgrounds,
  feats,
  languages,
  conditions,
  spells,
  items,
};
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '../src/content/srd.json');
writeFileSync(out, JSON.stringify(pack) + '\n');
const count = (k) => `${pack[k].length} ${k}`;
console.log(`Wrote ${out}: ${['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'spells', 'items'].map(count).join(', ')}`);
