# CLAUDE.md — D&D Character Sheet App

Part 1 of this file describes **the codebase** (how it is built and how to work in it). Part 2 is **the rules reference** for D&D that the app models.

---

# Part 1 — Project & architecture

## What we are building
A mobile-first web app that replaces our paper character sheets. We play **in person** at a friend's house for a whole evening, with **phones only** (Android + iOS, no PCs).

## User flow (agreed with Faris)
1. **Login.** Accounts are **pre-made** by the admin (`npm run users -- add <names>`); there is no public sign-up. On first login each friend **chooses their own password**.
2. **Home:** *Join a session* (type the code shown on the DM's phone) or *Host*.
3. **Host** picks one of **their campaigns** (or creates one) and gets a 5-letter code. The DM is the campaign's owner.
4. **Characters are saved per campaign and per player.** Joining a campaign's session loads that player's character for that campaign, exactly as it was at the end of the last session. The same friend has a separate character in each campaign.
5. Ending a session only closes the live room; all characters stay saved.

## Architecture
- **Monorepo** with npm workspaces:
  - `shared/` — TypeScript used by both sides: the socket/HTTP contract (`protocol.ts`), character validation (`character.ts`), room codes, and pure rules functions (`rules.ts`). **All sheet math lives here** so client and server compute the same numbers.
  - `server/` — Node.js + Express + Socket.IO. Owns the authoritative state and persists it to **SQLite** (`node:sqlite`, file `server/data/dnd.sqlite`, override with `DB_PATH`).
  - `client/` — React + Vite + TypeScript PWA (`vite-plugin-pwa`).
- **Auth:** `POST /api/auth/status|login|logout`, `GET /api/auth/me`. Passwords hashed with scrypt; login returns a random token (stored SHA-256 hashed). 5 wrong passwords lock that username for 5 minutes. The socket connects with `auth: { token }` and is refused without a valid one.
- **Data model:** `users`, `auth_tokens`, `campaigns` (owner = DM), `characters` (PK campaign + user, JSON `data` validated by `shared/character.ts`), `live_sessions` (code ↔ campaign, at most one per campaign), `session_players`.
- **The server is the source of truth, not the DM's phone.** If the DM's phone dies, the live session, its code and every character are in the database. Each phone stores its login token and current session code in `localStorage` and re-sends `session:join` on every reconnect, so reloads, locked screens and crashes put people straight back in. A server restart loses nothing either.
- Socket handlers validate input and answer through an **ack** `{ ok: true, ... } | { ok: false, error }`. Session state is broadcast as `session:state`.

## Commands (repo root)
- `npm install` — install all workspaces (Node 22.13+ required for `node:sqlite`).
- `npm run users -- add Faris Mira` / `list` / `reset-password Mira` / `remove Mira` — manage accounts.
- `npm run dev` — server on :3001 and client on :5173. Vite is exposed on the LAN (`host: true`) and proxies `/socket.io` and `/api` to the server, so phones on the same Wi-Fi can open `http://<laptop-ip>:5173`.
- `npm test` — Vitest for `shared` and `server` (server tests run a real HTTP + Socket.IO server on a random port with an in-memory DB).
- `npm run typecheck` — `tsc --noEmit` in every workspace.
- `npm run build` then `npm start` — production: the server serves the built client from `client/dist`.

## Conventions
- TypeScript strict everywhere. `shared` is consumed as source (no build step); the server runs through `tsx`.
- Add new socket events to `shared/src/protocol.ts` first, then the server handler, then the client call.
- New character fields: add to `CharacterData` + `DEFAULT_CHARACTER` and to the validator in `shared/src/character.ts`. Old saved characters are merged onto the defaults, so adding fields needs no migration.
- Rules logic goes in `shared/src/rules.ts` with unit tests, never inline in components.
- Store raw inputs, compute derived values (see Part 2, section 7).
- Only bundle SRD (CC-BY-4.0) content; anything else is user-entered homebrew.

## Status
Done: accounts, campaigns, hosting/joining sessions with a code, per-campaign characters with name, class, species, level and HP (current, max, temp), live party view for everyone. Not yet: ability scores, skills, spells, equipment, dice, deployment. **The group plays the 2024 rules** (confirmed by Faris, 2026-11-19). Build 2024 logic; 2014 support is not needed for now.

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
