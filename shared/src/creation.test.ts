import { describe, expect, it } from 'vitest';
import { Content, describeRef, parsePack } from './content/index.ts';
import { SRD } from './content/srd.ts';
import { allProblems, buildCharacter, emptyChoices, pointBuySpent, spellAllowance, stepProblems, type CreationChoices } from './creation.ts';
import { normalizeCharacter, sanitizeCharacterPatch } from './character.ts';

const content = new Content([SRD]);
let n = 0;
const id = () => `id${++n}`;

function wizard(): CreationChoices {
  return {
    ...emptyChoices(),
    name: 'Elara',
    classId: 'wizard',
    classSkills: ['arcana', 'investigation'],
    backgroundId: 'sage',
    magicInitiate: { list: '', ability: 'int', cantrips: ['light', 'mage-hand'], spell: 'sleep' },
    speciesId: 'elf',
    subspeciesId: 'elven-lineage-high-elf',
    languages: ['elvish', 'draconic'],
    baseScores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    plus2: 'int',
    plus1: 'con',
    classEquipment: 'A',
    backgroundEquipment: 'B',
    cantrips: ['fire-bolt', 'minor-illusion', 'ray-of-frost'],
    preparedSpells: ['magic-missile', 'shield', 'detect-magic', 'mage-armor'],
  };
}

describe('SRD content', () => {
  it('has the 2024 SRD basics', () => {
    expect(content.classes).toHaveLength(12);
    expect(content.species.map((s) => s.name)).toContain('Tiefling');
    expect(content.backgrounds.map((b) => b.id)).toEqual(['acolyte', 'criminal', 'sage', 'soldier']);
    expect(content.spells.length).toBeGreaterThan(300);
    expect(content.spell('fireball')?.description).toMatch(/20-foot-radius Sphere/);
    expect(content.item('longsword')?.weapon?.mastery).toBe('Sap');
    expect(content.item('magic-bag-of-holding')?.kind).toBe('magic');
  });
  it('lists class spells by level', () => {
    const cantrips = content.spellsFor('wizard', 0);
    expect(cantrips.every((s) => s.level === 0 && s.classes.includes('wizard'))).toBe(true);
    expect(cantrips.map((s) => s.id)).toContain('fire-bolt');
  });
  it('lets a private pack add and override entries', () => {
    const { pack, problems } = parsePack(
      {
        id: 'phb',
        name: 'Our PHB notes',
        spells: [
          { id: 'fireball', name: 'Fireball', level: 3, classes: ['wizard'], description: 'House version' },
          { id: 'chromatic-orb', name: 'Chromatic Orb', level: 1, classes: ['sorcerer', 'wizard'], description: 'Typed in by us' },
          { id: 'broken', name: 'Broken', level: 12, classes: [] },
        ],
      },
      'file',
    );
    expect(problems).toEqual(['spells Broken: level (0-9) and classes are required.']);
    const merged = new Content([SRD, pack!]);
    expect(merged.spell('fireball')?.description).toBe('House version');
    expect(merged.spellsFor('wizard', 1).map((s) => s.id)).toContain('chromatic-orb');
    expect(merged.packOf('spells', 'chromatic-orb')?.name).toBe('Our PHB notes');
  });
});

