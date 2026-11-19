import type { AccountStatus, LoginResult, PublicUser } from '@dnd/shared';

const TOKEN_KEY = 'dnd.token';
const CODE_KEY = 'dnd.sessionCode';

/** localStorage can throw (private mode, blocked storage); the app still works, it just forgets. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const savedToken = () => read(TOKEN_KEY);
export const saveToken = (t: string | null) => write(TOKEN_KEY, t);
/** Code of the session this phone was last in, so it rejoins after a reload or crash. */
export const savedCode = () => read(CODE_KEY);
export const saveCode = (c: string | null) => write(CODE_KEY, c);

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export const accountStatus = (username: string) => post<AccountStatus>('/api/auth/status', { username });
export const login = (username: string, password: string) =>
  post<LoginResult>('/api/auth/login', { username, password });
export const logout = (token: string) => post('/api/auth/logout', {}, token).catch(() => undefined);

export async function me(token: string): Promise<PublicUser | null> {
  const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error('Server unavailable');
  return ((await res.json()) as { user: PublicUser }).user;
}
