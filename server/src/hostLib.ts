/**
 * The parts of `npm run host` (host.ts) that decide things without touching the
 * machine: reading the settings file, what to tell cloudflared, what the
 * Windows auto-start file says. Kept apart so they can be tested.
 */
import { win32 } from 'node:path';

export type TunnelMode = 'quick' | 'named' | 'off';

export interface HostConfig {
  /** Port of the app on this PC. */
  port: number;
  /** Friends need it once, when they choose their password. Empty = no code (only sensible without a tunnel). */
  inviteCode: string;
  /**
   * quick = a free Cloudflare address that changes on every start, no account;
   * named = your own Cloudflare tunnel with a fixed address (needs a domain);
   * off   = no tunnel from here (home Wi-Fi only, or a tunnel you run yourself).
   */
  tunnel: TunnelMode;
  /** named: the name given to `cloudflared tunnel create`. */
  tunnelName: string;
  /** named: the fixed address, e.g. https://dnd.example.com. With tunnel "off": shown as the address if you bring your own. */
  address: string;
  /** Windows: keep the PC from going to sleep while the server runs. */
  keepAwake: boolean;
}

export const DEFAULT_HOST_CONFIG: HostConfig = {
  port: 3001,
  inviteCode: '',
  tunnel: 'quick',
  tunnelName: '',
  address: '',
  keepAwake: true,
};

const TUNNEL_MODES: readonly TunnelMode[] = ['quick', 'named', 'off'];

/** The settings file is edited by hand in Notepad: take what is usable, say what is not. */
export function readHostConfig(raw: unknown): { config: HostConfig; problems: string[] } {
  const config: HostConfig = { ...DEFAULT_HOST_CONFIG };
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { config, problems: ['The settings file does not hold settings. The defaults are used.'] };
  }
  const input = raw as Record<string, unknown>;

  if (input.port !== undefined) {
    const port = Number(input.port);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) config.port = port;
    else problems.push(`"port" must be a number from 1 to 65535. Using ${config.port}.`);
  }
  if (input.inviteCode !== undefined) {
    if (typeof input.inviteCode === 'string') config.inviteCode = input.inviteCode.trim();
    else problems.push('"inviteCode" must be text in quotes.');
  }
  if (input.tunnel !== undefined) {
    const mode = typeof input.tunnel === 'string' ? (input.tunnel.trim().toLowerCase() as TunnelMode) : undefined;
    if (mode && TUNNEL_MODES.includes(mode)) config.tunnel = mode;
    else problems.push(`"tunnel" must be "quick", "named" or "off". Using "${config.tunnel}".`);
  }
  if (input.tunnelName !== undefined) {
    if (typeof input.tunnelName === 'string') config.tunnelName = input.tunnelName.trim();
    else problems.push('"tunnelName" must be text in quotes.');
  }
  if (input.address !== undefined) {
    const address = typeof input.address === 'string' ? normalizeAddress(input.address) : null;
    if (address !== null) config.address = address;
    else problems.push('"address" must look like "https://dnd.example.com".');
  }
  if (input.keepAwake !== undefined) {
    if (typeof input.keepAwake === 'boolean') config.keepAwake = input.keepAwake;
    else problems.push('"keepAwake" must be true or false (without quotes).');
  }

  if (config.tunnel === 'named') {
    const missing = [!config.tunnelName && '"tunnelName"', !config.address && '"address"'].filter(Boolean);
    if (missing.length > 0) {
      problems.push(
        `"tunnel" is "named", but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing. ` +
          'Using a quick tunnel until that is filled in.',
      );
      config.tunnel = 'quick';
    }
  }
  return { config, problems };
}

/** "dnd.example.com/" -> "https://dnd.example.com". Empty stays empty; null = not an address. */
export function normalizeAddress(value: string): string | null {
  const text = value.trim();
  if (text === '') return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!url.hostname.includes('.')) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

const CODE_WORDS = [
  'amber', 'anvil', 'arrow', 'badger', 'banner', 'barrel', 'beacon', 'bramble', 'bronze', 'candle',
  'cellar', 'cinder', 'cobble', 'copper', 'dagger', 'ember', 'falcon', 'fiddle', 'forest', 'gargoyle',
  'goblet', 'granite', 'griffon', 'harbor', 'hazel', 'heron', 'ivory', 'juniper', 'kettle', 'lantern',
  'ledger', 'lichen', 'marble', 'meadow', 'mirror', 'mortar', 'nettle', 'onyx', 'otter', 'parchment',
  'pebble', 'pepper', 'quartz', 'quiver', 'raven', 'river', 'saddle', 'satchel', 'shovel', 'silver',
  'sparrow', 'thimble', 'thistle', 'timber', 'tinder', 'tower', 'turnip', 'velvet', 'walnut', 'willow',
  'winter', 'wizard', 'wyvern', 'yarrow',
] as const;

/** Something that can be read out across a table, like "raven-kettle-thistle-47". */
export function newInviteCode(randomInt: (max: number) => number): string {
  const words = Array.from({ length: 3 }, () => CODE_WORDS[randomInt(CODE_WORDS.length)]);
  return `${words.join('-')}-${10 + randomInt(90)}`;
}

