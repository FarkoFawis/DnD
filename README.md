# DnD Table

Digital D&D character sheets for our in-person sessions. Everyone uses their phone (Android or iOS).

1. Log in with your account (made for you in advance; you choose your password the first time).
2. **Characters:** make your characters. Any character can join any campaign, one session at a time.
3. **Play → Host:** the DM picks tonight's campaign and gets a 5-letter code.
4. **Play → Join:** players type the code, pick a character and tap **Ready** in the lobby (the DM in the middle, the players' seats around). The DM starts the session.
5. During the session players see their sheet; only the DM changes it (damage, healing, items).

> Status: rough prototype (2024 rules). Accounts, campaigns, live sessions and a basic character sheet work: HP, AC, abilities, saves, skills, items, coins, spells, notes. The DM can change any player's sheet during a session, e.g. damage, healing, giving or taking items.

## How it works

```
 phones (PWA in the browser)          small server (Node.js)
 ┌──────────┐                          ┌──────────────────────────┐
 │ DM       │◀── WebSocket ───────────▶│ Express + Socket.IO      │
 │ Player 1 │◀── (Socket.IO) ─────────▶│ rooms, members, sheets   │
 │ Player 2 │◀────────────────────────▶│ SQLite (source of truth) │
 └──────────┘                          └──────────────────────────┘
```

- **The server owns the state, not the DM's phone.** If the DM's battery dies or the browser crashes, nothing is lost. Everyone just reconnects.
- Characters belong to players and keep their progress wherever they play.
- **Home screen like a game menu:** your name top left (tap it for the sidebar with the connection status and Log out), Characters and Settings down the left, one of your characters as the picture, and a big Play button bottom right. Play, Characters, Settings and Configure open as one panel with its sections as tabs down the left side, a round ✕ and Done.
- Each phone remembers its login and current session and automatically gets back in after a reload, screen lock or dropped Wi-Fi.
- **The DM plans ahead with Configure** (the gear next to each campaign): handouts (pictures and text to put on the players' phones), NPCs and opponents. In the session the DM starts fights (every phone pulses red and, on Android, vibrates), rolls or enters initiative and runs the turn order.
- **Short Rests:** when the DM calls one, hurt players spend Hit Dice on their own phone: throw the die, type in the number, tap Heal. A Long Rest brings all Hit Dice back.
- **Dice roller, if you want it:** real dice are the normal way. Whoever switches the roller on in Settings can tap an ability, save, skill or attack on their sheet to roll it with the right bonus (with Advantage or Disadvantage), and the DM sees the result.
- **Backups:** in Configure → Backup the DM saves the whole campaign (handouts, NPCs, log, characters) as one file. Play → Host → "Load a backup file" brings it back, for example on a new computer. Create the players' accounts first, so their characters find their way home.
- A **session log** records damage, healing, loot, spells used, rests and fights, and gives the DM a "Last time on …" recap in the next lobby.
- `shared/` holds the TypeScript used by both sides: the socket event contract and the rules math (ability modifiers, proficiency bonus, ...).

## Repo layout

| Folder | What |
|---|---|
| `client/` | React + Vite + TypeScript, installable PWA |
| `server/` | Node.js, Express, Socket.IO, SQLite via `node:sqlite` |
| `shared/` | Socket event types, room codes, rules helpers (+ tests) |
| `CLAUDE.md` | Architecture notes and a D&D 5e rules reference |

## Getting started

Requires **Node.js 22.13 or newer**.

```bash
npm install
npm run users -- add Faris Mira Jonas   # create the accounts (once)
npm run dev
```

This starts the server on `http://localhost:3001` and the app on `http://localhost:5173`.

### Trying it on phones

The dev server listens on your network. Put the phones on the same Wi-Fi as your computer and open `http://<your-computer-ip>:5173` (Vite prints the "Network" URL when it starts). Log in on each phone, host a campaign on one, and join with the code on the others.

## Managing accounts

There is no public sign-up. Accounts are created on the server:

| Command | Does |
|---|---|
| `npm run users -- add Mira Jonas` | Create accounts. Each person picks a password at first login. |
| `npm run users -- list` | Show accounts and who hasn't set a password yet |
| `npm run users -- reset-password Mira` | Forgotten password: clears it, Mira picks a new one at next login |
| `npm run users -- remove Jonas` | Delete an account (and their characters) |

All commands work on Windows, macOS and Linux. Set the `DB_PATH` environment variable only if the database is not in the default place.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Server + client with hot reload |
| `npm test` | Unit tests (`shared`) and Socket.IO integration tests (`server`) |
| `npm run typecheck` | TypeScript checks for all workspaces |
| `npm run build` | Builds the client into `client/dist` |
| `npm start` | Production server, also serves the built client |
| `npm run host` | Game night from your own PC: builds if needed, starts the server and a Cloudflare Tunnel, restarts them if they stop (`docs/self-hosting.md`) |
| `npm run users -- ...` | Manage accounts (see above) |

## Configuration (server)

| Variable | Default | |
|---|---|---|
| `PORT` | `3001` | HTTP + WebSocket port |
| `DB_PATH` | `server/data/dnd.sqlite` | SQLite file. Back this file up to back up every campaign. |
| `UPLOADS_DIR` | `server/data/uploads` | Pictures the DM uploads for handouts. Back this folder up together with the database. |
| `CONTENT_DIR` | `server/data/content` | Private content packs (see `docs/content-packs.md`) |
| `INVITE_CODE` | unset | When set, choosing an account's first password needs this code. Set it on any server that is reachable from the internet. |
| `CORS_ORIGIN` | unset | Comma-separated origins, only needed if the client is hosted elsewhere |

## Playing at a friend's house: putting it online

For real sessions the server should not depend on anyone's PC or phone. The repository is ready for **Fly.io**: `Dockerfile` and `fly.toml` run the app on one small machine with a permanent disk for the database and the uploaded pictures. **`docs/hosting.md` is the step-by-step guide** (Windows, no Docker needed): create the app, set an invite code, deploy, add the accounts, send your friends the link.

**Or run it from your own PC:** `npm run host` starts the app and a free Cloudflare Tunnel, so friends reach your PC from anywhere without changes to the router. It costs nothing, but the app is only there while the PC is on and its internet works. **`docs/self-hosting.md` is the step-by-step guide** (Windows). `npm run host` makes up an invite code on its first start.

Online, set `INVITE_CODE`: friends then need that code once, when they choose their password. Without it anyone who guesses the name of an account that has not logged in yet could take it.

## Licensing of game content

Only content from the D&D System Reference Document (SRD 5.1 / 5.2.1, CC-BY-4.0) may be bundled. Anything else is entered by players as homebrew. See `CLAUDE.md`.
