/**
 * Run the app from your own PC for a game night (see docs/self-hosting.md).
 *
 *   npm run host                    build the app if needed, start it, open the tunnel, keep both running
 *   npm run host -- autostart on    Windows: start the server whenever you log in
 *   npm run host -- autostart off
 *
 * Settings live in server/data/host.json, which is written on the first start.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomInt } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  bannerLines,
  cloudflaredArgs,
  cloudflaredCandidates,
  DEFAULT_HOST_CONFIG,
  findQuickTunnelUrl,
  keepAwakeArgs,
  namedTunnelConfig,
  newInviteCode,
  readHostConfig,
  restartDelayMs,
  startupFileContent,
  startupFilePath,
  tunnelIsConnected,
  type HostConfig,
} from './hostLib.ts';

const serverDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '');
const clientDir = join(repoDir, 'client');
const dataDir = join(serverDir, 'data');
const configFile = join(dataDir, 'host.json');
const logFile = join(dataDir, 'host.log');
const tunnelConfigFile = join(dataDir, 'cloudflared.yml');
const isWindows = process.platform === 'win32';

const say = (text = '') => console.log(text);
function log(source: string, text: string): void {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} [${source}] ${text}\n`);
  } catch {
    // A log that cannot be written must never stop the game.
  }
}
function note(text: string): void {
  say(text);
  log('host', text);
}

// ---------- settings ----------

function loadConfig(): HostConfig {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(configFile)) {
    const fresh: HostConfig = { ...DEFAULT_HOST_CONFIG, inviteCode: newInviteCode(randomInt) };
    writeFileSync(configFile, `${JSON.stringify(fresh, null, 2)}\n`);
    note(`First start: settings written to ${configFile}`);
    return fresh;
  }
  let raw: unknown;
  try {
    // Notepad likes to put a byte order mark in front.
    raw = JSON.parse(readFileSync(configFile, 'utf8').replace(/^﻿/, ''));
  } catch {
    note(`${configFile} cannot be read (a missing comma or quote?). The defaults are used until it is fixed.`);
    return { ...DEFAULT_HOST_CONFIG };
  }
  const { config, problems } = readHostConfig(raw);
  for (const problem of problems) note(`Settings: ${problem}`);
  return config;
}

// ---------- building the app ----------

function newestChange(path: string): number {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(path)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dev-dist') continue;
    newest = Math.max(newest, newestChange(join(path, name)));
  }
  return newest;
}

/** Built never, or something the phones get has changed since (a `git pull`). */
function needsBuild(): boolean {
  const built = join(clientDir, 'dist', 'index.html');
  if (!existsSync(built)) return true;
  const sources = [
    join(clientDir, 'src'),
    join(clientDir, 'public'),
    join(clientDir, 'index.html'),
    join(clientDir, 'vite.config.ts'),
    join(repoDir, 'shared', 'src'),
    join(repoDir, 'package-lock.json'),
  ];
  return Math.max(...sources.map(newestChange)) > statSync(built).mtimeMs;
}

