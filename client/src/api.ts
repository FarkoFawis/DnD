import type { AccountStatus, ImportSummary, LoginResult, PublicUser } from '@dnd/shared';

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

// ---------- character portraits ----------

/** Where a character's uploaded portrait lives. `version` is CharacterData.portrait ("" = none). */
export const portraitUrl = (characterId: string, version: string) =>
  version ? `/api/portraits/${characterId}?v=${encodeURIComponent(version)}` : null;

async function portraitCall(characterId: string, init: RequestInit): Promise<void> {
  const res = await fetch(`/api/characters/${characterId}/portrait`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${savedToken() ?? ''}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? (res.status === 413 ? 'That picture is too large.' : 'Could not save the picture.'));
  }
}

export const uploadPortrait = (characterId: string, image: Blob) =>
  portraitCall(characterId, { method: 'PUT', headers: { 'content-type': image.type }, body: image });
export const removePortrait = (characterId: string) => portraitCall(characterId, { method: 'DELETE' });

// ---------- campaign backup ----------

/** Fetches the campaign's backup file and hands it to the browser to save. Returns the file name. */
export async function downloadBackup(campaignId: string): Promise<string> {
  const res = await fetch(`/api/campaigns/${campaignId}/export`, { headers: { authorization: `Bearer ${savedToken() ?? ''}` } });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? 'Could not make the backup.');
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'campaign.dnd-backup.json';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return name;
}

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  /** `missingPlayers`: these players have no account here; ask whether to load the file without their characters. */
  | { ok: false; error: string; missingPlayers?: string[] };

/** Loads a backup file as a new campaign of the logged-in user. */
export async function uploadBackup(file: Blob, skipMissing = false): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(`/api/campaigns/import${skipMissing ? '?skipMissing=1' : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${savedToken() ?? ''}` },
      body: file,
    });
  } catch {
    return { ok: false, error: 'Not connected. Check your internet.' };
  }
  const data = (await res.json().catch(() => ({}))) as { summary?: ImportSummary; error?: string; missingPlayers?: string[] };
  if (res.ok && data.summary) return { ok: true, summary: data.summary };
  return { ok: false, error: data.error ?? 'That file could not be loaded.', missingPlayers: data.missingPlayers };
}
