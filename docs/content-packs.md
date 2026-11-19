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
- Check a pack with `npm run content`: it lists what was loaded and every entry
  it had to skip, with the reason.

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
      "features": [{ "level": 3, "name": "Portent", "description": "..." }]
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
      "traits": [{ "name": "Celestial Resistance", "description": "..." }]
    }
  ],
  "feats": [
    { "id": "lucky", "name": "Lucky", "category": "origin", "description": "..." }  // category required
  ],
  "spells": [
    {
      "id": "chromatic-orb", "name": "Chromatic Orb", "level": 1,          // level 0-9 required
      "classes": ["sorcerer", "wizard"],                                    // required
      "school": "Evocation", "castingTime": "Action", "range": "90 feet",
      "components": "V, S, M (a diamond worth 50+ GP)", "duration": "Instantaneous",
      "concentration": false, "ritual": false,
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

## What the SRD is missing (2024 Player's Handbook)

To fill these in, photograph the pages and ask Claude to turn them into a pack
for your private `server/data/content/` folder:

- **Subclasses** (36 of 48 missing). The SRD has one per class: Berserker, Lore,
  Life, Land, Champion, Open Hand, Devotion, Hunter, Thief, Draconic Sorcery,
  Fiend Patron, Evoker. Missing (PHB chapter 3, each class's subclass section):
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
- **Backgrounds** (12 of 16 missing): Artisan, Charlatan, Entertainer, Farmer,
  Guard, Guide, Hermit, Merchant, Noble, Sailor, Scribe, Wayfarer (PHB chapter 4).
- **Species**: Aasimar (PHB chapter 4).
- **Origin feats**: Crafter, Healer, Lucky, Musician, Tavern Brawler, Tough
  (the SRD has only Alert, Magic Initiate, Savage Attacker, Skilled). Plus most
  General feats (SRD: Ability Score Improvement, Grappler), the rest of the
  Fighting Style feats and Epic Boons (PHB chapter 5).
- **Spells**: roughly 50 PHB spells aren't in the SRD (PHB chapter 7), e.g.
  Chromatic Orb and other newer spells. Every spell you already see in the app
  has its full description.
- **Magic items** beyond the SRD list come from the DMG, not the PHB.
