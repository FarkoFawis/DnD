/**
 * Socket.IO contract shared by client and server.
 * Add new events here first, then implement them on both sides.
 */

export type Role = 'dm' | 'player';

export interface Member {
  id: string;
  name: string;
  role: Role;
  online: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  members: Member[];
}

/** What a client keeps in localStorage to get back into its room. */
export interface Session {
  code: string;
  memberId: string;
  token: string;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface JoinedPayload {
  session: Session;
  room: RoomState;
}

export interface ClientToServerEvents {
  /** DM creates a new room and becomes its DM. */
  'room:create': (
    input: { roomName: string; dmName: string },
    ack: (res: Ack<JoinedPayload>) => void,
  ) => void;
  /** Player joins an existing room by its code. */
  'room:join': (
    input: { code: string; playerName: string },
    ack: (res: Ack<JoinedPayload>) => void,
  ) => void;
  /** Re-enter a room after a reload, crash, or dropped connection. */
  'room:resume': (input: Session, ack: (res: Ack<JoinedPayload>) => void) => void;
  /** Leave the room for good (the member is removed). */
  'room:leave': (ack: (res: Ack<object>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomState) => void;
}

export const LIMITS = {
  nameMaxLength: 40,
  roomNameMaxLength: 60,
} as const;