/** cloudflared announces a quick tunnel's address somewhere in its log lines. */
export function findQuickTunnelUrl(text: string): string | null {
  // api.trycloudflare.com is where cloudflared asks for the tunnel, not the tunnel itself.
  for (const match of text.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi)) {
    if (match[1]!.toLowerCase() !== 'api') return match[0].toLowerCase();
  }
  return null;
}

/** A named tunnel is connected once cloudflared has registered a connection with Cloudflare. */
export function tunnelIsConnected(text: string): boolean {
  return /Registered tunnel connection/i.test(text);
}

/**
 * The config file handed to cloudflared for a named tunnel. It lives with the
 * app's data, so nothing in the user's own .cloudflared folder is touched.
 */
export function namedTunnelConfig(tunnelName: string, address: string, port: number): string {
  const hostname = new URL(address).hostname;
  return [
    '# Written by "npm run host" on every start. Change server/data/host.json instead.',
    `tunnel: ${JSON.stringify(tunnelName)}`,
    'ingress:',
    `  - hostname: ${JSON.stringify(hostname)}`,
    `    service: http://localhost:${port}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

export function cloudflaredArgs(config: HostConfig, configFile: string): string[] {
  return config.tunnel === 'named'
    ? ['tunnel', '--no-autoupdate', '--config', configFile, 'run', config.tunnelName]
    : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`];
}

/** Where cloudflared.exe ends up on Windows when PATH has not caught up yet (a terminal opened before the install). */
export function cloudflaredCandidates(env: Record<string, string | undefined>, platform: string): string[] {
  if (platform !== 'win32') return [];
  const folders = [
    env['ProgramFiles(x86)'] && win32.join(env['ProgramFiles(x86)'], 'cloudflared'),
    env.ProgramFiles && win32.join(env.ProgramFiles, 'cloudflared'),
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
  ];
  return folders.filter((f): f is string => Boolean(f)).map((f) => win32.join(f, 'cloudflared.exe'));
}

/** Waiting time before a crashed part is started again: 2 s, 4 s, 8 s ... at most 60 s. */
export function restartDelayMs(failuresInARow: number): number {
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, failuresInARow - 1));
}

/** The file in Windows' Startup folder that starts the server when you log in. */
export function startupFilePath(env: Record<string, string | undefined>): string | null {
  if (!env.APPDATA) return null;
  return win32.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'DnD server.cmd');
}

export function startupFileContent(repoDir: string): string {
  // chcp 65001: the file is UTF-8, so folders with umlauts work. %% : a literal % inside a batch file.
  return [
    '@echo off',
    'chcp 65001 >nul',
    'title DnD server',
    `cd /d "${repoDir.replaceAll('%', '%%')}"`,
    'call npm run host',
    'echo.',
    'echo The DnD server has stopped. You can close this window.',
    'pause >nul',
    '',
  ].join('\r\n');
}

/**
 * PowerShell that tells Windows "somebody is using this PC" every 30 seconds,
 * for as long as the server (parentPid) lives. Nothing in the power settings
 * is changed; the screen may still switch off.
 */
export function keepAwakeScript(parentPid: number): string {
  return [
    `$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'`,
    '$api = Add-Type -MemberDefinition $sig -Name Awake -Namespace DndHost -PassThru',
    `while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) {`,
    '  [void]$api::SetThreadExecutionState([uint32]1)', // ES_SYSTEM_REQUIRED: restarts the sleep timer
    '  Start-Sleep -Seconds 30',
    '}',
  ].join('\n');
}

/** -EncodedCommand takes UTF-16LE in base64, which sidesteps every quoting rule on the way. */
export function keepAwakeArgs(parentPid: number): string[] {
  const encoded = Buffer.from(keepAwakeScript(parentPid), 'utf16le').toString('base64');
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}

export interface BannerInfo {
  /** The address friends open. null = no tunnel is connected (yet). */
  address: string | null;
  /** Address on the home Wi-Fi, if the PC has one. */
  lanAddress: string | null;
  inviteCode: string;
  /** true while the address changes on every start. */
  addressChanges: boolean;
}

export function bannerLines({ address, lanAddress, inviteCode, addressChanges }: BannerInfo): string[] {
  const rows: [string, string][] = [];
  if (address) rows.push(['Address', address]);
  if (lanAddress) rows.push([address ? 'At home' : 'On your Wi-Fi', lanAddress]);
  if (inviteCode) rows.push(['Invite code', inviteCode]);
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  const lines = [
    address ? 'The DnD server is online.' : 'The DnD server is running (home Wi-Fi only).',
    '',
    ...rows.map(([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`),
    '',
  ];
  if (inviteCode) lines.push('Friends need the invite code once, when they choose their password.');
  if (address && addressChanges) lines.push('This address is new every time the server starts. Send it to your friends.');
  lines.push('Leave this window open. Close it (or press Ctrl+C) to stop the server.');
  return lines;
}
