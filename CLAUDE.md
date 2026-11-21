# CLAUDE.md — D&D Character Sheet App

Part 1 of this file describes **the codebase** (how it is built and how to work in it). Part 2 is **the rules reference** for D&D that the app models.

---

# Part 1 — Project & architecture

## What we are building
A mobile-first web app that replaces our paper character sheets. We play **in person** at a friend's house for a whole evening, with **phones only** (Android + iOS, no PCs).

**Design principle:** the app *adds to* the table, it doesn't replace it. Dice, the DM's narration and the social game stay physical; the app only replaces the paper sheets and makes character information easier to find and understand. Don't build features that pull attention away from the table.

## User flow (agreed with Faris)
1. **Login.** Accounts are **pre-made** by the admin (`npm run users -- add <names>`); there is no public sign-up. On first login each friend **chooses their own password**.
2. **Home screen** (`client/src/Home.tsx`), laid out after a game menu Faris sent as a template (layout only, own visuals): no bar at the top; top left the player's initial and name, which opens a **sidebar from the left** (`Drawer` in `session/SessionDrawer.tsx`, the same one as in a session) with the connection status, who is logged in and **Log out**; down the left side **Characters** and **Settings** as round icon buttons; on the right, fading into the page, the picture of the screen: one of the player's character portraits (the newest with a picture of its own), or a line-drawn d20 while there is none; bottom left that character's name, bottom right the big **Play** button. **Play is a screen of its own** (`client/src/Play.tsx`, Faris's wish with a game's menu as the reference for the motion): two big separate buttons **Join** and **Host**; tapping one slides the two apart to their sides, the picture behind pans sideways and dims, and that page comes up from below, with a big **Back** button bottom left on both screens (page → the two buttons → home). The picture (`HeroBackdrop` in `Home.tsx`) is shared by the home screen and Play so it can move between them (`.stage[data-scene]` in `App.tsx`, `useScene()`). **Characters, Settings and Configure open as a panel** (`client/src/Panel.tsx`): one frame with the sections as tabs **down the left side** (Characters: Roster / Create; Settings: General / Theme / Language; Configure: Handouts / NPCs / Log / Backup), the chosen section on the right, a round ✕ on the top right corner and **Done** at the bottom right (both close it). Faris did not want tabs as boxes side by side there. Lists inside a panel are rows between thin lines (`.rows`), not boxes. The character sheet and the creator still take the whole screen. After a session ends or is left, everyone lands on the home screen. Settings (`client/src/SettingsScreen.tsx`, stored per phone in localStorage by `client/src/settings.ts`) has the tabs **General** with a **Show helper texts** switch, a **Dice roller** switch (off by default, see point 11) and an **Animations and effects** switch (on by default, see point 13), **Theme** with **Default** (warm dark with gold), **Light** and **Black** (pure black and white), and **Language** with **English** and **Deutsch** (see point 14).
3. **Characters:** players create and edit their own characters here, outside sessions. Like Terraria characters and worlds, **any character can join any campaign** and carries its progress (HP, items, level…) with it, but it can only be in **one session at a time**.
4. **Play → Host:** the DM picks one of **their campaigns** (or creates one) and opens a **lobby** with a 5-letter code. The DM is the campaign's owner.
5. **Play → Join:** type the code, then **pick one of your free characters**. You land in the lobby and tap **Ready**. When everyone is ready the DM is prompted to start; the DM can also **force start**, after a warning that not everyone is ready. **The lobby looks the same for DM and players** (`client/src/Lobby.tsx`): the DM's card in the middle (crown, name, session code, Configure for the DM), the players' portrait seats left and right of it and in a row below (4 seats, 7 from the fifth player on), free seats as dashed placeholders, a round ✕ (leave / close the lobby) bottom left and **Ready** (player) or **Start** (DM) bottom right. When more players join than fit around the DM on that screen (more than 7, or the seats would get too squat), the DM's card goes wide to the top and the players stack in rows of three below it.
6. **During the session a player's screen is three pages side by side, changed by swiping** (or the pill at the bottom): **Fight ‹ My sheet › Party** (`client/src/session/PlayerSession.tsx`, `usePager.ts`). **My sheet** shows only the character, read-only, laid out like the paper sheet (`ClassicSheet.tsx`, HP first and large); tap spells/items/features to read them. **Party** (swipe right-to-left) is the portrait cards (`PartyGrid.tsx`), their own card highlighted. **Fight** (swipe left-to-right) exists only while a fight runs, opens by itself when the DM initiates one, and holds everything about it: whose turn, the turn order with the opponents. App title, connection status, campaign, DM, session code and **Leave session** are in a **drawer on the left** (`SessionDrawer.tsx`, same as the DM's). **Only the DM edits** (the DM can unlock HP & items per player) (damage/heal, give or take items, change anything) by tapping a player in the party list. Everyone sees the party's HP update instantly. Once started, **the DM's screen is three pages too: Fight ‹ Party › Tools** (`client/src/session/DmSession.tsx`, same pager and pill). **Party** is only the grid of portrait cards; tapping one opens that sheet under it. **Fight** (always there for the DM) starts with "Initiate fight" and then holds initiative, the turn order, opponents' HP and attacks, and the turn buttons; it opens by itself when a fight starts and the DM is sent back to Party when it ends. **Tools** holds what the players are being shown, rests and level-ups for the whole party, and the campaign prep tabs (Handouts, NPCs, Log, Backup). Title, connection status, session code and End session are in the same drawer, opened from a button at the top left of the Party page (about 1/3 of the screen, 82% on narrow phones).
   **Short Rests and Hit Dice:** when the DM calls a Short Rest (for the party on Tools, or for one player on their sheet), every hurt character with Hit Dice left gets a **Short rest** box right under the HP on their own sheet (`client/src/HitDice.tsx`): they throw their real Hit Die, type in what it shows and tap **Heal** (roll + Constitution modifier, at least 1 HP), as often as they have dice, then **Done resting**. The DM sees "Short rest · spending Hit Dice" on the party card, can spend or give back dice on the player's sheet, and a Long Rest brings all of them back (2024 rules).
   **Heroic Inspiration** (2024 rule) is a token: the DM gives it on the player's sheet ("Give Heroic Inspiration", tap again to take it back), that player's phone announces it, a gold four-pointed star sits on their party card for everyone, and their own sheet gets a **Heroic Inspiration** row under the HP. Tapping it asks first (it is given up to reroll one die) and then uses it up, which the DM sees like anything else that is used. Nobody holds two; Humans (the Resourceful trait) get it back with every Long Rest.
   **"Who is best at…"** (DM, top right of the Party page) opens a sheet from the bottom: pick a skill, a saving throw, a passive score or Initiative and the party is listed best first with the number large (`client/src/PartyChecks.tsx`, `rankParty()` in `shared/src/rules.ts`).
   **Levelling up always happens on the player's own phone.** Outside sessions from Characters; in a session the DM says when ("Let X level up" on the player's sheet, or "The party levels up"), the player gets a banner on their sheet and runs the wizard. The DM has no wizard.
