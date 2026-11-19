/**
 * Extra content packs (homebrew, or entries typed in from the group's own
 * Player's Handbook) live as JSON files in server/data/content/. That folder
 * is git-ignored, so nothing in it is ever published with the code.
 * The format is described in docs/content-packs.md.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parsePack, type ContentPack } from '@dnd/shared';

export interface LoadedPacks {
  packs: ContentPack[];
  problems: string[];
}

/** Reads every *.json pack in the folder, in file-name order (later files win). */
export function loadContentPacks(dir: string): LoadedPacks {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  } catch {
    return { packs: [], problems: [] }; // no folder yet = no extra content
  }
  const packs: ContentPack[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const result = parsePack(raw, basename(file, '.json'));
      problems.push(...result.problems.map((p) => `${file}: ${p}`));
      if (result.pack) packs.push(result.pack);
    } catch (e) {
      problems.push(`${file}: ${e instanceof Error ? e.message : 'could not be read'}`);
    }
  }
  return { packs, problems };
}
