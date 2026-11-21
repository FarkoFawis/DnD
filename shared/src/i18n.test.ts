import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { Content } from './content/index.ts';
import { SRD } from './content/srd.ts';
import { describeRoll, planRoll, rollPlan, type RollMode, type RollRequest } from './dice.ts';
import { languageFor, listing, ordinal, plural, ruleText, setLanguage, t, toEnglish, tx } from './i18n.ts';
import { DE } from './i18n/de.ts';
import { describeLogEntry, type LogEvent } from './log.ts';
import { DEFAULT_CHARACTER, type CharacterData } from './protocol.ts';
import { applyUse } from './resources.ts';
import { ABILITY_NAMES, SKILLS } from './rules.ts';

afterEach(() => setLanguage('en'));

const content = new Content([SRD]);
const srd = { classes: SRD.classes ?? [], subclasses: SRD.subclasses ?? [], species: SRD.species ?? [], backgrounds: SRD.backgrounds ?? [], feats: SRD.feats ?? [], languages: SRD.languages ?? [], conditions: SRD.conditions ?? [], spells: SRD.spells ?? [], items: SRD.items ?? [] };

/** The same thing said in both languages. */
function both<T>(make: () => T): { en: T; de: T } {
  setLanguage('en');
  const en = make();
  setLanguage('de');
  const de = make();
  return { en, de };
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

// ---------- every text in the code has its German ----------

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'i18n' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

interface Found {
  text: string;
  at: string;
}

/** The texts handed to t(), tj(), msg() and plural(), and what the server answers as `error`. */
function textsInTheCode(): Found[] {
  const found: Found[] = [];
  for (const dir of ['client/src', 'shared/src', 'server/src']) {
    for (const file of sources(join(ROOT, dir))) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const add = (node: ts.Node) => {
        if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return;
        found.push({ text: node.text, at: `${file.slice(ROOT.length)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}` });
      };
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const fn = node.expression.text;
          if (fn === 't' || fn === 'tj' || fn === 'msg') node.arguments.slice(0, 1).forEach(add);
          if (fn === 'plural') node.arguments.slice(1, 3).forEach(add);
        }
        if (dir === 'server/src') {
          if (ts.isPropertyAssignment(node) && node.name.getText() === 'error') add(node.initializer);
          if (ts.isNewExpression(node) && node.expression.getText() === 'Error') node.arguments?.slice(0, 1).forEach(add);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return found;
}

describe('the German dictionary', () => {
  it('has every text that the code shows', () => {
    const found = textsInTheCode();
    expect(found.length).toBeGreaterThan(900);
    const missing = found.filter((f) => DE[f.text] === undefined).map((f) => `${f.at}  ${JSON.stringify(f.text)}`);
    expect(missing).toEqual([]);
  });

  it('keeps the {placeholders} of every text', () => {
    const wrong = Object.entries(DE).filter(([key, de]) => !key.startsWith('condition:') && placeholders(key) !== placeholders(de));
    expect(wrong).toEqual([]);
  });

  it('has no empty text, and knows the words that are looked up by name', () => {
    expect(Object.entries(DE).filter(([, de]) => !de.trim())).toEqual([]);
    const names = [
      ...Object.values(ABILITY_NAMES),
      ...Object.values(SKILLS).map((s) => s.name),
      ...['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'cp', 'sp', 'ep', 'gp', 'pp', 'advantage', 'disadvantage', 'HP'],
      ...srd.classes.map((c) => c.name),
      ...srd.subclasses.map((s) => s.name),
      ...srd.species.map((s) => s.name),
      ...srd.species.map((s) => s.size),
      ...srd.species.flatMap((s) => (s.subspecies ? [s.subspecies.label] : [])),
      ...srd.backgrounds.map((b) => b.name),
      ...srd.conditions.map((c) => c.name),
      ...srd.conditions.map((c) => `condition:${c.id}`),
      ...srd.languages.map((l) => `${l.name}##language`),
      ...srd.spells.map((s) => s.school),
      ...srd.spells.map((s) => s.school.toLowerCase()),
      ...srd.classes.map((c) => c.primaryAbility),
      ...srd.classes.flatMap((c) => c.proficiencies),
    ];
    expect([...new Set(names)].filter((n) => DE[n] === undefined)).toEqual([]);
  });
});

// ---------- t() ----------

describe('t()', () => {
  it('is the English text until a language is chosen', () => {
    expect(t('Join a session')).toBe('Join a session');
    expect(t('{who} took {n} damage.', { who: 'Alba', n: 5 })).toBe('Alba took 5 damage.');
    expect(t('Light##theme')).toBe('Light');
    expect(plural(1, '{n} round', '{n} rounds')).toBe('1 round');
    expect(plural(3, '{n} round', '{n} rounds')).toBe('3 rounds');
    expect(ordinal(2)).toBe('2nd');
    expect(listing(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('speaks German when asked to', () => {
    setLanguage('de');
    expect(t('Join a session')).toBe('Einer Sitzung beitreten');
    expect(t('{who} took {n} damage.', { who: 'Alba', n: 5 })).toBe('Alba hat 5 Schaden erlitten.');
    expect(t('Light##theme')).toBe('Hell');
    expect(t('Level {n}', { n: 3 })).toBe('Stufe 3');
    expect(t('Level {n}##spell', { n: 3 })).toBe('Grad 3');
    expect(plural(1, '{n} round', '{n} rounds')).toBe('1 Runde');
    expect(plural(3, '{n} round', '{n} rounds')).toBe('3 Runden');
    expect(ordinal(2)).toBe('2.');
    expect(listing(['a', 'b', 'c'])).toBe('a, b und c');
    expect(t('A text nobody translated')).toBe('A text nobody translated');
  });

  it('has the conditions texts in German and falls back to the English of the content', () => {
    const blinded = srd.conditions.find((c) => c.id === 'blinded')!;
    expect(ruleText('condition:blinded', blinded.description)).toBe(blinded.description);
    setLanguage('de');
    expect(ruleText('condition:blinded', blinded.description)).toContain('Angriffswürfe gegen dich haben Vorteil');
    expect(ruleText('condition:homebrew', 'You glow.')).toBe('You glow.');
  });

  it('takes the language of the phone, English for what it has no texts for', () => {
    expect(languageFor('de-AT')).toBe('de');
    expect(languageFor('en-GB')).toBe('en');
    expect(languageFor('fr')).toBe('en');
    expect(languageFor(undefined)).toBe('en');
  });
});

// ---------- tx(): what the server wrote in English ----------

const hero: CharacterData = {
  ...structuredClone(DEFAULT_CHARACTER),
  name: 'Alba',
  className: 'Wizard',
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 16, wis: 12, cha: 8 },
  spellcastingAbility: 'int',
  saveProficiencies: ['int', 'wis'],
  skillProficiencies: ['arcana', 'stealth'],
  exhaustion: 1,
  inventory: [{ id: 'sword', name: 'Longsword', qty: 1, notes: '', ref: 'longsword' }],
  spells: [
    { id: 'bolt', name: 'Fire Bolt', level: 0, prepared: true, ref: 'fire-bolt' },
    { id: 'missile', name: 'Magic Missile', level: 1, prepared: true, ref: 'magic-missile' },
  ],
};

describe('tx()', () => {
  it('leaves everything alone in English', () => {
    expect(tx('Only the DM can change that.')).toBe('Only the DM can change that.');
    expect(tx('Stealth check: 19 (14 + 5)')).toBe('Stealth check: 19 (14 + 5)');
  });

  it('translates what the server answers', () => {
    setLanguage('de');
    expect(tx('Only the DM can change that.')).toBe('Das kann nur die SL ändern.');
    expect(tx('Choose a password with at least 8 characters.')).toBe('Wähle ein Passwort mit mindestens 8 Zeichen.');
    expect(tx('No uses of Second Wind left. It comes back after a Short or Long Rest.')).toBe('Second Wind: keine Anwendungen mehr übrig. Kommt nach einer Kurzen oder Langen Rast zurück.');
    expect(tx('No spell slots of level 3 or higher left.')).toBe('Keine Zauberplätze von Grad 3 oder höher übrig.');
    expect(tx('The STR score must be a whole number from 1 to 30.')).toBe('STÄ-Wert: Das muss eine ganze Zahl von 1 bis 30 sein.');
    expect(tx('Strength can\'t go above 20.')).toBe('Stärke kann nicht über 20 steigen.');
    expect(tx('Pick 2 more cantrips.')).toBe('Wähle noch 2 Zaubertricks.');
    expect(tx('The backup could not be loaded: disk full')).toBe('Das Backup konnte nicht geladen werden: disk full');
  });

  it('reads a roll the way the phone would have written it itself', () => {
    const rolls: Array<[RollRequest, RollMode, number[]]> = [
      [{ kind: 'skill', skill: 'stealth' }, 'normal', [14]],
      [{ kind: 'skill', skill: 'arcana' }, 'advantage', [7, 15]],
      [{ kind: 'save', ability: 'wis' }, 'disadvantage', [20, 3]],
      [{ kind: 'ability', ability: 'str' }, 'normal', [1]],
      [{ kind: 'initiative' }, 'normal', [20]],
      [{ kind: 'attack', itemId: 'sword' }, 'normal', [20]],
      [{ kind: 'attack', itemId: 'sword' }, 'advantage', [1, 1]],
      [{ kind: 'damage', itemId: 'sword', crit: false, twoHanded: false }, 'normal', [6]],
      [{ kind: 'damage', itemId: 'sword', crit: true, twoHanded: true }, 'normal', [6, 9]],
      [{ kind: 'spellAttack' }, 'normal', [12]],
    ];
    for (const [request, mode, values] of rolls) {
      const line = both(() => {
        const left = [...values];
        return describeRoll(rollPlan(planRoll(hero, request, content), mode, () => left.shift()!));
      });
      setLanguage('de');
      expect(tx(line.en)).toBe(line.de);
      expect(line.de).not.toBe(line.en);
    }
    setLanguage('de');
    expect(tx('Stealth check: 19 (14 + 5)')).toBe('Wurf auf Heimlichkeit: 19 (14 + 5)');
    expect(tx('Longsword damage: 9 slashing (6 + 3)')).toBe('Schaden: Longsword: 9 Hiebschaden (6 + 3)');
  });

  it('reads what a character did last and what the log kept', () => {
    setLanguage('en');
    const cantrip = applyUse(hero, { kind: 'spell', spellId: 'bolt' }).action;
    const slot = applyUse(hero, { kind: 'spell', spellId: 'missile' }).action;
    setLanguage('de');
    expect(tx(cantrip.detail!)).toBe('Zaubertrick');
    expect(tx(slot.detail!)).toBe('Zauberplatz des 1. Grades');
    expect(tx(`${slot.name} (${slot.detail})`)).toBe('Magic Missile (Zauberplatz des 1. Grades)');
    expect(tx('Hit Die')).toBe('Trefferwürfel');
    expect(tx('+7 HP')).toBe('+7 TP');
    expect(tx('19 · natural 20')).toBe('19 · natürliche 20');
    expect(tx('9 slashing')).toBe('9 Hiebschaden');
    expect(tx('rolled a 20 (back up with 1 HP)')).toBe('eine 20 gewürfelt (mit 1 TP wieder auf den Beinen)');

    const log = (e: Partial<LogEvent>) => describeLogEntry({ kind: 'used', who: 'Alba', ...e } as LogEvent);
    expect(log({ kind: 'heal', amount: 7, what: 'Hit Die, 12/20 HP' })).toBe('Alba hat 7 TP zurückerhalten (Trefferwürfel, 12/20 TP).');
    expect(log({ kind: 'loot', what: '5 gp, 3 sp' })).toBe('Alba hat 5 GM, 3 SM bekommen.');
    expect(log({ kind: 'loot', what: '2× Rope' })).toBe('Alba hat 2× Rope bekommen.');
    expect(log({ kind: 'used', what: 'Fire Bolt (cantrip)' })).toBe('Alba hat Fire Bolt (Zaubertrick) eingesetzt.');
    expect(log({ kind: 'fight', who: '', what: '2× Goblin, Wizard' })).toBe('Ein Kampf gegen 2× Goblin, Wizard ist ausgebrochen.');
    expect(log({ kind: 'rest', who: '', what: 'long' })).toBe('Die Gruppe hat eine Lange Rast gemacht.');
  });

  it('knows the words of the rulebook, and where a feature comes from', () => {
    setLanguage('de');
    expect(tx('Wizard')).toBe('Magier');
    expect(tx('Circle of the Land')).toBe('Zirkel des Landes');
    expect(tx('Small or Medium')).toBe('Klein oder Mittelgroß');
    expect(tx('Barbarian 3')).toBe('Barbar 3');
    expect(tx('Feat, level 4 (+1 Strength, +1 Dexterity)')).toBe('Talent, Stufe 4 (+1 Stärke, +1 Geschicklichkeit)');
    expect(tx('60 feet')).toBe('60 Fuß');
    expect(tx('up to 10 minutes')).toBe('bis zu 10 Minuten');
    expect(tx('10 GP')).toBe('10 GM');
    expect(tx('Martial Melee Weapon')).toBe('Kriegsnahkampfwaffe');
  });

  it('never bends a name: spells, items, feats and features come through as they are', () => {
    setLanguage('de');
    const names = [
      ...srd.spells.map((s) => s.name),
      ...srd.items.map((i) => i.name),
      ...srd.feats.map((f) => f.name),
      ...srd.classes.flatMap((c) => c.features.map((f) => f.name)),
      ...srd.subclasses.flatMap((s) => s.features.map((f) => f.name)),
      ...srd.species.flatMap((s) => s.traits.map((x) => x.name)),
      ...srd.species.flatMap((s) => s.subspecies?.options.map((o) => o.name) ?? []),
      ...['Elara Moonwhisper', 'Goblin', 'Goblin 2', 'Mayor Aldric', 'Thorin', 'Raise Dead', 'Remove Curse', 'Hunter Greenleaf', 'Poison, Basic', 'Armor, +1', 'Lay on Hands'],
    ];
    const bent = [...new Set(names)].filter((name) => tx(name) !== name && tx(name) !== DE[name]);
    expect(bent).toEqual([]);
  });
});

describe('toEnglish()', () => {
  it('turns a typed German class, species or background back into the name the rules know', () => {
    expect(toEnglish('Magier')).toBe('Magier');
    setLanguage('de');
    expect(toEnglish('Magier')).toBe('Wizard');
    expect(toEnglish(' waldläufer ')).toBe('Ranger');
    expect(toEnglish('Zwerg')).toBe('Dwarf');
    expect(toEnglish('Weiser')).toBe('Sage');
    expect(toEnglish('Wizard')).toBe('Wizard');
    expect(toEnglish('Blutjäger')).toBe('Blutjäger');
  });
});
