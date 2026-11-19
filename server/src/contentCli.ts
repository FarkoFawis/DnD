/**
 * Check the extra content packs in server/data/content/ (or CONTENT_DIR).
 *
 *   npm run content
 */
import { fileURLToPath } from 'node:url';
import { loadContentPacks } from './content.ts';

const dir = process.env.CONTENT_DIR ?? fileURLToPath(new URL('../data/content', import.meta.url));
const { packs, problems } = loadContentPacks(dir);
console.log(`Content folder: ${dir}`);
if (packs.length === 0) console.log('No extra packs. Only the built-in SRD content is used.');
const kinds = ['classes', 'subclasses', 'species', 'backgrounds', 'feats', 'spells', 'items'] as const;
for (const p of packs) {
  const counts = kinds.map((k) => (p[k]?.length ? `${p[k]!.length} ${k}` : '')).filter(Boolean);
  console.log(`- ${p.name} (${p.id}): ${counts.join(', ') || 'empty'}`);
}
if (problems.length) {
  console.log('\nProblems (these entries are skipped):');
  for (const pr of problems) console.log(`  ${pr}`);
  process.exitCode = 1;
}
