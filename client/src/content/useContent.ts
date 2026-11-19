import { useEffect, useState } from 'react';
import { Content, type ContentPack } from '@dnd/shared';
import { savedToken } from '../api.ts';

let cached: Promise<Content> | null = null;

/** SRD (bundled, loaded on demand) + extra packs from the server. */
function loadContent(): Promise<Content> {
  cached ??= (async () => {
    const { SRD } = await import('@dnd/shared/srd');
    let extra: ContentPack[] = [];
    try {
      const token = savedToken();
      const res = await fetch('/api/content', { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (res.ok) extra = ((await res.json()) as { packs: ContentPack[] }).packs;
    } catch {
      /* offline: the SRD alone still works */
    }
    return new Content([SRD, ...extra]);
  })().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

/** The game content, or null while it loads (first time only). */
export function useContent(): Content | null {
  const [content, setContent] = useState<Content | null>(null);
  useEffect(() => {
    let alive = true;
    void loadContent().then((c) => alive && setContent(c));
    return () => {
      alive = false;
    };
  }, []);
  return content;
}
