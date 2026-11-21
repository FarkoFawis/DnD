/**
 * The extra content packs in server/data/content/ (or CONTENT_DIR).
 *
 *   npm run content                    check the packs and show what the book still has that we don't
 *   npm run content -- missing         the same, with every missing name
 *   npm run content -- add <file>      check a pack file (e.g. from Downloads) and put it in the folder
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Content, packWarnings, parsePack, type ContentPack } from '@dnd/shared';
import { SRD } from '@dnd/shared/srd';
import { loadContentPacks } from './content.ts';
import { phbCoverage } from './phbChecklist.ts';

const dir = process.env.CONTENT_DIR ?? fileURLToPath(new URL('../data/content', import.meta.url));
const KINDS = ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'spells', 'items'] as const;

const summary = (p: ContentPack) => KINDS.map((k) => (p[k]?.length ? `${p[k]!.length} ${k}` : '')).filter(Boolean).join(', ') || 'empty';

function printList(title: string, lines: string[]) {
  if (lines.length === 0) return;
  console.log(`\n${title}`);
  for (const l of lines) console.log(`  ${l}`);
}

function check(showNames: boolean, failOnProblems = true) {
  const { packs, problems } = loadContentPacks(dir);
  console.log(`Content folder: ${dir}`);
  if (packs.length === 0) console.log('No extra packs. Only the built-in SRD content is used.');
  const warnings: string[] = [];
  packs.forEach((p, i) => {
    console.log(`- ${p.name} (${p.id}): ${summary(p)}`);
    warnings.push(...packWarnings(p, [SRD, ...packs.slice(0, i)]).map((w) => `${p.id}: ${w}`));
  });
  printList('Problems (left out of the app):', problems);
  printList('Worth a look (loaded, but probably not what was meant):', warnings);

  console.log("\nOf the 2024 Player's Handbook, the app now has:");
  for (const c of phbCoverage(new Content([SRD, ...packs]))) {
    console.log(`  ${c.group}: ${c.total - c.missing.length} of ${c.total}`);
    if (showNames && c.missing.length) console.log(`    missing: ${c.missing.join(', ')}`);
  }
  if (!showNames) console.log('  (npm run content -- missing  lists the missing ones by name)');
  if (problems.length && failOnProblems) process.exitCode = 1;
}

function add(file: string | undefined) {
  if (!file) {
    console.error('Which file? Example:  npm run content -- add "%USERPROFILE%\\Downloads\\phb.json"');
    process.exitCode = 1;
    return;
  }
  // npm runs this inside server/, but the path was typed in the folder npm was started from.
  const from = resolve(process.env.INIT_CWD ?? process.cwd(), file);
  if (!existsSync(from)) {
    console.error(`There is no file at ${from}`);
    process.exitCode = 1;
    return;
  }
  const name = basename(from).toLowerCase().endsWith('.json') ? basename(from) : `${basename(from)}.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(from, 'utf8'));
  } catch (e) {
    console.error(`${basename(from)} is not a content pack: ${e instanceof Error ? e.message : 'it could not be read'}`);
    process.exitCode = 1;
    return;
  }
  const { pack, problems } = parsePack(raw, basename(name, '.json'));
  if (!pack || summary(pack) === 'empty') {
    console.error(`${basename(from)} has nothing the app can use. ${problems.join(' ')}`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(dir, { recursive: true });
  const to = join(dir, name);
  const replaced = existsSync(to);
  copyFileSync(from, to);
  console.log(`${replaced ? 'Replaced' : 'Added'} ${name}: ${pack.name} (${summary(pack)})`);
  console.log('A running server picks it up by itself; players see it after reloading the app.\n');
  check(false, false);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'add') add(arg);
else if (cmd === 'missing') check(true);
else if (!cmd || cmd === 'check') check(false);
else {
  console.error('Usage: npm run content [-- missing | -- add <file>]');
  process.exitCode = 1;
}
