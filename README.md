# DnD Table

Digital D&D character sheets for our in-person sessions. Everyone uses their phone (Android or iOS): the DM creates a room, players join it with a short code.

> Status: skeleton. Rooms (create, join, reconnect, member list) work. Character sheets come next.

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
- Each phone stores a secret token in `localStorage` and automatically resumes its seat after a reload, screen lock or dropped Wi-Fi.
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
npm run dev
```

This starts the server on `http://localhost:3001` and the app on `http://localhost:5173`.

### Trying it on phones

The dev server listens on your network. Put the phones on the same Wi-Fi as your computer and open `http://<your-computer-ip>:5173` (Vite prints the "Network" URL when it starts). One phone taps **I'm the DM** and creates a room; the others enter the code.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Server + client with hot reload |
| `npm test` | Unit tests (`shared`) and Socket.IO integration tests (`server`) |
| `npm run typecheck` | TypeScript checks for all workspaces |
| `npm run build` | Builds the client into `client/dist` |
| `npm start` | Production server, also serves the built client |

## Configuration (server)

| Variable | Default | |
|---|---|---|
| `PORT` | `3001` | HTTP + WebSocket port |
| `DB_PATH` | `server/data/dnd.sqlite` | SQLite file. Back this file up to back up every campaign. |
| `CORS_ORIGIN` | unset | Comma-separated origins, only needed if the client is hosted elsewhere |

## Playing at a friend's house

For real sessions the server should run somewhere that doesn't depend on any one phone: a small cloud host (Fly.io, Render, Railway, a cheap VPS) with a persistent disk for the SQLite file. Then players only need mobile data or the host's Wi-Fi. Deployment isn't set up yet.

## Licensing of game content

Only content from the D&D System Reference Document (SRD 5.1 / 5.2.1, CC-BY-4.0) may be bundled. Anything else is entered by players as homebrew. See `CLAUDE.md`.
