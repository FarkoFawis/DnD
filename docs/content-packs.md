# Content packs (homebrew and your own books)

The app ships with the free **SRD 5.2** rules (2024): 12 classes with one
subclass each, 9 species, 4 backgrounds, 17 feats, 339 spells and ~440 items.
Everything else (the other PHB subclasses, backgrounds, species, spells,
homebrew) is added as a **content pack**: a JSON file on the server.

- Put packs in `server/data/content/` (or the folder in `CONTENT_DIR`).
  `server/data/` is git-ignored, so **packs are never committed or published**.
  Keep it that way for text typed in from a book you own.
- Packs are served only to logged-in players (`GET /api/content`) and merged on
  top of the SRD. An entry with the same `id` as an SRD entry replaces it.
  Files load in name order, so `20-house-rules.json` overrides `10-phb.json`.
- Players see new entries in every dropdown after reloading the app. Info popups
  show "From: <pack name>" for anything that isn't SRD.
- Check the packs with `npm run content`: it lists what was loaded, every entry
  it had to leave out (with the reason), entries that load but look wrong (an id
  that points at nothing, the same spell entered twice), and how much of the
  2024 Player's Handbook the app now has. `npm run content -- missing` names
  what is still missing.
- Put a pack file in the folder with `npm run content -- add <file>`: it checks
  the file first, creates the folder if needed and replaces an older file of the
  same name. A running server picks the change up by itself within a few
  seconds; players see it after reloading the app.

Without a pack, players can still pick **Homebrew / custom** in any dropdown and
type the entry in themselves (stored on that one character only).

## Format

Only `id` and `name` plus the fields marked *required* are needed; the rest is
optional. Text fields use `**Bold.**` run-in headings and newlines for
paragraphs, like the SRD. Ability ids: `str dex con int wis cha`. Skill ids:
`acrobatics animalHandling arcana athletics deception history insight
intimidation investigation medicine nature perception performance persuasion
religion sleightOfHand stealth survival`.

