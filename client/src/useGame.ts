import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ack, CampaignSummary, CharacterData, Item, SessionState } from '@dnd/shared';
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

  useEffect(() => {
    const s = createSocket(token);
    socketRef.current = s;
    s.on('connect', () => {
      setStatus('online');
      void refreshCampaigns();
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
    });
    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, [token, onUnauthorized, refreshCampaigns]);

  const enter = (res: Ack<{ session: SessionState }>) => {
    if (res.ok) {
      saveCode(res.session.code);
      setSession(res.session);
      setError(null);
    } else setError(res.error);
    return res.ok;
  };

  type CharAck = Ack<{ character: CharacterData }>;
  const charCall = async (fn: (s: AppSocket, done: (res: CharAck) => void) => void) => {
    const res = await call<{ character: CharacterData }>(fn);
    if (!res.ok) setError(res.error);
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
    join: async (code: string) =>
      enter(await call<{ session: SessionState }>((s, done) => s.emit('session:join', { code }, done))),
    leave: async () => {
      const res = await call<object>((s, done) => s.emit('session:leave', done));
      if (!res.ok) return setError(res.error);
      saveCode(null);
      setSession(null);
    },
    end: async () => {
      const res = await call<object>((s, done) => s.emit('session:end', done));
      if (!res.ok) return setError(res.error);
      saveCode(null);
      setSession(null);
      void refreshCampaigns();
    },
    /** Own character, or (as DM) the player with `userId`. */
    updateCharacter: async (patch: Partial<CharacterData>, userId?: string) => {
      const res = await call<{ character: CharacterData }>((s, done) =>
        s.emit('character:update', { patch, userId }, done),
      );
      if (!res.ok) setError(res.error);
      return res.ok;
    },
    /** Damage (negative) or heal (positive). Own character, or (as DM) the player with `userId`. */
    adjustHp: async (delta: number, userId?: string) => {
      const res = await call<{ character: CharacterData }>((s, done) =>
        s.emit('character:adjustHp', { delta, userId }, done),
      );
      if (!res.ok) setError(res.error);
      return res.ok;
    },
    addItem: (item: { name: string; qty?: number; notes?: string }, userId?: string) =>
      charCall((s, done) => s.emit('item:add', { item, userId }, done)),
    updateItem: (itemId: string, patch: Partial<Omit<Item, 'id'>>, userId?: string) =>
      charCall((s, done) => s.emit('item:update', { itemId, patch, userId }, done)),
    removeItem: (itemId: string, userId?: string) =>
      charCall((s, done) => s.emit('item:remove', { itemId, userId }, done)),
  };
}

export type Game = ReturnType<typeof useGame>;
