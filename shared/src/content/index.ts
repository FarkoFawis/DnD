import { ABILITIES, SKILL_KEYS } from '../rules.ts';
import type {
  BackgroundDef,
  ClassDef,
  ContentPack,
  FeatDef,
  ItemDef,
  SpeciesDef,
  SpellDef,
  SubclassDef,
} from './types.ts';

export * from './types.ts';
export * from './info.ts';

const KINDS = ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'languages', 'spells', 'items'] as const;
type Kind = (typeof KINDS)[number];
type EntryOf<K extends Kind> = NonNullable<ContentPack[K]>[number];

/**
 * All content packs merged. A later pack replaces an entry with the same id
 * in an earlier one, so a private pack can fix or extend SRD entries.
 */
export class Content {
  readonly packs: ContentPack[];
  private maps: { [K in Kind]: Map<string, EntryOf<K>> };
  private origin = new Map<string, ContentPack>();

  constructor(packs: ContentPack[]) {
    this.packs = packs;
    this.maps = Object.fromEntries(KINDS.map((k) => [k, new Map()])) as never;
    for (const pack of packs) {
      for (const kind of KINDS) {
        for (const entry of pack[kind] ?? []) {
          (this.maps[kind] as Map<string, unknown>).set(entry.id, entry);
          this.origin.set(`${kind}:${entry.id}`, pack);
        }
      }
    }
  }

  private all<K extends Kind>(kind: K): EntryOf<K>[] {
    return [...this.maps[kind].values()].sort((a, b) => a.name.localeCompare(b.name)) as EntryOf<K>[];
  }

  get classes(): ClassDef[] { return this.all('classes'); }
  get species(): SpeciesDef[] { return this.all('species'); }
  get backgrounds(): BackgroundDef[] { return this.all('backgrounds'); }
  get feats(): FeatDef[] { return this.all('feats'); }
  get languages() { return this.all('languages'); }
  get spells(): SpellDef[] { return this.all('spells'); }
  get items(): ItemDef[] { return this.all('items'); }

  class(id: string) { return this.maps.classes.get(id); }
  subclass(id: string) { return this.maps.subclasses.get(id); }
  speciesById(id: string) { return this.maps.species.get(id); }
  background(id: string) { return this.maps.backgrounds.get(id); }
  feat(id: string) { return this.maps.feats.get(id); }
  spell(id: string) { return this.maps.spells.get(id); }
  item(id: string) { return this.maps.items.get(id); }

  subclassesOf(classId: string): SubclassDef[] {
    return this.all('subclasses').filter((s) => s.classId === classId);
  }

  /** Spells on a class's list up to a spell level (0 = cantrips only). */
  spellsFor(classId: string, maxLevel: number): SpellDef[] {
    return this.spells.filter((s) => s.classes.includes(classId) && s.level <= maxLevel);
  }

  /** Name of the pack an entry comes from, e.g. to badge non-SRD entries. */
  packOf(kind: Kind, id: string): ContentPack | undefined {
    return this.origin.get(`${kind}:${id}`);
  }

  /** Finds a spell or item by name, for entries saved before they had a ref. */
  findByName<K extends 'spells' | 'items'>(kind: K, name: string): EntryOf<K> | undefined {
    const n = name.trim().toLowerCase();
    for (const e of this.maps[kind].values()) if (e.name.toLowerCase() === n) return e as EntryOf<K>;
    return undefined;
  }
}

// ---------- loading untrusted packs (server folder) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 20000) => typeof v === 'string' && v.length > 0 && v.length <= max;
const ABILITY_SET = new Set<string>(ABILITIES);
const SKILL_SET = new Set<string>(SKILL_KEYS);

/** Checks the fields the app relies on. Returns a reason when an entry can't be used. */
const CHECKS: { [K in Kind]: (e: Record<string, unknown>) => string | null } = {
  classes: (e) =>
    ![6, 8, 10, 12].includes(e.hitDie as number)
      ? 'hitDie must be 6, 8, 10 or 12'
      : !Array.isArray(e.saves) || !e.saves.every((a) => ABILITY_SET.has(a as string))
        ? 'saves must list abilities like "str"'
        : !isObj(e.skillChoices) || !Array.isArray(e.skillChoices.from) || !e.skillChoices.from.every((s) => SKILL_SET.has(s as string))
          ? 'skillChoices.from must list skills like "athletics"'
          : null,
  subclasses: (e) => (str(e.classId, 64) ? null : 'classId is required'),
  species: (e) => (typeof e.speed === 'number' && str(e.size, 40) ? null : 'speed and size are required'),
  backgrounds: (e) =>
    !Array.isArray(e.abilities) || e.abilities.length !== 3 || !e.abilities.every((a) => ABILITY_SET.has(a as string))
      ? 'abilities must list three abilities'
      : !Array.isArray(e.skills) || !e.skills.every((s) => SKILL_SET.has(s as string))
        ? 'skills must list skills like "insight"'
        : null,
  feats: (e) => (['origin', 'general', 'fighting-style', 'epic-boon'].includes(e.category as string) ? null : 'category must be origin, general, fighting-style or epic-boon'),
  languages: () => null,
  spells: (e) =>
    Number.isInteger(e.level) && (e.level as number) >= 0 && (e.level as number) <= 9 && Array.isArray(e.classes)
      ? null
      : 'level (0-9) and classes are required',
  items: (e) => (['weapon', 'armor', 'gear', 'tool', 'magic'].includes(e.kind as string) ? null : 'kind must be weapon, armor, gear, tool or magic'),
};

/** Fills the optional parts so a hand-written entry needs only the essentials. */
const DEFAULTS: { [K in Kind]: Record<string, unknown> } = {
  classes: { primaryAbility: '', proficiencies: [], equipment: [], features: [], subclassLevel: 3 },
  subclasses: { features: [] },
  species: { traits: [] },
  backgrounds: { feat: '', tool: '', equipment: [] },
  feats: { description: '' },
  languages: {},
  spells: { school: '', castingTime: '', range: '', components: '', duration: '', description: '' },
  items: { category: '', description: '' },
};

/**
 * Validates a content pack read from a file. Bad entries are dropped with a
 * reason instead of failing the whole pack.
 */
export function parsePack(raw: unknown, fallbackId: string): { pack: ContentPack | null; problems: string[] } {
  const problems: string[] = [];
  if (!isObj(raw)) return { pack: null, problems: ['The file is not a JSON object.'] };
  const pack: ContentPack = {
    id: str(raw.id, 64) ? (raw.id as string) : fallbackId,
    name: str(raw.name, 120) ? (raw.name as string) : fallbackId,
    attribution: str(raw.attribution, 2000) ? (raw.attribution as string) : undefined,
  };
  for (const kind of KINDS) {
    const list = raw[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`${kind} must be a list.`);
      continue;
    }
    const ok: unknown[] = [];
    list.forEach((e, i) => {
      const label = isObj(e) && typeof e.name === 'string' ? e.name : `#${i + 1}`;
      if (!isObj(e) || !str(e.id, 64) || !str(e.name, 120)) {
        problems.push(`${kind} ${label}: id and name are required.`);
        return;
      }
      const reason = CHECKS[kind](e);
      if (reason) problems.push(`${kind} ${label}: ${reason}.`);
      else ok.push({ ...DEFAULTS[kind], ...e });
    });
    (pack as unknown as Record<string, unknown>)[kind] = ok;
  }
  return { pack, problems };
}
export * from './attacks.ts';
