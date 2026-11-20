import { describe, expect, it } from 'vitest';
import {
  bannerLines,
  cloudflaredArgs,
  cloudflaredCandidates,
  DEFAULT_HOST_CONFIG,
  findQuickTunnelUrl,
  keepAwakeArgs,
  namedTunnelConfig,
  newInviteCode,
  normalizeAddress,
  readHostConfig,
  restartDelayMs,
  startupFileContent,
  startupFilePath,
  tunnelIsConnected,
} from './hostLib.ts';

describe('host settings (server/data/host.json)', () => {
  it('takes what is usable and keeps the defaults for the rest', () => {
    const { config, problems } = readHostConfig({ port: '8080', inviteCode: ' owlbear ', tunnel: 'OFF', keepAwake: false });
    expect(config).toEqual({ ...DEFAULT_HOST_CONFIG, port: 8080, inviteCode: 'owlbear', tunnel: 'off', keepAwake: false });
    expect(problems).toEqual([]);
  });

  it('says what is wrong instead of stopping', () => {
    const { config, problems } = readHostConfig({ port: 99999, tunnel: 'fast', keepAwake: 'yes', address: 'nonsense' });
    expect(config).toEqual(DEFAULT_HOST_CONFIG);
    expect(problems).toHaveLength(4);
    expect(readHostConfig([1, 2]).problems).toHaveLength(1);
  });

  it('falls back to a quick tunnel while a named one is not filled in', () => {
    const half = readHostConfig({ tunnel: 'named', tunnelName: 'dnd' });
    expect(half.config.tunnel).toBe('quick');
    expect(half.problems[0]).toContain('"address" is missing');
    const full = readHostConfig({ tunnel: 'named', tunnelName: 'dnd', address: 'dnd.example.com/' });
    expect(full.problems).toEqual([]);
    expect(full.config).toMatchObject({ tunnel: 'named', address: 'https://dnd.example.com' });
  });

  it('tidies addresses typed by hand', () => {
    expect(normalizeAddress(' https://Dnd.Example.com/play ')).toBe('https://dnd.example.com');
    expect(normalizeAddress('pc.tail1234.ts.net')).toBe('https://pc.tail1234.ts.net');
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress('localhost')).toBeNull();
  });
});

describe('invite codes', () => {
  it('are three words and a number', () => {
    let n = 0;
    expect(newInviteCode((max) => n++ % max)).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d\d$/);
    expect(newInviteCode(() => 0)).toBe('amber-amber-amber-10');
  });
});

describe('cloudflared', () => {
  it("finds a quick tunnel's address in the log", () => {
    const line = '2026-11-20T11:30:23Z INF |  https://Fancy-words-here-42.trycloudflare.com       |';
    expect(findQuickTunnelUrl(line)).toBe('https://fancy-words-here-42.trycloudflare.com');
    expect(findQuickTunnelUrl('Post "https://api.trycloudflare.com/tunnel": no such host')).toBeNull();
    expect(findQuickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
  });

  it('knows when a named tunnel is connected', () => {
    expect(tunnelIsConnected('INF Registered tunnel connection connIndex=0 location=fra08 protocol=quic')).toBe(true);
    expect(tunnelIsConnected('INF Starting tunnel tunnelID=abc')).toBe(false);
  });

  it('is started for a quick or a named tunnel', () => {
    const quick = { ...DEFAULT_HOST_CONFIG, port: 4000 };
    expect(cloudflaredArgs(quick, 'c.yml')).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://localhost:4000']);
    const named = { ...quick, tunnel: 'named' as const, tunnelName: 'dnd', address: 'https://dnd.example.com' };
    expect(cloudflaredArgs(named, 'c.yml')).toEqual(['tunnel', '--no-autoupdate', '--config', 'c.yml', 'run', 'dnd']);
    expect(namedTunnelConfig('dnd', 'https://dnd.example.com', 4000)).toBe(
      [
        '# Written by "npm run host" on every start. Change server/data/host.json instead.',
        'tunnel: "dnd"',
        'ingress:',
        '  - hostname: "dnd.example.com"',
        '    service: http://localhost:4000',
        '  - service: http_status:404',
        '',
      ].join('\n'),
    );
  });

  it('is looked for where Windows installs it', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Jörg\\AppData\\Local' };
    expect(cloudflaredCandidates(env, 'win32')).toEqual([
      'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      'C:\\Users\\Jörg\\AppData\\Local\\Microsoft\\WinGet\\Links\\cloudflared.exe',
    ]);
    expect(cloudflaredCandidates(env, 'linux')).toEqual([]);
  });
});

describe('keeping things running', () => {
  it('waits longer after each failure, up to a minute', () => {
    expect([1, 2, 3, 4, 10].map(restartDelayMs)).toEqual([2000, 4000, 8000, 16000, 60000]);
  });

  it('writes the Windows autostart file', () => {
    expect(startupFilePath({ APPDATA: 'C:\\Users\\Jörg\\AppData\\Roaming' })).toBe(
      'C:\\Users\\Jörg\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\DnD server.cmd',
    );
    expect(startupFilePath({})).toBeNull();
    const file = startupFileContent('C:\\Users\\Jörg\\100% DnD');
    expect(file.split('\r\n').slice(0, 5)).toEqual([
      '@echo off',
      'chcp 65001 >nul',
      'title DnD server',
      'cd /d "C:\\Users\\Jörg\\100%% DnD"',
      'call npm run host',
    ]);
  });

  it('hands PowerShell the keep-awake loop without any quoting', () => {
    const args = keepAwakeArgs(4242);
    const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
    expect(args.at(-2)).toBe('-EncodedCommand');
    expect(script).toContain('Get-Process -Id 4242');
    expect(script).toContain('SetThreadExecutionState([uint32]1)');
  });
});

describe('the banner', () => {
  it('shows the address, the invite code and that a quick address changes', () => {
    const lines = bannerLines({
      address: 'https://a-b-c.trycloudflare.com',
      lanAddress: 'http://192.168.178.31:3001',
      inviteCode: 'raven-kettle-thistle-47',
      addressChanges: true,
    });
    expect(lines[0]).toBe('The DnD server is online.');
    expect(lines).toContain('  Address:      https://a-b-c.trycloudflare.com');
    expect(lines).toContain('  Invite code:  raven-kettle-thistle-47');
    expect(lines.join('\n')).toContain('new every time');
  });

  it('says so when there is no tunnel', () => {
    const lines = bannerLines({ address: null, lanAddress: 'http://192.168.178.31:3001', inviteCode: '', addressChanges: false });
    expect(lines[0]).toBe('The DnD server is running (home Wi-Fi only).');
    expect(lines.join('\n')).not.toContain('Invite code');
  });
});