```json
{
  "id": "phb",
  "name": "Player's Handbook (our copy)",
  "subclasses": [
    {
      "id": "school-of-divination", "classId": "wizard", "name": "Diviner",
      "summary": "One line summary",
      "features": [
        { "level": 3, "name": "Portent", "description": "...",
          "uses": { "max": [[3, 2], [14, 3]], "resetOn": "long" } }                 // optional counter, see "Limited uses"
      ]
    }
  ],
  "backgrounds": [
    {
      "id": "noble", "name": "Noble",
      "abilities": ["str", "int", "cha"],            // required, exactly 3
      "skills": ["history", "persuasion"],            // required
      "feat": "skilled", "tool": "One Gaming Set",
      "equipment": [
        { "label": "A", "gp": 29, "items": [{ "ref": "clothes-fine", "qty": 1 }] },
        { "label": "B", "gp": 50, "items": [] }
      ]
    }
  ],
  "species": [
    {
      "id": "aasimar", "name": "Aasimar", "size": "Small or Medium", "speed": 30,   // size & speed required
      "traits": [
        { "name": "Celestial Resistance", "description": "..." },
        { "name": "Healing Hands", "description": "...", "uses": { "max": 1, "resetOn": "long" } }
      ]
    }
  ],
  "feats": [
    { "id": "lucky", "name": "Lucky", "category": "origin", "description": "...",   // category required
      "uses": { "max": "pb", "resetOn": "long", "name": "Luck Points" } }
  ],
  "spells": [
    {
      "id": "witch-bolt", "name": "Witch Bolt", "level": 1,                // level 0-9 required
      "classes": ["sorcerer", "warlock", "wizard"],                         // required
      "school": "...", "castingTime": "...", "range": "...",
      "components": "...", "duration": "...",
      "concentration": true, "ritual": false,
      "description": "...", "higherLevels": "..."
    }
  ],
  "items": [
    { "id": "magic-my-sword", "name": "Sword of Bob", "kind": "magic",     // kind required: weapon|armor|gear|tool|magic
      "category": "Weapon (Longsword)", "rarity": "Rare", "attunement": true, "description": "..." }
  ],
  "classes": [
    {
      "id": "artificer", "name": "Artificer", "hitDie": 8,                  // hitDie 6|8|10|12 required
      "saves": ["con", "int"],                                              // required
      "skillChoices": { "choose": 2, "from": ["arcana", "history"] },       // required
      "proficiencies": ["Light Armor", "Medium Armor", "Shields", "Simple Weapons"],
      "spellcasting": { "ability": "int", "levels": [{ "cantrips": 2, "prepared": 2, "slots": [2,0,0,0,0,0,0,0,0] }] },
      "features": [{ "level": 1, "name": "Tinker's Magic", "description": "..." }]
    }
  ]
}
```
(JSON doesn't allow the `//` comments; they are only here to explain.)

The full set of fields is the TypeScript types in `shared/src/content/types.ts`.

### Limited uses

A class or subclass feature, a species trait (or lineage option) and a feat can
carry `uses`. A character that has it then gets a counter with a **Use** button
on the sheet, next to Rage, Second Wind and the other built-in ones, and rests
give it back:

```json
"uses": { "max": "pb", "resetOn": "long", "name": "Luck Points", "pool": false }
```

- `max` (required): a number, `"pb"` (Proficiency Bonus), `"level"` (character
  level), an ability such as `"wis"` (its modifier, at least 1), or steps by
  level: `[[3, 4], [7, 5], [15, 6]]` = 4 from level 3, 5 from level 7, 6 from
  level 15.
- `resetOn` (required): `"short"` (all back on a Short or Long Rest),
  `"shortOne"` (one back per Short Rest, all on a Long Rest) or `"long"`.
- `name`: what the counter is called when that isn't the feature's own name.
- `pool`: `true` for points or dice that can be spent several at a time.

Leave `uses` away for anything without a fixed number of uses. Spent counts are
stored on the character under `f:<feature ref>`, so renaming a feature or
changing its id starts its counter fresh.

## From the book to the app

The group's own Player's Handbook is brought in from photos of its pages:

1. Photograph the pages (list below) and send them to Claude in the project.
   One page per photo, from straight above, the whole page with its heading in
   the picture, in good light without the flash, sharp enough to read the small
   print when zoomed in.
2. Claude turns them into entries of this format in one pack file, `phb.json`,
   which is kept with the project's private files and never in this repository,
   and says what it could not read.
3. Download the file and run, in the app's folder:
   `npm run content -- add "%USERPROFILE%\Downloads\phb.json"` (Windows).
   Each new version of the file replaces the one before.

## What the SRD is missing (2024 Player's Handbook)

`npm run content -- missing` prints this list for what is loaded right now. In
the order that is most useful to photograph:

1. **Backgrounds and Aasimar** (chapter 4, Character Origins): 12 of the 16
   backgrounds (Artisan, Charlatan, Entertainer, Farmer, Guard, Guide, Hermit,
   Merchant, Noble, Sailor, Scribe, Wayfarer) and the Aasimar species. Needed
   the moment someone creates a character.
2. **Feats** (chapter 5, the whole chapter): the Origin feats Crafter, Healer,
   Lucky, Musician, Tavern Brawler and Tough, which the new backgrounds point
   at, then the General feats (41 of 43 missing), Fighting Style feats (6 of 10)
   and Epic Boons (5 of 12).
3. **Subclasses** (chapter 3, the subclass pages at the end of each class), 36
   of 48 missing. The ones your players have or want first:
   - Barbarian: Wild Heart, World Tree, Zealot
   - Bard: Dance, Glamour, Valor
   - Cleric: Light, Trickery, War
   - Druid: Moon, Sea, Stars
   - Fighter: Battle Master, Eldritch Knight, Psi Warrior
   - Monk: Mercy, Shadow, Elements
   - Paladin: Ancients, Glory, Vengeance
   - Ranger: Beast Master, Fey Wanderer, Gloom Stalker
   - Rogue: Arcane Trickster, Assassin, Soulknife
   - Sorcerer: Aberrant, Clockwork, Wild Magic
   - Warlock: Archfey, Celestial, Great Old One
   - Wizard: Abjurer, Diviner, Illusionist
4. **Spells** (chapter 7): about 50 spells of the book aren't in the SRD, among
   them the Smite spells other than Divine, Searing and Shining Smite, the
   Summon spells other than Summon Dragon, Hunger of Hadar, Armor of Agathys,
   Witch Bolt, Toll the Dead, Cloud of Daggers and Steel Wind Strike. Spells are
   in alphabetical order in the book, so only those pages are needed. Every
   spell you already see in the app has its full description.
- **Magic items** beyond the SRD list come from the DMG, not the PHB.