function build(): Promise<boolean> {
  return new Promise((done) => {
    // Started through `npm run host`, npm tells us where it lives; that avoids going through a shell.
    const npmCli = process.env.npm_execpath;
    const child =
      npmCli && /\.[cm]?js$/.test(npmCli)
        ? spawn(process.execPath, [npmCli, 'run', 'build'], { cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn('npm run build', { cwd: repoDir, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      if (stream) createInterface({ input: stream }).on('line', (line) => log('build', line));
    }
    child.on('error', (err) => {
      log('build', String(err));
      done(false);
    });
    child.on('exit', (code) => done(code === 0));
  });
}

// ---------- the parts that are kept running ----------

let stopping = false;
const running = new Set<ChildProcess>();

interface Part {
  name: string;
  start: () => ChildProcess;
  onLine?: (line: string) => void;
  /** Called when it stops by itself. Return false to give up on it. */
  onDown?: (info: { code: number | null; notFound: boolean; failures: number }) => boolean | void;
}

function keepRunning(part: Part): void {
  let failures = 0;
  const launch = () => {
    if (stopping) return;
    const startedAt = Date.now();
    let child: ChildProcess;
    let over = false;
    const ended = (code: number | null, notFound: boolean) => {
      if (over) return;
      over = true;
      running.delete(child);
      if (stopping) return;
      // Ran fine for a while: this is a new problem, not the same one again.
      failures = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
      log(part.name, notFound ? 'could not be started (not found)' : `stopped (exit code ${code})`);
      if (part.onDown?.({ code, notFound, failures }) === false) return;
      setTimeout(launch, restartDelayMs(failures));
    };
    child = part.start();
    running.add(child);
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      createInterface({ input: stream }).on('line', (line) => {
        log(part.name, line);
        part.onLine?.(line);
      });
    }
    child.on('error', (err: NodeJS.ErrnoException) => ended(null, err.code === 'ENOENT'));
    child.on('exit', (code) => ended(code, false));
  };
  launch();
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(1500);
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

async function appAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApp(port: number, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (stopping) return false;
    if (await appAnswers(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function lanAddress(port: number): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${port}`;
    }
  }
  return null;
}

function findCloudflared(): string {
  if (process.env.CLOUDFLARED) return process.env.CLOUDFLARED;
  return cloudflaredCandidates(process.env, process.platform).find((path) => existsSync(path)) ?? 'cloudflared';
}

function banner(info: Parameters<typeof bannerLines>[0]): void {
  const lines = bannerLines(info);
  const rule = '='.repeat(Math.min(78, Math.max(...lines.map((l) => l.length))));
  say();
  say(rule);
  for (const line of lines) say(line);
  say(rule);
  say();
  log('host', `online: ${info.address ?? info.lanAddress ?? 'no address'}`);
}

// ---------- npm run host ----------

async function run(): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  // Start each run's log small enough to send to somebody.
  if (existsSync(logFile) && statSync(logFile).size > 2_000_000) rmSync(logFile);
  log('host', '---------- starting ----------');

  const config = loadConfig();
  const port = Number(process.env.PORT) || config.port;
  config.port = port;
  const inviteCode = process.env.INVITE_CODE?.trim() || config.inviteCode;

  if (await portInUse(port)) {
    say(
      (await appAnswers(port))
        ? `The DnD server is already running on this PC (port ${port}). Close its window first if you want to start it again.`
        : `Port ${port} is used by another program. Close that program, or change "port" in ${configFile}.`,
    );
    process.exitCode = 1;
    return;
  }

  if (needsBuild()) {
    say('Building the app. This takes up to a minute...');
    const ok = await build();
    if (!ok && !existsSync(join(clientDir, 'dist', 'index.html'))) {
      say(`Building the app failed. Run "npm install" and try again. Details: ${logFile}`);
      process.exitCode = 1;
      return;
    }
    if (!ok) note(`Building the new version failed, the previous one is used. Run "npm install" and start again. Details: ${logFile}`);
  }

  if (config.tunnel !== 'off' && !inviteCode) {
    note(`Warning: no invite code is set. Anyone who finds the address could take an account that has not logged in yet. Set "inviteCode" in ${configFile}.`);
  }

  // The app itself.
  keepRunning({
    name: 'app',
    start: () =>
      spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/index.ts'], {
        cwd: serverDir,
        env: { ...process.env, PORT: String(port), INVITE_CODE: inviteCode },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    onDown: ({ failures }) => {
      say(`The app stopped unexpectedly. Starting it again... (details: ${logFile})`);
      if (failures === 5) say('It keeps stopping. Close this window, run "npm install" and start again.');
    },
  });
  if (!(await waitForApp(port, 60))) {
    if (!stopping) say(`The app does not answer yet. Still trying. Details: ${logFile}`);
  }

  // Keep Windows from going to sleep while the server runs.
  if (isWindows && config.keepAwake) {
    keepRunning({
      name: 'awake',
      start: () => spawn('powershell.exe', keepAwakeArgs(process.pid), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
      onDown: () => {
        say('Could not keep the PC awake by itself. Set Windows to never sleep: Settings > System > Power > Sleep.');
        return false;
      },
    });
  }

  const lan = lanAddress(port);
  if (config.tunnel === 'off') {
    banner({ address: config.address || null, lanAddress: lan, inviteCode, addressChanges: false });
    return;
  }

  // The tunnel.
  if (config.tunnel === 'named') writeFileSync(tunnelConfigFile, namedTunnelConfig(config.tunnelName, config.address, port));
  const cloudflared = findCloudflared();
  let announced: string | null = null;
  let recent: string[] = [];
  say(config.tunnel === 'named' ? `Connecting ${config.address} ...` : 'Asking Cloudflare for an address...');
  keepRunning({
    name: 'tunnel',
    start: () => spawn(cloudflared, cloudflaredArgs(config, tunnelConfigFile), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    onLine: (line) => {
      // cloudflared's routine lines (INF) say nothing about what went wrong.
      if (!/ INF /.test(line)) recent = [...recent.slice(-5), line];
      const address = config.tunnel === 'named' ? (tunnelIsConnected(line) ? config.address : null) : findQuickTunnelUrl(line);
      if (!address || address === announced) return;
      announced = address;
      banner({ address, lanAddress: lan, inviteCode, addressChanges: config.tunnel === 'quick' });
    },
    onDown: ({ notFound, failures }) => {
      if (notFound) {
        say('cloudflared is not installed, so there is no address for your friends yet.');
        say('Install it with:   winget install --id Cloudflare.cloudflared');
        say('Then close this window and start the server again.');
        banner({ address: null, lanAddress: lan, inviteCode, addressChanges: false });
        return false;
      }
      const wasOnline = announced !== null;
      announced = null;
      if (wasOnline) {
        say(
          config.tunnel === 'quick'
            ? 'The connection to Cloudflare dropped. Reconnecting; the address will be a NEW one.'
            : 'The connection to Cloudflare dropped. Reconnecting...',
        );
      } else if (failures === 3) {
        if (recent.some((line) => /origin cert/i.test(line))) {
          say('This PC is not logged in to Cloudflare yet. Run:   cloudflared tunnel login   (see docs/self-hosting.md)');
        } else {
          say('The tunnel does not come up. Is the internet working? Still trying. The last lines from cloudflared:');
          for (const line of recent) say(`  ${line.slice(0, 300)}`);
        }
      }
    },
  });
}

function stop(): void {
  if (stopping) return;
  stopping = true;
  log('host', 'stopping');
  for (const child of running) child.kill();
  // Give the app a moment to close its database.
  setTimeout(() => process.exit(0), 1500).unref();
}

// ---------- npm run host -- autostart on|off ----------

function autostart(mode: string | undefined): void {
  const file = isWindows ? startupFilePath(process.env) : null;
  if (!file) {
    say('Autostart is for Windows. On other systems, start "npm run host" from your own startup tool.');
    process.exitCode = 1;
    return;
  }
  if (mode === 'on') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, startupFileContent(repoDir));
    say('Done. From now on the DnD server starts in its own window when you log in to Windows.');
    say('Switch it off again with:   npm run host -- autostart off');
  } else if (mode === 'off') {
    rmSync(file, { force: true });
    say('Done. The DnD server no longer starts by itself.');
  } else {
    say(`Autostart is ${existsSync(file) ? 'on' : 'off'}. Change it with:   npm run host -- autostart on   (or off)`);
  }
}

const [command, argument] = process.argv.slice(2);
if (command === undefined) {
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  await run();
} else if (command === 'autostart') {
  autostart(argument);
} else {
  say('npm run host                     start the server for a game night');
  say('npm run host -- autostart on     Windows: start it whenever you log in (off to undo)');
  say('The guide is docs/self-hosting.md');
}
