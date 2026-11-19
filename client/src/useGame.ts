import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack, CampaignSummary, CharacterData, CharacterSummary, Item, DeathSaveResult, LevelUpChoices, SessionState, UseRequest } from '@dnd/shared';
import { saveCode, savedCode } from './api.ts';
import { createSocket, type AppSocket } from './socket.ts';

export type Status = 'connecting' | 'online' | 'offline';

/**
 * Socket connection, campaigns and the live session for a logged-in user.
 * On every (re)connect it rejoins the saved session, so a locked phone,
 * reload or crash drops you straight back in.
 */
export function useGame(token: string, onUnauthorized: () => void) {
  const socketRef = useRef<AppSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [session, setSession] = useState<SessionState | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [characters, setCharacters] = useState<CharacterSummary[] | null>(null);
  const [rejoining, setRejoining] = useState(() => savedCode() !== null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(<T,>(fn: (s: AppSocket, done: (res: Ack<T>) => void) => void) => {
    return new Promise<Ack<T>>((resolve) => {
      const s = socketRef.current;
      if (!s?.connected) return resolve({ ok: false, error: 'Not connected. Check your internet.' });
      fn(s, resolve);
    });
  }, []);

  const refreshCampaigns = useCallback(async () => {
    const res = await call<{ campaigns: CampaignSummary[] }>((s, done) => s.emit('campaign:list', done));
    if (res.ok) setCampaigns(res.campaigns);
  }, [call]);

  const refreshCharacters = useCallback(async () => {
    const res = await call<{ characters: CharacterSummary[] }>((s, done) => s.emit('character:list', done));
    if (res.ok) setCharacters(res.characters);
  }, [call]);

  useEffect(() => {
    const s = createSocket(token);
    socketRef.current = s;
    s.on('connect', () => {
      setStatus('online');
      void refreshCampaigns();
      void refreshCharacters();
      const code = savedCode();
      if (!code) return setRejoining(false);
      s.emit('session:join', { code }, (res) => {
        if (res.ok) setSession(res.session);
        else {
          saveCode(null);
          setSession(null);
        }
        setRejoining(false);
      });
    });
    s.on('disconnect', () => setStatus('offline'));
    s.on('connect_error', (err) => {
      setStatus('offline');
      if (err.message === 'unauthorized') onUnauthorized();
    });
    s.on('session:state', setSession);
    s.on('session:ended', () => {
      saveCode(null);
      setSession(null);
      setError('The DM ended the session. Your character is saved.');
      void refreshCharacters();
    });
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [token, onUnauthorized, refreshCampaigns, refreshCharacters]);

  const enter = (res: Ack<{ session: SessionState }>) => {
    if (res.ok) {
      saveCode(res.session.code);
      setSession(res.session);
      setError(null);
      void refreshCharacters();
    } else setError(res.error);
    return res.ok;
  };

  type CharAck = Ack<{ character: CharacterSummary }>;
  /** Character edits: on success, keep the local character list in sync. */
  const charCall = async (fn: (s: AppSocket, done: (res: CharAck) => void) => void) => {
    const res = await call<{ character: CharacterSummary }>(fn);
    if (!res.ok) setError(res.error);
    else setCharacters((list) => list && list.map((c) => (c.id === res.character.id ? res.character : c)));
    return res.ok;
  };

  return {
    status,
    session,
    campaigns,
    rejoining,
    error,
    setError,
    refreshCampaigns,
    createCampaign: async (name: string) => {
      const res = await call<{ campaign: CampaignSummary }>((s, done) => s.emit('campaign:create', { name }, done));
      if (!res.ok) setError(res.error);
      await refreshCampaigns();
      return res.ok;
    },
    host: async (campaignId: string) =>
      enter(await call<{ session: SessionState }>((s, done) => s.emit('session:host', { campaignId }, done))),
    join: async (code: string, characterId?: string) =>
      enter(await call<{ session: SessionState }>((s, done) => s.emit('session:join', { code, characterId }, done))),
    leave: async () => {
      const res = await call<object>((s, done) => s.emit('session:leave', done));
      if (!res.ok) return setError(res.error);
      saveCode(null);
      setSession(null);
      void refreshCharacters();
    },
    end: async () => {
      const res = await call<object>((s, done) => s.emit('session:end', done));
      if (!res.ok) return setError(res.error);
      saveCode(null);
      setSession(null);
      void refreshCampaigns();
    },
    updateCharacter: (characterId: string, patch: Partial<CharacterData>) =>
      charCall((s, done) => s.emit('character:update', { characterId, patch }, done)),
    /** Damage (negative) or heal (positive). */
    adjustHp: (characterId: string, delta: number) =>
      charCall((s, done) => s.emit('character:adjustHp', { characterId, delta }, done)),
    addItem: (characterId: string, item: { name: string; qty?: number; notes?: string; ref?: string }) =>
      charCall((s, done) => s.emit('item:add', { characterId, item }, done)),
    updateItem: (characterId: string, itemId: string, patch: Partial<Omit<Item, 'id'>>) =>
      charCall((s, done) => s.emit('item:update', { characterId, itemId, patch }, done)),
    removeItem: (characterId: string, itemId: string) =>
      charCall((s, done) => s.emit('item:remove', { characterId, itemId }, done)),
    /** Cast a spell, use a limited feature or attack; spends a slot or use. */
    use: (characterId: string, use: UseRequest) =>
      charCall((s, done) => s.emit('character:use', { characterId, use }, done)),
    concentration: (characterId: string, action: 'end' | 'kept') =>
      charCall((s, done) => s.emit('character:concentration', { characterId, action }, done)),
    deathSave: (characterId: string, result: DeathSaveResult) =>
      charCall((s, done) => s.emit('character:deathSave', { characterId, result }, done)),
    levelUp: (characterId: string, choices: LevelUpChoices) =>
      charCall((s, done) => s.emit('character:levelUp', { characterId, choices }, done)),
    /** Give back one spent slot or use. */
    restore: (characterId: string, id: string) =>
      charCall((s, done) => s.emit('character:restore', { characterId, id }, done)),
    rest: (characterId: string, kind: 'short' | 'long') =>
      charCall((s, done) => s.emit('character:rest', { characterId, kind }, done)),
    /** DM: the whole party rests. */
    partyRest: async (kind: 'short' | 'long') => {
      const res = await call<object>((s, done) => s.emit('session:rest', { kind }, done));
      if (!res.ok) setError(res.error);
      return res.ok;
    },

    characters,
    refreshCharacters,
    /** `data`: optional starting values, e.g. from a character creator. */
    createCharacter: async (name: string, data?: Partial<CharacterData>): Promise<CharacterSummary | null> => {
      const res = await call<{ character: CharacterSummary }>((s, done) =>
        s.emit('character:create', { name, data }, done),
      );
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      setCharacters((list) => [...(list ?? []), res.character]);
      return res.character;
    },
    deleteCharacter: async (characterId: string) => {
      const res = await call<object>((s, done) => s.emit('character:delete', { characterId }, done));
      if (!res.ok) setError(res.error);
      else setCharacters((list) => list && list.filter((c) => c.id !== characterId));
      return res.ok;
    },

    peek: (code: string) =>
      call<{ campaign: { id: string; name: string }; rejoin: boolean; characters: CharacterSummary[] }>((s, done) =>
        s.emit('session:peek', { code }, done),
      ),
    setReady: async (ready: boolean) => {
      const res = await call<object>((s, done) => s.emit('session:ready', { ready }, done));
      if (!res.ok) setError(res.error);
    },
    start: async () => {
      const res = await call<object>((s, done) => s.emit('session:start', done));
      if (!res.ok) setError(res.error);
    },
  };
}

export type Game = ReturnType<typeof useGame>;