7. **Start and end of a session.** When the DM starts it, every phone shows the **title card** for about four seconds ("Session 4", the campaign's name). Ending the session (DM) or leaving it (player) frees the characters; they can be edited in Characters again. When the DM ends a session that was played, every phone that was in it gets the **session summary** over the home screen until **Done** (`client/src/session/SessionSummary.tsx`): hours played, fights, rounds, opponents defeated, the party's rests, and per character the damage taken, HP regained, spells and abilities used (and the favourite), times at 0 HP, loot and a level reached. It is built from the session log and never names an opponent.
8. **Configure (DM, per campaign):** the gear next to each campaign in Play → Host, and in the lobby; a panel with four tabs: **Handouts** (title + picture and/or text), **NPCs** (opponents and NPCs with AC, HP, speed, ability scores, initiative bonus, personality, attacks, notes), **Log** and **Backup**. During a session the same tabs sit on the DM's **Tools** page, where each handout has a **Show** button that puts it on every player's phone until hidden.
9. **Fights:** "Initiate fight" lets the DM pick opponents (several copies of one are numbered), then every phone shows the fight alert and vibrates (Android only; iOS Safari has no web vibration). The alert (`FightAlert.tsx`, one 2.6 s CSS timeline in `styles.css`) is a red line across the screen with a diamond in the middle that pulses with crossed swords, flips to an exclamation mark, pulses twice more and collapses, after which the line breaks into sparks; the whole screen glows faintly red with each of the three pulses. Smooth vector shapes, no pixel art (Faris's reference was a game's alert; only the motion is borrowed). The DM rolls initiative for everyone (d20 + DEX modifier + bonus), for the missing ones only, or types totals in. Players see the turn order and "It's your turn!" on their Fight page (never on the sheet); only the DM sees opponents' HP and AC, and tracks their damage on the DM's Fight page, where tapping an opponent also shows its attacks and personality. **Hidden opponents:** with "Keep their names hidden" ticked when picking the opponents, the players get them as **Unknown** in the turn order (dashed row with a "?") until the DM taps **Reveal to the players** on that opponent, or **Reveal all**; the DM can hide a name again. **Moments of the fight** are announced for about two seconds by two thin lines with the alert's diamond and the words between them (`session/MomentAlert.tsx`): **Your turn** on that player's phone whatever page is open (with a short buzz on Android), **Round N** on the Fight page of the DM and the players, the name of an opponent that is **revealed** (players), and **Fight over** with the number of rounds on every phone.
10. **Session log:** damage, healing, loot, spells/abilities used, rests, fights and handouts are recorded automatically while a session runs. The DM gets a **"Last time on …" recap** of the previous session in the lobby (and in the Log tab).
11. **Dice roller (optional, per phone):** real dice are the normal way; the roller is for whoever wants it. With the switch on in Settings, the abilities, saves, skills, Initiative, weapon attacks and Spell attack on a player's in-session sheet turn gold and become buttons. A tap opens a sheet from the bottom (`client/src/Dice.tsx`) with what will be rolled and where the bonus comes from, and **Disadvantage / Roll / Advantage**. The server throws the dice. After an attack the sheet offers the damage roll (critical after a natural 20, two-handed for Versatile weapons). **The DM always sees the result**, whatever their own setting: as a toast at the top of their screen for 8 seconds, as the last action on the player's party card, and in the session log. Other players don't. During a fight a player with the roller on gets **Roll my initiative** on their Fight page; the result goes straight into the turn order. With the roller on, the Short rest box also offers **Roll for me**.
12. **Campaign backup:** Configure → **Backup** → **Save a backup file** downloads one JSON file with the campaign's handouts (pictures included), NPCs, session log and the characters that last played in it (portraits included). **Play → Host → Load a backup file** brings it back as a new campaign of whoever loads it. Characters return to their players by username; if a player has no account the DM is asked whether to load without their characters. Nothing that still exists is changed: a campaign that is still there comes back as a copy ("… (restored)"), characters that are still there are left as they are.
13. **Animations and effects (per phone, on by default):** things that happen show briefly where they happen, and never block a tap. Using something bursts at the button that was tapped (a rune circle for spells in the colour of their school, crossed slashes for attacks, a ring for features, rising plus signs for healing); damage and healing count the hit points up or down with the amount floating off, a shake or a swell, and a red or green glow at the screen's edges on the player's own phone (two deep beats when dropping to 0); the DM sees the same on the party cards plus a ring in the colour of what the player just did. An item handed over shows "Received: …" with glints and the new row lit; a natural 20 on the dice roller bursts into rays. A rest the DM calls shows the **rest alert** on the phones it concerns (`RestAlert.tsx`: a moon for a Long Rest, a campfire for a Short Rest), and finishing a level-up shows "Level N" over rays. Screens, panels, bottom sheets, the drawer and the pager pill slide and fade instead of jumping. All of it is off with the Settings switch or the phone's own "reduce motion"; only the fight and rest alerts and the moments of the session (title card, your turn, new round, revealed, fight over, Heroic Inspiration) stay then, as a plain fade, because they say something.
14. **Languages (per phone):** the app speaks **English and German**. It starts in the phone's own language and is changed in Settings → Language; two phones in one session can have different languages. Everything the app itself says is translated, and so is the vocabulary of the rules (classes, subclasses, species, backgrounds, abilities, skills, conditions with their rules texts, damage types, spell schools, languages, item categories), with the terms of the German 2024 rulebooks ("SL" for the DM, "W20" for dice). **The names and rules texts of single spells, items, feats and features stay English**, because they come from the SRD pack (about 100,000 words); a German content pack could change that later.

## Architecture
- **Monorepo** with npm workspaces:
  - `shared/` — TypeScript used by both sides: the socket/HTTP contract (`protocol.ts`), character validation (`character.ts`), room codes, and pure rules functions (`rules.ts`). **All sheet math lives here** so client and server compute the same numbers.
  - `server/` — Node.js + Express + Socket.IO. Owns the authoritative state and persists it to **SQLite** (`node:sqlite`, file `server/data/dnd.sqlite`, override with `DB_PATH`).
  - `client/` — React + Vite + TypeScript PWA (`vite-plugin-pwa`).
- **Auth:** `POST /api/auth/status|login|logout`, `GET /api/auth/me`. With `INVITE_CODE` set (online servers), choosing an account's first password also needs that code (`AccountStatus.needsInvite`, `login { invite }`); wrong codes count towards the lockout. Passwords hashed with scrypt; login returns a random token (stored SHA-256 hashed). 5 wrong passwords lock that username for 5 minutes. The socket connects with `auth: { token }` and is refused without a valid one.
- **Data model:** `users`, `auth_tokens`, `campaigns` (owner = DM), `characters` (id, owner `user_id`, `campaign_id` = last campaign played, JSON `data` validated by `shared/character.ts`), `live_sessions` (code ↔ campaign, at most one per campaign, `started` = lobby vs running), `session_players` (code, user, `character_id` UNIQUE so a character is in one session at most, `ready`). `Store.migrateToOwnedCharacters()` upgrades databases from the first prototype.
- **Who may edit a character** (`editable()` in `server/src/app.ts`): the DM of the session it's in may change everything. Its owner may change it outside sessions, **except HP, items and coins** (`DM_LOCKED_FIELDS`), which belong to the DM unless the DM has switched on `hpItemsUnlocked` for that character (only the DM can, from the player's sheet). In a session (lobby included) the owner can change nothing but those unlocked fields.
- **The server is the source of truth, not the DM's phone.** If the DM's phone dies, the live session, its code and every character are in the database. Each phone stores its login token and current session code in `localStorage` and re-sends `session:join` on every reconnect, so reloads, locked screens and crashes put people straight back in. A server restart loses nothing either. The remembered code is per address, so a phone that opens the app under a new address (a new tunnel address, `:3001` instead of `:5173`) has forgotten it while the player's character is still in the session: Play → Join then shows **You are still in a session** with **Back to the session** and **Leave it** (`stuckCharacter()` in `Play.tsx`, from `CharacterSummary.inSession`), and `session:leave` from a socket that is in no session leaves the one the player's character is in.
- **Character events all take a `characterId`:** `character:list|create|delete|update`, `character:adjustHp { delta }`, `item:add|update|remove`. HP and items are sent as operations, not new values, so concurrent edits never overwrite each other. `character:create` accepts optional starting `data` (the hook for a character creator). `character:use` (cast a spell / use a limited feature / attack: spends a slot or use, refused when none are left, and records `lastAction` for the DM's party list), `character:restore`, `character:rest`, `character:concentration { end | kept }`, `character:deathSave { result }`, `character:levelUp { choices }`, `character:hitDice { action: 'spend' | 'done', roll? }` (spend one Hit Die: with the player's own roll, or the server rolls when there is none; allowed for the DM, the owner outside sessions, and the owner in a session only while `CharacterData.resting` is set by the DM's Short Rest), `character:roll { roll, mode }` (the dice roller: `planRoll()` + `rollPlan()` from `shared/src/dice.ts` with `crypto.randomInt`, answered in the ack, sent to the DM's sockets as `session:roll`, stored as `lastAction { roll: true }` and logged; a rolled initiative fills the player's empty slot in the running fight). Sessions: `session:host|peek|join|ready|start|leave|end|rest` (`session:rest` = DM gives the whole party a Short or Long Rest).
- **Campaign prep** (`shared/src/prep.ts`, table `prep_entries`: kind `handout` | `npc`, JSON data): `prep:get`, `handout:save|delete`, `npc:save|delete`, campaign owner only. Handout pictures are shrunk on the phone (`client/src/prep/image.ts`), uploaded with `POST /api/campaigns/:id/images` (raw image body, bearer token) into `server/data/uploads/` (`UPLOADS_DIR`) and served from `/api/images/<random id>.<ext>` without login (an `<img>` can't send the token).
- **Live DM tools** (started sessions, host only): `handout:show { handoutId | null }`, `combat:start|add|action|end`. The shown handout and the fight are columns of `live_sessions`, so they survive crashes and reconnects, and travel in `SessionState` (`handout`, `combat`). All fight logic is pure in `shared/src/combat.ts` (`applyCombatAction`); the server strips opponents' HP/AC for players (`publicCombat`) by emitting `session:state` per socket while a fight runs. `session:alert { kind: 'fight' }` is the one-off alert/vibrate signal (`client/src/session/FightAlert.tsx`). An NPC `Combatant` may be `hidden`: `publicCombat` then also replaces its name with "Unknown" and blanks its `ref`, modifier and die, and `combat:start|add { hidden: true }` and `combat:action { type: 'reveal', id?, hidden }` set the flag. `fightMoment(before, after, myCharacterId?)` in `combat.ts` reads the moments (`turn | round | reveal | end`) off two states of the fight, so the phones need no extra signal for them.
- **Moments, title card and summary:** `session:start` emits `session:alert { kind: 'start', session }` once per session; `character:inspiration { action: 'give' | 'take' | 'spend' }` (give and take: DM only; spend: owner or DM, in a session too) sets `CharacterData.inspiration`, logs it and emits `session:alert { kind: 'inspiration', characterId }` when given. `session:end` builds `buildSummary()` (`shared/src/log.ts`) from the session's log and sends it to the players with `session:ended` and to the DM in the ack; a lobby closed before it started sends none.
- **Campaign backup** (`shared/src/backup.ts`): `GET /api/campaigns/:id/export` (owner only) builds the file, `POST /api/campaigns/import[?skipMissing=1]` (any logged-in user, body up to 200 MB, its own JSON parser) loads one. `parseBackup()` treats the file as untrusted input: every handout, NPC, log entry and character goes through the same validators as live input, unreadable entries are left out and counted, and the server only writes pictures whose bytes really are pictures. `Store.restoreCampaign()` writes everything in one transaction. Live sessions are not part of a backup.
- **Session log** (`shared/src/log.ts`, table `session_log`): each started session gets the campaign's next `session_no`. The server appends structured `LogEvent`s from the character, item, use, rest, handout and combat handlers (`logFor`, `logChanges`, `logInventory` in `app.ts`), only while the session is running. `log:get` returns the current and the previous session; `buildRecap()` + `recapLines()` turn entries into the recap. New things worth remembering: add a `LogKind`, describe it in `describeLogEntry`, log it from the handler.
- Client: prep UI in `client/src/prep/`, in-session pieces in `client/src/session/` (`DmSession` + `DmTools` for the DM, `PlayerSession` for players, shared `Page`, `usePager`, `SessionDrawer`, `FightAlert`); they talk to the server through `game.call(...)`.
- **Hosting** (`docs/hosting.md` is Faris's step-by-step guide): `Dockerfile` (client built, then one container with the server; `PORT=8080`, data in `/data`: `DB_PATH`, `UPLOADS_DIR`, `CONTENT_DIR`), `fly.toml` (Fly.io, Frankfurt, one machine with the volume `dnd_data` on `/data`, sleeps when idle, health check `/api/health`), `deploy/dnd-users` (the accounts tool on the host: `fly ssh console -C "dnd-users add Mira"`). One SQLite file on one disk means **one machine, never two**. Private content packs are uploaded onto the disk by hand, never committed and never built into the image (`.dockerignore` excludes `server/data`).
- **Hosting from Faris's own PC** (`docs/self-hosting.md` is the guide): `npm run host` (`server/src/host.ts`, pure parts tested in `hostLib.ts`) builds the client when its sources are newer than `client/dist`, then keeps three things running and restarts them with a growing delay: the app (`src/index.ts` on `port`, with `INVITE_CODE`), `cloudflared`, and on Windows a hidden PowerShell loop that keeps the PC awake. Settings are `server/data/host.json` (git-ignored, written on first start with a generated invite code): `tunnel` is `quick` (free `trycloudflare.com` address, new on every start, read from cloudflared's log), `named` (own domain on Cloudflare; the config for cloudflared is written to `server/data/cloudflared.yml`, the user's `.cloudflared` folder is not touched) or `off`. `npm run host -- autostart on|off` writes or removes `DnD server.cmd` in the Windows Startup folder; `start-server.cmd` is the double-click start. Everything is logged to `server/data/host.log`. Same database as `npm run dev`, so never both at once.
- Socket handlers validate input and answer through an **ack** `{ ok: true, ... } | { ok: false, error }`. Session state is broadcast as `session:state`.

## Commands (repo root)
- `npm install` — install all workspaces (Node 22.13+ required for `node:sqlite`).
- `npm run users -- add Faris Mira` / `list` / `reset-password Mira` / `remove Mira` — manage accounts.
- `npm run content` — check the private content packs in `server/data/content/` and show how much of the 2024 PHB the app has; `-- missing` names what is missing, `-- add <file>` checks a pack file and puts it in the folder (see `docs/content-packs.md`).
- `node shared/scripts/build-srd.mjs <5e-database checkout>` — regenerate `shared/src/content/srd.json` from the SRD 5.2 data.
- `npm run dev` — server on :3001 and client on :5173. Vite is exposed on the LAN (`host: true`) and proxies `/socket.io` and `/api` to the server, so phones on the same Wi-Fi can open `http://<laptop-ip>:5173`.
- `npm test` — Vitest for `shared` and `server` (server tests run a real HTTP + Socket.IO server on a random port with an in-memory DB).
- `npm run typecheck` — `tsc --noEmit` in every workspace.
- `npm run build` then `npm start` — production: the server serves the built client from `client/dist`.
- `npm run host` — game night from the PC: build if needed, app + Cloudflare Tunnel + keep-awake, restarted when they stop (`-- autostart on|off` for the Windows Startup folder).

## Conventions
- TypeScript strict everywhere. `shared` is consumed as source (no build step); the server runs through `tsx`.
- Add new socket events to `shared/src/protocol.ts` first, then the server handler, then the client call.
- New character fields: add to `CharacterData` + `DEFAULT_CHARACTER` and to the validator in `shared/src/character.ts`. Old saved characters are merged onto the defaults, so adding fields needs no migration.
- Rules logic goes in `shared/src/rules.ts` with unit tests, never inline in components.
- Spell slots, limited-use features and rests live in `shared/src/resources.ts`: maximums are computed (`spellSlots()`, `limitedUses()`), only the spent counts are stored in `CharacterData.used`; `customResources` holds hand-added ones. UI in `client/src/Uses.tsx`. Hit Dice live there too: one per level, spent count in `used.hitDice`, `hitDieSize()` (the sheet's `hitDie` for homebrew classes, else the class's from the content, else d8), `spendHitDie()`, `canSpendHitDice()`.
- Dice roller rules are pure in `shared/src/dice.ts` (`planRoll()` says what a tap rolls and why, `rollPlan()` throws it with an injected die, `describeRoll()` is the DM's one-liner). Exhaustion's -2 per level is applied to every d20 roll. New things to roll: add a `RollRequest` kind there, with tests.
- Conditions, concentration and death saves: rules in `shared/src/status.ts` (`applyDamageOrHealing()` is what `character:adjustHp` runs: death saves at 0 HP, concentration save DC after damage), UI in `client/src/Status.tsx`. Conditions and Exhaustion are set by the DM only; condition texts come from the content (`conditions` in a pack).
- Level-up: `shared/src/levelup.ts` (`levelUpPlan()` says what the next level brings and which steps are needed, `applyLevelUp()` validates and builds the change; the server runs it). UI is `client/src/creator/LevelUp.tsx`, opened by the character's owner: from the sheet's Main tab outside sessions, from the banner on `ClassicSheet` in a session. `character:levelUp` is owner-only; in a session it also needs `CharacterData.levelUpReady`, a DM-only flag that the level-up clears.
- Store raw inputs, compute derived values (see Part 2, section 7).
- Only bundle SRD (CC-BY-4.0) content; anything else is user-entered homebrew.
- **Game content** (`shared/src/content/`): `srd.json` is the SRD 5.2 pack (generated, don't hand-edit; credit in `SRD-LICENSE.md` and the creator footer). `Content` merges packs (later wins by id). The client loads SRD lazily via `import('@dnd/shared/srd')` plus extra packs from `GET /api/content` (`useContent()`); the server reads them from `server/data/content/*.json` (git-ignored, for homebrew and text typed in from the group's own PHB). Never commit non-SRD book text.
- **Packs can give features a counter:** `uses` (`UsesDef` in `shared/src/content/types.ts`) on a class or subclass feature, species trait, lineage option or feat. `limitedUses(c, content)` adds one per feature ref on the sheet (id `f:<ref>`, `packUseId()`); `applyUse()` and `applyRest()` take the content for that. The SRD's own counters stay hardcoded in `resources.ts`. `parsePack()` also checks what is nested in an entry (features, traits, `uses`), `packWarnings()` finds ids that point at nothing, and `server/src/phbChecklist.ts` holds the PHB's entry names (names only) for the coverage report.
- Characters point into content by `ref` (spells, items) and feature refs like `class:wizard:Spellcasting` (`describeRef()`); homebrew entries carry their own `description`. Wrap anything with a description in `<Info entry>` (client/src/Info.tsx): hold on phones / hover on PC shows it, and it works in read-only sheets.
- **Portraits:** the picture is stored in the `portraits` table (not in the character JSON); `CharacterData.portrait` is only a version stamp. `PUT`/`DELETE /api/characters/:id/portrait` (owner only, raw image body, shrunk to 400x600 JPEG in the browser first), `GET /api/portraits/:id?v=<version>`. `client/src/Portrait.tsx` draws a default when there is none.
- **Languages** (`shared/src/i18n.ts`, German in `shared/src/i18n/de.ts`, client helpers in `client/src/i18n.tsx`): the code is written in English and the English text is the key. Every text a person reads goes through `t('Join a session')`, `t('{who} took {n} damage.', { who, n })`, `plural(n, '{n} round', '{n} rounds')`, or `tj('Joining {campaign}.', { campaign: <strong>…</strong> })` when something is drawn inside the sentence. One English word with two meanings gets a context after `##` (`t('Light##theme')`, `t('Level {n}##spell')` is "Grad", `t('Giant##language')`). A text built at module level is marked with `msg('Roster')` and drawn with `t(tab.label)`. **The server never sets a language and always writes English**: stored data (characters, `lastAction`, the session log) and every `error` stay English, and the phone translates them when it draws them, with `tx(text)`: the whole text, then the dictionary's sentences with their `{placeholders}` turned into patterns (only those in `DE_ANYWHERE`, the part for texts made by the rules or the server; `{n}`-like placeholders match numbers only), then a few shapes (a roll line, "12/20 HP", "5 gp", "2× Rope", "Name (detail)"). What `tx()` doesn't know comes back unchanged, so made-up names pass through. Rules: never store or compare a translated text (`toEnglish()` turns a typed "Magier" back into "Wizard" before it is saved); a new text needs its German in `de.ts`, or `shared/src/i18n.test.ts` fails (it reads every `t()`/`tj()`/`msg()`/`plural()` and every server `error` out of the code, checks the placeholders, and checks that no SRD spell, item or feature name is bent by `tx()`); content words shown on a screen go through `tx()` (`tx(c.className)`), rules texts of the content through `ruleText('condition:blinded', english)`; dice in a formula through `diceText('1d8')`. German words are longer: where one didn't fit, `styles.css` has a small `:lang(de)` rule (the root element carries `lang`). A third language is a dictionary file, an entry in `LANGUAGES`/`LANGUAGE_NAMES`, and its ordinals and dice letter in `i18n.ts`.
- **Helper texts:** any text that only explains how to use the screen ("Tap a player to open their sheet…", "Hold for details.") gets the `hint` class, so the Settings switch can hide it (`:root[data-hints='off'] .hint`). Status, empty-list messages and rules a player needs for a choice are not hints.
- **Themes:** every colour in `styles.css` is a token (`--bg`, `--text`, `--muted`, `--edge`, `--edge-strong`, `--rule`, `--accent`/`--on-accent` for the main button, `--red` for damage and fights, `--gold`, `--ok`, `--warn`, `--bad`, `--info` and their `-dim`/`-text` variants), defined once per theme at the top of the file (`:root`, `[data-theme='light']`, `[data-theme='black']`). Never write a colour straight into a rule. Exception: things drawn on portraits (party cards, lobby seats) are light-on-dark pictures in every theme; the light theme re-pins the dark tokens inside them. `index.html` sets the saved theme before the app loads.
- **Fonts:** two, both served by the app itself (`client/src/fonts/`, no font service, precached by the PWA; SIL Open Font License, texts in `client/public/licenses/`): **Alegreya** (`--font-display`) for titles and names (page and panel titles, the home menu, character, campaign and opponent names, handouts, the words of alerts and moments) and **Source Sans 3** (`--font-body`) for everything else: numbers, labels, lists, buttons, running text. Never name a font in a rule; a new title joins the list of selectors under `body` in `styles.css`. Alegreya looks a size smaller than the body font (give titles a step more) and has old-style figures unless `font-variant-numeric: lining-nums` (set in that list). Source Sans 3's figures are tabular as they come, so columns of numbers line up. Only the Latin and Latin Extended files are in the repo (ä ö ü ß are in the Latin one); both are variable fonts, so any weight works. `index.html` preloads the two Latin files.
- **Look:** dark by default, and **outline-only** in every theme: no lighter filled boxes behind text anywhere (cards, panels, chips, badges, notices, secondary buttons, selected tabs are all a border on the page colour; Faris's feedback, twice). The only fills are the red main action button, Damage/Heal, HP and progress bars, and portraits. Overlays (drawer, bottom sheets, pager pill) use the page colour with a border. New UI follows this. Screens outside a session that have sections use `Panel` (tabs down the left), not a row of tab boxes; the row of tabs (`.tabs`) is only left where the full width is needed (the sheet, the DM's Tools page).
- **Motion:** every animation lives in `client/src/motion.css` (loaded after `styles.css`, which keeps the static look of the same pieces). One switch for all of it: `<html data-motion="on|off">`, set by `settings.ts` from the Settings switch and `prefers-reduced-motion`; `motionOn()` is the same for code. Rules: an element's normal CSS is its resting look and keyframes only describe the way there or the excursion (so with motion off it simply is there); things that flash are `opacity: 0` at rest; only `transform` and `opacity` move on anything big; colours come from the tokens (`color-mix` for see-through). Effects go through the small bus in `client/src/fx/fx.ts`: `burst(kind, origin?, tint?)` (at the last tap by default), `screenFx(kind)`, `move(el, 'shake' | 'pop')`, drawn by `FxLayer` over the app. `fx/hooks.ts` has `useDelta`, `useTween`, `useFresh`, `useClosing` (play the leaving animation, then unmount) and `useScene` (screens with a leaving phase); `fx/sheetFx.tsx` has the hit-point pieces and `useCharacterFx()`, which turns changes of a character into effects. Words that every phone concerned should read for a moment go through the second small bus, `client/src/session/moments.ts`: `announce({ tone, title, kicker?, sub? })`, drawn once by `MomentLayer` in `SessionView`; `useFightMoments()` announces the fight's. A new kind of moment is a `MomentTone` with its time in `MOMENT_MS` and its colour in `.moment-alert.<tone>`; they keep showing with animations off. Things that slide up from the bottom use `BottomSheet.tsx`. What the phones need to know to pick an effect travels with the data: `LastAction.kind` (`spell | attack | feature | heal`) and `session:alert { kind: 'rest', rest, characterId? }` next to the fight alert. A new effect: a `BurstKind` or `ScreenKind` in `fx.ts` (with its lifetime in `FX_MS`), its pieces in `FxLayer.tsx`, its keyframes in `motion.css`.
- Character creation logic (choices, per-step checks, building the sheet) is pure and tested in `shared/src/creation.ts`; the UI is `client/src/creator/CharacterCreator.tsx`, a linear step-by-step flow whose draft is kept in localStorage until the character is created.

## Status
Rough working prototype (Faris will add feature ideas over time). Done: accounts, home menu, character roster, campaigns, lobby with ready-up and (forced) start, read-only sheets for players in session, live party view, DM live edits. Guided character creator (class, background, species, scores, equipment, spells, review; every choice a dropdown of SRD + pack options, with a Homebrew option), descriptions on hold/hover for spells, items and features, rulebook pickers on the sheet. The sheet has tabs: **Main** (HP box, AC, initiative, speed, PB, passive Perception, identity), **Abilities** (six scores, saves, skills with proficiency/expertise), **Items** (coins + inventory), **Spells** (spellcasting ability, save DC, attack, spell list with prepared flag), **Features** (features/traits/feats list with descriptions, plus free-text notes). Derived numbers come from `deriveStats()` in `shared/src/rules.ts`.
Spell slots and limited uses are tracked (Cast/Use buttons on the in-session sheet, DM calls Short/Long Rests, last action shown in the party list). Conditions and Exhaustion (DM sets them, players see badges with the rules text), concentration (set when a concentration spell is cast, save reminder after damage), death saves at 0 HP, and a step-by-step level-up wizard (HP, subclass, feat/ASI, new spells) are in. Settings: helper texts on/off, dice roller on/off, three themes, English or German. Own fonts (Alegreya and Source Sans 3). Hit Dice on Short Rests, the optional dice roller, campaign backup (save and load a file). Private packs can give features use counters, and `npm run content` reports what of the PHB is still missing (the PHB pack itself is being built from Faris's page photos, outside the repo). Campaign Configure (handouts, NPCs/opponents), handouts pushed to players, Initiate fight with pulse + vibration, initiative and turn tracker, session log with recap. Session title card and end-of-session summary, turn / round / fight-over banners, opponents hidden until revealed, Heroic Inspiration, the DM's "Who is best at…" list. Not yet: conditions on opponents, hiding that an opponent is there at all (a hidden one still has its line in the turn order), rerolling with Heroic Inspiration inside the dice roller, per-player handouts, DM free-text session notes, dice roller for spell damage, death saves and NPCs, automatic backups, free once-per-rest casts from species/feats (add as a custom limited use), multiclassing, AC recalculation when armor or abilities change after creation, Fighting Style picks. Hosting is prepared two ways: on Fly.io (Faris creates the account and deploys with `docs/hosting.md`) and from his own Windows PC through a Cloudflare Tunnel (`npm run host`, `docs/self-hosting.md`; the Windows-only parts, autostart and keep-awake, and a real tunnel have not been run on his PC yet). Managing accounts is still the command line tool.

**The group plays the 2024 rules** (confirmed by Faris, 2026-11-19). Build 2024 logic; 2014 support is not needed for now.

---

# Part 2 — Rules reference

Reference notes for building a web app that replaces our paper Dungeons & Dragons character sheets with interactive digital ones. This is an **overview** of how the game works; deeper dives into specific systems come later.

> Written Nov 2026. Rules summarized in our own words from the free **System Reference Document (SRD)** and public material. Do not paste copyrighted book text (flavor text, non-SRD subclasses, spells, or monsters) into the app. See *Licensing* at the bottom.

---

## 0. Edition cheat sheet

| Name | Released | Free rules text | Notes |
|---|---|---|---|
| **5e "2014"** | 2014 | SRD 5.1 (CC-BY-4.0) | What most tables learned on. Still widely played. |
| **5e "2024" / "5.5e" / "D&D (2024)"** | PHB Sep 2024, DMG Nov 2024, Monster Manual Feb 2025 | **SRD 5.2 / 5.2.1** (CC-BY-4.0, Apr 2025) | Current official rules. Backward compatible with 2014 adventures. |

**This app uses the 2024 rules** (our group plays 2024). 2014 differences are noted only for reference.

Biggest 2014 → 2024 differences that change a character sheet:
- "Race" is renamed **Species**, and species **no longer give ability score bonuses**.
- **Background** gives the ability bonuses (+2/+1 or +1/+1/+1 among three listed abilities), **an Origin feat**, two skills, a tool, and starting gear.
- **Every class gets its subclass at level 3** (2014 varied: 1, 2 or 3).
- **Weapon Mastery**: martial classes unlock special properties (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) on chosen weapons.
- **Exhaustion** is a simple 1–6 track: −2 per level to every d20 roll and −5 ft speed per level; level 6 = death. (2014 had a 6-step table of different penalties.)
- **Long rest restores all spent Hit Dice** (2014: half).
- **Heroic Inspiration** replaces Inspiration (reroll any die; Humans get it each long rest).
- Ability Score Improvements are now a **feat** you pick at 4/8/12/16; level 19 grants an **Epic Boon** feat.
- New named actions: **Influence, Magic, Search, Study, Utilize** join Attack, Dash, Disengage, Dodge, Help, Hide, Ready.

---

## 1. What D&D is

A cooperative, collaborative storytelling game. One person is the **Dungeon Master (DM)**; everyone else is a **player** who controls one **player character (PC)**. There is no board required and no "winning": the group tells a story together, and dice decide uncertain outcomes.

The core loop, repeated all session:
1. **The DM describes** the situation.
2. **Players say what their characters do.**
3. **The DM decides the result**, often asking for a die roll, then narrates what happens.

The three **pillars of play**: **Combat**, **Exploration**, **Social Interaction**.

### Dice
d4, d6, d8, d10, d12, d20 (and "d100" = two d10s). Notation: `2d6+3` = roll two six-sided dice, add 3.

### The one core mechanic: the d20 Test
Roll a d20, add modifiers, compare to a target number. Meet or beat it = success. Three kinds:
- **Ability check** vs a **Difficulty Class (DC)** set by the DM (Very Easy 5, Easy 10, Medium 15, Hard 20, Very Hard 25, Nearly Impossible 30).
- **Saving throw** vs a DC, to resist something (a trap, a spell).
- **Attack roll** vs the target's **Armor Class (AC)**.

**Advantage**: roll 2d20, keep higher. **Disadvantage**: roll 2d20, keep lower. They don't stack; having both cancels out.
**Natural 20** on an attack = automatic hit + **critical hit** (roll the damage dice twice). **Natural 1** on an attack = automatic miss. (2024: a natural 20 on checks/saves has no special rule by default; many tables house-rule it.)

---

## 2. How players play

- Build a character (section 4), bring the sheet, and describe actions in the fiction ("I search the desk"); the DM calls for rolls.
- Track their own HP, spell slots, resources, inventory, and conditions. **This tracking is exactly what our app automates.**
- Level up after earning **experience points (XP)** or by **milestone** (DM says "you level up").
- Make choices in character: personality, goals, alignment, relationships.

## 3. How the DM plays

The DM is referee, narrator, and plays every non-player character (**NPC**) and monster.
- Prepares or runs an **adventure** (homebrew or published).
- Describes the world, sets DCs, calls for checks, adjudicates rules ("rulings over rules").
- Runs combat: controls monsters, tracks their HP, initiative, and conditions.
- Awards XP / milestones and **treasure** (gold, magic items).
- Paces the session and keeps it fun for everyone; often uses a **DM screen** to hide notes/rolls.
- Can grant **Heroic Inspiration** for great roleplay.

### Campaigns: how they are built
- **One-shot**: single session. **Adventure**: a few sessions with one goal. **Campaign**: a long series of linked adventures, often levels 1–20 over months/years.
- **Session 0**: the group agrees on tone, content limits (safety tools like "lines and veils"), house rules, and how characters know each other.
- Typical DM build process: setting/world → central conflict/villain → starting location & hook → adventures broken into **scenes/encounters** (combat, social, exploration, traps, puzzles) → NPCs → rewards. Published campaigns (e.g. official hardcover adventures) provide all of this pre-made.
- **Encounter building (2024 DMG)**: each PC contributes an XP budget by level and difficulty (Low / Moderate / High); the DM spends the budget on monsters using each monster's XP value from its **Challenge Rating (CR)**.
- **Adventuring day**: several encounters between rests; short and long rests are the resource-recovery rhythm that shapes play.
- **Tiers of play**: 1–4 local heroes, 5–10 heroes of the realm, 11–16 masters of the realm, 17–20 masters of the world.

### Monster stat blocks (for possible DM tools later)
Size, type, alignment · AC · HP (with dice formula) · Speed · six ability scores · saves/skills · resistances/immunities · senses (incl. passive Perception) · languages · CR & XP · proficiency bonus · Traits · Actions · Bonus Actions · Reactions · Legendary Actions.

---

## 4. The character sheet (field by field)

Derived values are marked **[derived]** with their formula. This section is the backbone of the data model.

### 4.1 Identity
- Character name, player name
- **Class(es) and level(s)** (multiclass = list of class+level); **subclass** per class (chosen at level 3 in 2024)
- **Total character level** [derived] = sum of class levels
- **Species** (2014: Race) and lineage/subrace where applicable
- **Background**
- **Alignment**: Lawful/Neutral/Chaotic × Good/Neutral/Evil (9 options)
- **Experience points**
- Size (Small/Medium; full list Tiny→Gargantuan), age, height, weight, eyes, hair, skin, appearance, portrait
- Personality, ideals, bonds, flaws (2014 sheet has dedicated boxes; 2024 treats them as optional), backstory, allies & organizations

### 4.2 Ability scores (the six)
**Strength (STR), Dexterity (DEX), Constitution (CON), Intelligence (INT), Wisdom (WIS), Charisma (CHA).**
- Score usually 3–20 for PCs (cap 20 except special features; max 30).
- **Modifier** [derived] = `floor((score − 10) / 2)` → 10–11 = +0, 12–13 = +1, 8–9 = −1, 20 = +5.
- Generating scores: **Standard Array** 15,14,13,12,10,8 · **Point Buy** 27 points, scores 8–15 (costs: 8=0, 9=1, 10=2, 11=3, 12=4, 13=5, 14=7, 15=9) · **Roll** 4d6 drop lowest, six times.
- Then apply background (2024) or race (2014) bonuses, then feats/ASIs.

### 4.3 Proficiency bonus [derived from total level]
| Level | 1–4 | 5–8 | 9–12 | 13–16 | 17–20 |
|---|---|---|---|---|---|
| PB | +2 | +3 | +4 | +5 | +6 |
Formula: `2 + floor((level − 1) / 4)`.

### 4.4 Saving throws
One per ability. **Bonus** [derived] = ability mod + (PB if proficient). Each class grants two save proficiencies (first class only, when multiclassing).

### 4.5 Skills (18)
**Bonus** [derived] = ability mod + PB if proficient (×2 PB with **Expertise**; some features add half PB, e.g. Bard's Jack of All Trades).

| Ability | Skills |
|---|---|
| STR | Athletics |
| DEX | Acrobatics, Sleight of Hand, Stealth |
| INT | Arcana, History, Investigation, Nature, Religion |
| WIS | Animal Handling, Insight, Medicine, Perception, Survival |
| CHA | Deception, Intimidation, Performance, Persuasion |

### 4.6 Combat block
- **Armor Class** [derived]: unarmored 10 + DEX · light armor = base + DEX · medium = base + DEX (max +2) · heavy = flat base (STR requirement or −10 ft speed) · **shield +2** · class alternatives (Barbarian 10+DEX+CON, Monk 10+DEX+WIS) · plus magic items/spells.
- **Initiative** [derived] = DEX mod + bonuses (2024 Alert feat adds PB).
- **Speed** (usually 30 ft; species/armor/exhaustion modify it); other speeds: climb, swim, fly.
- **Hit Points**: maximum, current, **temporary** (don't stack; take the higher; lost first).
  - Max HP [derived] = level 1: max of class Hit Die + CON mod; each later level: roll the Hit Die or take the fixed value (d6→4, d8→5, d10→6, d12→7) + CON mod. CON changes apply retroactively to every level.
- **Hit Dice**: pool = one die per level of its class type; track spent vs total.
- **Death saving throws**: 3 success / 3 failure boxes (see 5.5).
- **Heroic Inspiration** checkbox (2014: Inspiration).
- **Passive Perception** [derived] = 10 + Perception bonus (+5 with advantage, −5 with disadvantage). Some sheets also show passive Insight / Investigation.
- **Exhaustion level** 0–6 and current **conditions**.
- **Resistances / immunities / vulnerabilities** to damage types.

### 4.7 Attacks
Each row: name, attack bonus, damage dice + type, notes (range, properties, mastery).
- **Weapon attack bonus** [derived] = ability mod + PB (if proficient with the weapon) + magic bonus. Melee uses STR; ranged uses DEX; **Finesse** weapons pick the higher.
- **Damage** [derived] = weapon dice + same ability mod (+ magic). Off-hand **Light** weapon extra attack doesn't add a positive mod unless a feature allows.
- Weapon properties: Ammunition, Finesse, Heavy, Light, Loading, Range, Reach, Thrown, Two-Handed, Versatile (+ 2024 **Mastery** property).
- **13 damage types**: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder.

### 4.8 Spellcasting (per casting class)
- **Spellcasting ability**: INT (Wizard), WIS (Cleric, Druid, Ranger), CHA (Bard, Paladin, Sorcerer, Warlock).
- **Spell save DC** [derived] = 8 + PB + spellcasting mod.
- **Spell attack bonus** [derived] = PB + spellcasting mod.
- **Cantrips known**, **spells prepared** (2024: every class prepares from a list, count set by class level table), spellbook (Wizard).
- **Spell slots** levels 1–9: total and expended. Full/half/third-caster progression; multiclass uses a combined table. **Warlock Pact Magic** slots are separate, all same level, recover on a **short** rest.
- Per spell: level, school (Abjuration, Conjuration, Divination, Enchantment, Evocation, Illusion, Necromancy, Transmutation), casting time, range, components (**V**erbal, **S**omatic, **M**aterial), duration, **Concentration** flag, **Ritual** flag.
- **Concentration**: one concentration spell at a time; on taking damage, CON save DC = max(10, half damage) (2024 caps at 30). Track "currently concentrating on X".

### 4.9 Features, traits & feats
Free-text-plus-structured list from: class features (by level), subclass features, species traits (e.g. Darkvision, Lucky), background feature (2014) / origin feat (2024), feats. Many have **limited uses** that reset on a short or long rest, or scale with level/PB. **Each needs a uses counter and a reset type** in the app.

2024 feat categories: **Origin** (level 1, via background), **General** (level 4+, includes Ability Score Improvement), **Fighting Style**, **Epic Boon** (level 19+).

### 4.10 Proficiencies & languages
Armor (light/medium/heavy/shields), weapons (Simple/Martial, or specific), tools (artisan's tools, thieves' tools, instruments, gaming sets, kits), languages (Common + others; standard: Common Sign Language, Draconic, Dwarvish, Elvish, Giant, Gnomish, Goblin, Halfling, Orc; rare: Abyssal, Celestial, Deep Speech, Druidic, Infernal, Primordial, Sylvan, Thieves' Cant, Undercommon).

### 4.11 Equipment & money
- Item list: name, quantity, weight, equipped/attuned flags, notes.
- **Attunement**: max 3 attuned magic items.
- **Coins**: cp, sp, ep, gp, pp (10 cp = 1 sp; 10 sp = 1 gp; 1 ep = 5 sp; 1 pp = 10 gp). 50 coins weigh 1 lb.
- **Carrying capacity** [derived] = STR score × 15 lb (Small/Medium); drag/lift/push = × 30. Size changes this.

---

## 5. Core rules the app will need to model

### 5.1 Turn structure (combat)
1. Determine surprise (2024: surprised creatures roll initiative with disadvantage).
2. Everyone rolls **initiative** (d20 + DEX mod); act in descending order.
3. Each round ≈ 6 seconds. On your turn: **Movement** (up to speed, can split), **one Action**, **one Bonus Action** (only if a feature grants one), one free **object interaction**. **One Reaction** per round (e.g. Opportunity Attack), refreshed at the start of your turn.
4. Actions (2024): Attack, Dash, Disengage, Dodge, Help, Hide, Influence, Magic, Ready, Search, Study, Utilize.

### 5.2 Damage & healing
Subtract damage from temp HP first, then HP. **Resistance** halves, **vulnerability** doubles, **immunity** negates. Healing can't exceed max HP; healing a creature at 0 HP brings it back conscious.

### 5.3 Rests
- **Short Rest** (1 hour): spend Hit Dice, each heals die + CON mod. Some features recharge.
- **Long Rest** (8 hours, once per 24h): regain all HP, all Hit Dice (2014: half), all spell slots, long-rest features; reduce Exhaustion by 1.

### 5.4 Conditions (2024 list of 15)
Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious. Each has defined mechanical effects (advantage/disadvantage, speed 0, auto-fail saves, etc.) worth encoding as toggles with tooltips.

### 5.5 Dropping to 0 HP
Fall **Unconscious**; at the start of each turn roll a **death save** (d20, no modifiers): 10+ success, 9− failure. **3 successes** = Stable; **3 failures** = dead. Natural 20 = regain 1 HP; natural 1 = two failures. Taking damage at 0 HP = one failure (crit = two). **Instant death** if leftover damage ≥ max HP.

### 5.6 Levelling up
**XP thresholds** (level: XP): 1:0 · 2:300 · 3:900 · 4:2,700 · 5:6,500 · 6:14,000 · 7:23,000 · 8:34,000 · 9:48,000 · 10:64,000 · 11:85,000 · 12:100,000 · 13:120,000 · 14:140,000 · 15:165,000 · 16:195,000 · 17:225,000 · 18:265,000 · 19:305,000 · 20:355,000.
On level up: +Hit Die & HP, new class features, maybe new spells/slots, PB may increase, feat at 4/8/12/16 (+19 Epic Boon in 2024), subclass at 3.

### 5.7 Multiclassing
Requires 13+ in the primary ability of both current and new class. You gain only some of the new class's proficiencies, and spell slots combine on the multiclass table.

---

## 6. Player's Handbook overview (2024)

The PHB is the player-facing rulebook. Structure (paraphrased):
1. **Playing the Game**: the d20 Test, actions, social/exploration/combat, damage & healing.
2. **Creating a Character**: step-by-step build, levelling, multiclassing, trinkets.
3. **Character Classes**: 12 classes, 4 subclasses each (48 total).
4. **Character Origins**: 16 backgrounds and 10 species.
5. **Feats**.
6. **Equipment**: weapons (with mastery), armor, tools, adventuring gear, mounts, services, crafting.
7. **Spells**: spell rules + spell descriptions (~390 spells).
- Appendices: the multiverse, creature stat blocks (familiars, mounts, Wild Shapes), and a **Rules Glossary** (precise definitions of every game term; very useful for the app's tooltips).

### The 12 classes
| Class | Hit Die | Primary ability | Save proficiencies | SRD subclass | Quick role |
|---|---|---|---|---|---|
| Barbarian | d12 | STR | STR, CON | Path of the Berserker | Rage-fuelled tank |
| Bard | d8 | CHA | DEX, CHA | College of Lore | Support caster, skills |
| Cleric | d8 | WIS | WIS, CHA | Life Domain | Divine caster, healer |
| Druid | d8 | WIS | INT, WIS | Circle of the Land | Nature caster, Wild Shape |
| Fighter | d10 | STR or DEX | STR, CON | Champion | Weapon expert |
| Monk | d8 | DEX & WIS | STR, DEX | Warrior of the Open Hand | Unarmed, mobile |
| Paladin | d10 | STR & CHA | WIS, CHA | Oath of Devotion | Holy warrior, smites |
| Ranger | d10 | DEX & WIS | STR, DEX | Hunter | Skirmisher, tracker |
| Rogue | d8 | DEX | DEX, INT | Thief | Sneak Attack, skills |
| Sorcerer | d6 | CHA | CON, CHA | Draconic Sorcery | Innate caster, Metamagic |
| Warlock | d8 | CHA | WIS, CHA | Fiend Patron | Pact Magic, Invocations |
| Wizard | d6 | INT | INT, WIS | Evoker | Spellbook, versatile |

(Artificer exists in a separate book, not the PHB.) Weapon Mastery classes: Barbarian, Fighter, Paladin, Ranger, Rogue.

### Species (2024 PHB)
Aasimar, Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling. (SRD 5.2 includes all except Aasimar.) 2014 PHB had Dwarf, Elf, Halfling, Human, Dragonborn, Gnome, Half-Elf, Half-Orc, Tiefling.

### Backgrounds (2024 PHB)
Acolyte, Artisan, Charlatan, Criminal, Entertainer, Farmer, Guard, Guide, Hermit, Merchant, Noble, Sage, Sailor, Scribe, Soldier, Wayfarer. (SRD 5.2 includes Acolyte, Criminal, Sage, Soldier.)

### Character creation steps (2024)
1. Choose a **class**.
2. Determine **origin**: background (ability bonuses, origin feat, skills, tool, equipment) + species (traits, size, speed) + two languages.
3. Determine **ability scores**.
4. Choose **alignment**.
5. Fill in details: derived numbers, equipment, spells, personality.

---

## 7. Implications for the app (starting notes)

- Store **raw inputs** (scores, choices, level, items, proficiencies) and **compute derived values** (modifiers, PB, saves, skills, AC, attack bonuses, spell DC, passive scores, carry weight). Allow manual overrides for house rules and odd items.
- Model **resources** generically: `{ name, current, max, resetOn: short|long|dawn|none }` covers spell slots, Hit Dice, Rage, Ki/Focus, Channel Divinity, item charges, etc. One-click **Short Rest / Long Rest** buttons.
- Live session tools: HP damage/heal/temp HP, conditions, exhaustion, concentration, death saves, inspiration, dice roller with advantage/disadvantage.
- Support **2014 vs 2024** as a per-character or per-campaign setting.
- Content: only **SRD** content can be bundled; let users enter **homebrew/custom** entries for anything else (non-SRD subclasses, spells, items they own in their books).
- Possible later features: party/campaign view for the DM, initiative tracker, shared notes, level-up wizard.

---

## Licensing & sources

- **SRD 5.2.1** (2024 rules) and **SRD 5.1** (2014 rules) are released by Wizards of the Coast under **Creative Commons Attribution 4.0**. We may use their content with attribution, e.g. *"This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd, licensed under CC-BY-4.0."*
- "Dungeons & Dragons", "D&D", and non-SRD content (most subclasses, many spells/monsters, setting names, art) are **not** open. Don't bundle them; let players enter their own.

Sources:
- SRD v5.2.1 — https://dndbeyond.com/srd
- "You Can Now Publish Your Own Creations Using the New Core Rules" (D&D Beyond) — https://www.dndbeyond.com/posts/1949-you-can-now-publish-your-own-creations-using-the
- "What's New in the 2024 Player's Handbook" (D&D Beyond) — https://www.dndbeyond.com/posts/1745-whats-new-in-the-2024-players-handbook
- SRD 5.2 changes (Wargamer) — https://www.wargamer.com/dnd/srd-5-2-changes
- 2024 PHB backgrounds & free feats (PC Gamer) — https://pcgamer.com/games/rpg/everyone-gets-a-free-feat-and-a-more-mechanically-impactful-background-in-dandds-2024-players-handbook
