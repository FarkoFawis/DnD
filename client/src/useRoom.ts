import { useCallback, useEffect, useState } from 'react';
import type { Ack, JoinedPayload, RoomState, Session } from '@dnd/shared';
import { loadSession, saveSession, socket } from './socket.ts';

export type Status = 'connecting' | 'online' | 'offline';

/**
 * Connection + room state. On every (re)connect it resumes the saved session,
 * so a locked phone, reload, or crashed browser drops you straight back in.
 */
export function useRoom() {
  const [status, setStatus] = useState<Status>(socket.connected ? 'online' : 'connecting');
  const [session, setSession] = useState<Session | null>(loadSession);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyJoined = useCallback((res: Ack<JoinedPayload>) => {
    if (res.ok) {
      saveSession(res.session);
      setSession(res.session);
      setRoom(res.room);
      setError(null);
    } else {
      setError(res.error);
    }
    return res.ok;
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setStatus('online');
      const saved = loadSession();
      if (saved) {
        socket.emit('room:resume', saved, (res) => {
          if (!res.ok) {
            saveSession(null);
            setSession(null);
            setRoom(null);
          }
          applyJoined(res);
        });
      }
    };
    const onDisconnect = () => setStatus('offline');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', setRoom);
    if (socket.connected) onConnect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', setRoom);
    };
  }, [applyJoined]);

  const createRoom = (roomName: string, dmName: string) =>
    new Promise<boolean>((resolve) =>
      socket.emit('room:create', { roomName, dmName }, (res) => resolve(applyJoined(res))),
    );

  const joinRoom = (code: string, playerName: string) =>
    new Promise<boolean>((resolve) =>
      socket.emit('room:join', { code, playerName }, (res) => resolve(applyJoined(res))),
    );

  const leaveRoom = () =>
    new Promise<void>((resolve) =>
      socket.emit('room:leave', (res) => {
        if (res.ok) {
          saveSession(null);
          setSession(null);
          setRoom(null);
        } else {
          setError(res.error);
        }
        resolve();
      }),
    );

  return { status, session, room, error, setError, createRoom, joinRoom, leaveRoom };
}
