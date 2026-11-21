import { useCallback, useEffect, useState } from 'react';
import type { CampaignPrep, Handout, Npc } from '@dnd/shared';
import type { Game } from '../useGame.ts';
import { t } from '../i18n.tsx';

/** A campaign's handouts and NPCs, with save/delete. Only works for the campaign's DM. */
export function usePrep(game: Game, campaignId: string) {
  const { call, status } = game;
  const [prep, setPrep] = useState<CampaignPrep | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await call<{ prep: CampaignPrep }>((s, done) => s.emit('prep:get', { campaignId }, done));
    if (res.ok) setPrep(res.prep);
    else setError(res.error);
  }, [call, campaignId]);

  useEffect(() => {
    if (status === 'online') void reload();
  }, [status, reload]);

  /** Runs a change, then reloads. Returns whether it worked. */
  const change = async (run: () => Promise<{ ok: boolean; error?: string }>) => {
    const res = await run();
    setError(res.ok ? null : (res.error ?? t('Something went wrong.')));
    if (res.ok) await reload();
    return res.ok;
  };

  return {
    prep,
    error,
    setError,
    reload,
    saveHandout: (handout: Partial<Handout>) =>
      change(() => call<{ handout: Handout }>((s, done) => s.emit('handout:save', { campaignId, handout }, done))),
    deleteHandout: (handoutId: string) =>
      change(() => call<object>((s, done) => s.emit('handout:delete', { campaignId, handoutId }, done))),
    saveNpc: (npc: Partial<Npc>) =>
      change(() => call<{ npc: Npc }>((s, done) => s.emit('npc:save', { campaignId, npc }, done))),
    deleteNpc: (npcId: string) =>
      change(() => call<object>((s, done) => s.emit('npc:delete', { campaignId, npcId }, done))),
  };
}

export type Prep = ReturnType<typeof usePrep>;