describe('character creation', () => {
  it('accepts a complete wizard and builds the sheet', () => {
    const c = wizard();
    expect(allProblems(c, content)).toEqual([]);
    const sheet = buildCharacter(c, content, id);
    expect(sheet).toMatchObject({
      name: 'Elara',
      className: 'Wizard',
      species: 'Elf',
      subspecies: 'High Elf',
      background: 'Sage',
      level: 1,
      abilities: { str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10 },
      saveProficiencies: ['int', 'wis'],
      spellcastingAbility: 'int',
      hpMax: 8, // d6 + CON 2
      armorClass: 12,
      speed: 30,
      coins: { gp: 50 + 5 }, // background B (50) + class A (5)
    });
    expect(sheet.skillProficiencies).toEqual(expect.arrayContaining(['arcana', 'investigation', 'history']));
    const spellNames = sheet.spells!.map((s) => s.name);
    expect(spellNames).toEqual(expect.arrayContaining(['Fire Bolt', 'Magic Missile', 'Light', 'Sleep']));
    expect(sheet.inventory!.find((i) => i.ref === 'dagger')?.qty).toBe(2);
    const featureRefs = sheet.features!.map((f) => f.ref);
    expect(featureRefs).toContain('class:wizard:Spellcasting');
    expect(featureRefs).toContain('feat:magic-initiate');
    expect(featureRefs).toContain('subspecies:elf:elven-lineage-high-elf');
    for (const ref of featureRefs) expect(describeRef(content, ref!)).not.toBeNull();
    // The server accepts what the creator produces.
    expect(() => sanitizeCharacterPatch(sheet, { allowInventory: true })).not.toThrow();
  });

  it('flags missing and illegal picks per step', () => {
    const c = { ...wizard(), classSkills: ['athletics' as const], plus2: 'str' as const };
    expect(stepProblems('class', c, content)).toEqual(['Pick 2 class skills.']);
    expect(stepProblems('abilities', c, content)[0]).toMatch(/can only go to Constitution, Intelligence, Wisdom/);
    expect(stepProblems('spells', { ...c, cantrips: [] }, content)).toEqual(['Pick 3 more cantrip(s).']);
    expect(stepProblems('class', { ...c, level: 3, classSkills: ['arcana', 'history'] }, content)).toEqual(['Pick a subclass (you are level 3).']);
  });

  it('builds a human soldier fighter in chain mail', () => {
    const c: CreationChoices = {
      ...emptyChoices(),
      name: 'Bram',
      level: 3,
      classId: 'fighter',
      subclassId: 'champion',
      classSkills: ['athletics', 'perception'],
      backgroundId: 'soldier',
      speciesId: 'human',
      size: 'Medium',
      speciesSkill: 'survival',
      speciesFeat: 'alert',
      languages: ['dwarvish', 'giant'],
      abilityMethod: 'pointbuy',
      baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      bonusMode: '1-1-1',
      classEquipment: 'A',
      backgroundEquipment: 'A',
      equipmentPicks: { 'background:A:3': 'dice' },
    };
    expect(pointBuySpent(c.baseScores)).toBe(27);
    expect(allProblems(c, content)).toEqual([]);
    const sheet = buildCharacter(c, content, id);
    expect(sheet.abilities).toEqual({ str: 16, dex: 14, con: 15, int: 8, wis: 12, cha: 10 });
    expect(sheet.armorClass).toBe(16); // chain mail, no Dex
    expect(sheet.hpMax).toBe(10 + 2 + 2 * (6 + 2));
    expect(sheet.initiativeBonus).toBe(2); // Alert adds PB
    expect(sheet.subclass).toBe('Champion');
    expect(sheet.features!.some((f) => f.source.startsWith('Champion'))).toBe(true);
    expect(sheet.inventory!.map((i) => i.name)).toEqual(expect.arrayContaining(['Chain Mail', 'Greatsword', 'Dice']));
    expect(sheet.spells).toEqual([]);
    expect(sheet.spellcastingAbility).toBeNull();
  });

  it('supports homebrew class, species and background', () => {
    const c: CreationChoices = {
      ...emptyChoices(),
      name: 'Zed',
      classId: 'custom',
      customClass: { name: 'Blood Hunter', hitDie: 10, saves: ['str', 'wis'], spellAbility: null },
      classSkills: ['athletics', 'survival'],
      backgroundId: 'custom',
      customBackground: { name: 'Haunted One', abilities: ['con', 'wis', 'int'], skills: ['arcana', 'investigation'], tool: '' },
      backgroundFeat: 'savage-attacker',
      speciesId: 'custom',
      customSpecies: { name: 'Owlin', size: 'Medium', speed: 30, traits: 'Flight, darkvision' },
      languages: ['elvish', 'giant'],
      baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      plus2: 'con',
      plus1: 'wis',
    };
    expect(allProblems(c, content)).toEqual([]);
    const sheet = buildCharacter(c, content, id);
    expect(sheet).toMatchObject({ className: 'Blood Hunter', species: 'Owlin', background: 'Haunted One', hpMax: 12 });
    expect(spellAllowance(c, content)).toEqual({ cantrips: 0, prepared: 0, maxLevel: 0 });
  });
});

describe('character data', () => {
  it('keeps content refs and homebrew text', () => {
    const patch = sanitizeCharacterPatch({
      spells: [{ id: 'a', name: 'Hex Bolt', level: 1, prepared: true, description: 'Homebrew!' }],
      features: [{ id: 'f', name: 'Darkvision', source: 'Elf', ref: 'species:elf:Darkvision' }],
    });
    expect(patch.spells![0]!.description).toBe('Homebrew!');
    expect(patch.features![0]!.ref).toBe('species:elf:Darkvision');
  });
  it('fills new fields on characters saved before they existed', () => {
    const old = normalizeCharacter({ name: 'Old', level: 2 });
    expect(old.features).toEqual([]);
    expect(old.subspecies).toBe('');
  });
});

describe('weapon attacks', () => {
  it('uses Str for melee, Dex for ranged, the better for Finesse', async () => {
    const { weaponAttacks } = await import('./content/attacks.ts');
    const c = normalizeCharacter({
      className: 'Fighter',
      level: 1,
      abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 8 },
      inventory: [
        { id: 'a', name: 'Longsword', qty: 1, notes: '', ref: 'longsword' },
        { id: 'b', name: 'Longbow', qty: 1, notes: '', ref: 'longbow' },
        { id: 'c', name: 'Dagger', qty: 1, notes: '' },
        { id: 'd', name: 'Rope', qty: 1, notes: '', ref: 'rope' },
      ],
    });
    const rows = weaponAttacks(c, content);
    expect(rows.map((r) => [r.name, r.toHit, r.damage])).toEqual([
      ['Longsword', 5, '1d8+3 Slashing'],
      ['Longbow', 4, '1d8+2 Piercing'],
      ['Dagger', 5, '1d4+3 Piercing'],
    ]);
    expect(rows[0]!.notes).toContain('two-handed 1d10+3');
  });
});
