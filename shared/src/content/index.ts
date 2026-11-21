import { ABILITIES, SKILL_KEYS } from '../rules.ts';
import type {
  BackgroundDef,
  ClassDef,
  ConditionDef,
  ContentPack,
  FeatDef,
  ItemDef,
  SpeciesDef,
  SpellDef,
  SubclassDef,
  UsesDef,
} from './types.ts';

export * from './types.ts';
export * from './info.ts';

const KINDS = ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'languages', 'conditions', 'spells', 'items'] as const;
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
  get conditions(): ConditionDef[] { return this.all('conditions'); }
  get spells(): SpellDef[] { return this.all('spells'); }
  get items(): ItemDef[] { return this.all('items'); }

  class(id: string) { return this.maps.classes.get(id); }
  subclass(id: string) { return this.maps.subclasses.get(id); }
  speciesById(id: string) { return this.maps.species.get(id); }
  background(id: string) { return this.maps.backgrounds.get(id); }
  feat(id: string) { return this.maps.feats.get(id); }
  condition(id: string) { return this.maps.conditions.get(id); }
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
  conditions: (e) => (str(e.description) ? null : 'description is required'),
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
  conditions: {},
  spells: { school: '', castingTime: '', range: '', components: '', duration: '', description: '' },
  items: { category: '', description: '' },
};

/** A `uses` counter from a pack, or null when it can't be used as written. */
function cleanUses(v: unknown): UsesDef | null {
  if (!isObj(v) || !['short', 'shortOne', 'long'].includes(v.resetOn as string)) return null;
  const m = v.max;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 999;
  const okMax =
    count(m) ||
    m === 'pb' ||
    m === 'level' ||
    ABILITY_SET.has(m as string) ||
    (Array.isArray(m) && m.length > 0 && m.length <= 20 && m.every((p) => Array.isArray(p) && p.length === 2 && count(p[0]) && count(p[1])));
  if (!okMax) return null;
  return {
    max: m as UsesDef['max'],
    resetOn: v.resetOn as UsesDef['resetOn'],
    ...(v.pool === true ? { pool: true } : {}),
    ...(str(v.name, 80) ? { name: v.name as string } : {}),
  };
}

/**
 * The named parts inside an entry (features of a class or subclass, traits and
 * lineages of a species): drops the ones that can't be shown and tidies their
 * `uses`. `needs` are the fields every part must have.
 */
function cleanParts(list: unknown, where: string, needs: 'level' | 'id' | null, problems: string[]): Record<string, unknown>[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) {
    problems.push(`${where} must be a list (left out).`);
    return [];
  }
  const out: Record<string, unknown>[] = [];
  list.forEach((f, i) => {
    const label = isObj(f) && typeof f.name === 'string' ? f.name : `#${i + 1}`;
    if (!isObj(f) || !str(f.name, 120) || (f.description !== undefined && typeof f.description !== 'string')) {
      problems.push(`${where} ${label}: name and description must be text (left out).`);
      return;
    }
    if (needs === 'level' && !(Number.isInteger(f.level) && (f.level as number) >= 1 && (f.level as number) <= 20)) {
      problems.push(`${where} ${label}: level must be 1-20 (left out).`);
      return;
    }
    if (needs === 'id' && !str(f.id, 64)) {
      problems.push(`${where} ${label}: id is required (left out).`);
      return;
    }
    out.push(withCleanUses({ description: '', ...f }, `${where} ${label}`, problems));
  });
  return out;
}

function withCleanUses(e: Record<string, unknown>, where: string, problems: string[]): Record<string, unknown> {
  if (e.uses === undefined) return e;
  const uses = cleanUses(e.uses);
  if (uses) return { ...e, uses };
  problems.push(`${where}: uses is not valid, so it gets no counter (see docs/content-packs.md).`);
  const { uses: _dropped, ...rest } = e;
  return rest;
}

/** Tidies what is nested inside an entry that passed its check. */
function cleanEntry(kind: Kind, e: Record<string, unknown>, label: string, problems: string[]): Record<string, unknown> {
  const where = `${kind} ${label}`;
  if (kind === 'classes' || kind === 'subclasses') return { ...e, features: cleanParts(e.features, `${where}: feature`, 'level', problems) };
  if (kind === 'feats') return withCleanUses(e, where, problems);
  if (kind === 'species') {
    const out: Record<string, unknown> = { ...e, traits: cleanParts(e.traits, `${where}: trait`, null, problems) };
    if (e.subspecies !== undefined) {
      const sub = e.subspecies;
      if (isObj(sub) && str(sub.label, 80)) out.subspecies = { label: sub.label, options: cleanParts(sub.options, `${where}: ${sub.label}`, 'id', problems) };
      else {
        problems.push(`${where}: subspecies needs a label and options (left out).`);
        delete out.subspecies;
      }
    }
    return out;
  }
  return e;
}

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
      else ok.push(cleanEntry(kind, { ...DEFAULTS[kind], ...e }, label, problems));
    });
    (pack as unknown as Record<string, unknown>)[kind] = ok;
  }
  return { pack, problems };
}
export * from './attacks.ts';

/**
 * Things in a pack that load fine but probably aren't what was meant: ids that
 * point at nothing, the same thing entered twice. For `npm run content`.
 * `base` are the packs loaded before it (the SRD first).
 */
export function packWarnings(pack: ContentPack, base: ContentPack[]): string[] {
  const all = new Content([...base, pack]);
  const before = new Content(base);
  const w: string[] = [];
  const slug = (n: string) => n.trim().toLowerCase();

  for (const kind of KINDS) {
    const seen = new Set<string>();
    const earlier = new Map<string, string>();
    for (const p of base) for (const e of p[kind] ?? []) earlier.set(slug(e.name), e.id);
    for (const e of pack[kind] ?? []) {
      if (seen.has(e.id)) w.push(`${kind} ${e.name}: the id "${e.id}" is used twice in this pack; only the last one counts.`);
      seen.add(e.id);
      const other = earlier.get(slug(e.name));
      if (other && other !== e.id) w.push(`${kind} ${e.name}: there already is one with this name (id "${other}"). Use that id to replace it, or players will see both.`);
    }
  }
  for (const s of pack.subclasses ?? []) {
    if (!all.class(s.classId)) w.push(`subclasses ${s.name}: there is no class with the id "${s.classId}".`);
    if (s.features.length === 0) w.push(`subclasses ${s.name}: has no features yet.`);
  }
  for (const b of pack.backgrounds ?? []) {
    if (!b.feat) w.push(`backgrounds ${b.name}: has no origin feat.`);
    else if (!all.feat(b.feat)) w.push(`backgrounds ${b.name}: there is no feat with the id "${b.feat}" (yet).`);
    for (const opt of b.equipment) {
      for (const piece of opt.items ?? []) {
        const refs = 'ref' in piece ? [piece.ref] : piece.from;
        for (const ref of refs) if (!all.item(ref)) w.push(`backgrounds ${b.name}: equipment "${ref}" is not an item id.`);
      }
    }
  }
  for (const sp of pack.spells ?? []) {
    for (const c of sp.classes) if (!all.class(c)) w.push(`spells ${sp.name}: there is no class with the id "${c}".`);
    if (sp.classes.length === 0 && !before.spell(sp.id)) w.push(`spells ${sp.name}: is on no class's spell list, so nobody can pick it.`);
    if (!sp.description) w.push(`spells ${sp.name}: has no description.`);
  }
  for (const f of pack.feats ?? []) if (!f.description) w.push(`feats ${f.name}: has no description.`);
  return w;
}
