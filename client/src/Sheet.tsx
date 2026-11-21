import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ABILITIES,
  ABILITY_NAMES,
  COINS,
  SKILLS,
  SKILL_KEYS,
  deriveStats,
  formatModifier,
  type Ability,
  type CharacterData,
  type Item,
  type Skill,
  spellSlots,
  type DeathSaveResult,
  type DiceRoll,
  type HitDieSpent,
  type LevelUpChoices,
  type RollMode,
  type RollRequest,
  type UseRequest,
  hitDieSize,
  abilityShort,
  toEnglish,
} from '@dnd/shared';
import type { Content } from '@dnd/shared';
import { Info } from './Info.tsx';
import { AddItem, AddSpell, Features, itemEntry, spellEntry, spellGlance } from './SheetContent.tsx';
import { useContent } from './content/useContent.ts';
import { ConcentrationBanner, ConditionBadges, ConditionEditor, DeathSaves } from './Status.tsx';
import { LevelUp } from './creator/LevelUp.tsx';
import { CustomUsesEditor, RestButtons, SlotTracker, UsesList } from './Uses.tsx';
import { HitDice } from './HitDice.tsx';
import { InspirationStar, InspirationToken } from './Inspiration.tsx';
import { useSettings } from './settings.ts';
import { useFresh } from './fx/hooks.ts';
import { FlashNum, HpFx, Num, useCharacterFx } from './fx/sheetFx.tsx';
import type { Game } from './useGame.ts';
import { msg, t, tx } from './i18n.tsx';

/** Edits one character (by id). The server decides who may: owner outside sessions, DM inside. */
export interface SheetActions {
  update: (patch: Partial<CharacterData>) => Promise<boolean>;
  adjustHp: (delta: number) => Promise<boolean>;
  addItem: (item: { name: string; qty?: number; notes?: string; ref?: string }) => Promise<boolean>;
  updateItem: (itemId: string, patch: Partial<Omit<Item, 'id'>>) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
  use: (req: UseRequest) => Promise<boolean>;
  restore: (id: string) => Promise<boolean>;
  rest: (kind: 'short' | 'long') => Promise<boolean>;
  concentration: (action: 'end' | 'kept') => Promise<boolean>;
  deathSave: (result: DeathSaveResult) => Promise<boolean>;
  levelUp: (choices: LevelUpChoices) => Promise<boolean>;
  /** One Hit Die: `roll` from a real die, or none so the server rolls. Null when refused. */
  spendHitDie: (roll?: number) => Promise<HitDieSpent | null>;
  endRest: () => Promise<boolean>;
  /** The dice roller. Null when refused. */
  roll: (req: RollRequest, mode: RollMode) => Promise<DiceRoll | null>;
  /** Heroic Inspiration: the DM gives it or takes it back, the player spends it. */
  inspiration: (action: 'give' | 'take' | 'spend') => Promise<boolean>;
}

export function sheetActions(game: Game, characterId: string): SheetActions {
  return {
    update: (patch) => game.updateCharacter(characterId, patch),
    adjustHp: (delta) => game.adjustHp(characterId, delta),
    addItem: (item) => game.addItem(characterId, item),
    updateItem: (id, patch) => game.updateItem(characterId, id, patch),
    removeItem: (id) => game.removeItem(characterId, id),
    use: (req) => game.use(characterId, req),
    restore: (id) => game.restore(characterId, id),
    rest: (kind) => game.rest(characterId, kind),
    concentration: (action) => game.concentration(characterId, action),
    deathSave: (result) => game.deathSave(characterId, result),
    levelUp: (choices) => game.levelUp(characterId, choices),
    spendHitDie: (roll) => game.spendHitDie(characterId, roll),
    endRest: () => game.endRest(characterId),
    roll: (req, mode) => game.roll(characterId, req, mode),
    inspiration: (action) => game.inspiration(characterId, action),
  };
}

/** Also the tabs' names, in English: drawn with t(). */
const TABS = [msg('Main'), msg('Abilities'), msg('Items'), msg('Spells'), msg('Features')] as ['Main', 'Abilities', 'Items', 'Spells', 'Features'];
type Tab = (typeof TABS)[number];

/**
 * Local copy of the character for typing. Changes arriving from the server
 * (the DM, another tab) replace only the fields that changed there, so a field
 * you are typing in isn't wiped by someone else's edit.
 */
function useDraft(character: CharacterData) {
  const [draft, setDraft] = useState(character);
  const last = useRef(character);
  useEffect(() => {
    const prev = last.current;
    last.current = character;
    setDraft((d) => {
      const next: Record<string, unknown> = { ...d };
      for (const k of Object.keys(character) as (keyof CharacterData)[]) {
        if (JSON.stringify(character[k]) !== JSON.stringify(prev[k])) next[k] = character[k];
      }
      return next as unknown as CharacterData;
    });
  }, [character]);
  return [draft, setDraft] as const;
}

/**
 * The character sheet. With `readOnly` (players during a session) everything is
 * shown but nothing can be changed; only the DM edits then.
 */
export function Sheet({
  character,
  actions,
  title,
  readOnly = false,
  hpItemsLocked = false,
  dmUnlock = false,
  note,
  portrait,
}: {
  character: CharacterData;
  actions: SheetActions;
  title: ReactNode;
  readOnly?: boolean;
  /** Owner view: HP, items and coins are the DM's unless they unlocked them. */
  hpItemsLocked?: boolean;
  /** DM view: show the switch that lets the player change their own HP and items. */
  dmUnlock?: boolean;
  note?: ReactNode;
  /** Portrait (with its upload buttons for the owner), shown on the Main tab. */
  portrait?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('Main');
  const [levelling, setLevelling] = useState(false);
  const [draft, setDraft] = useDraft(character);
  const stats = deriveStats(draft);
  const content = useContent();
  const { dice } = useSettings();
  // The burst where a Use or Cast button was tapped, and the celebration after a level-up.
  useCharacterFx(character, content, { glow: false, ownTapsOnly: true });

  /** Set + save immediately (toggles, numbers, selects). */
  const set = <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    void actions.update({ [key]: value } as Partial<CharacterData>);
  };
  /** Text inputs: edit locally, save on blur. */
  const textProps = (key: 'name' | 'className' | 'subclass' | 'species' | 'background', max = 40) => ({
    // The rules know classes, species and backgrounds by their English names, so those are what is saved:
    // "Magier" typed in German is stored as "Wizard" and shown as "Magier" again.
    value: key === 'name' ? draft[key] : tx(draft[key]),
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => {
      const value = key === 'name' ? draft[key] : toEnglish(draft[key]);
      if (value !== draft[key]) setDraft((d) => ({ ...d, [key]: value }));
      if (value !== character[key]) void actions.update({ [key]: value });
    },
  });
  const num = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : null);

  return (
    <section className="card sheet">
      <h2 className="card-title">{title}</h2>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {t(name)}
          </button>
        ))}
      </div>
      {note}
      {dmUnlock && (
        <label className="unlock-switch">
          <input
            type="checkbox"
            checked={draft.hpItemsUnlocked}
            onChange={(e) => set('hpItemsUnlocked', e.target.checked)}
          />
          <span className="grow">
            {t('Player may change their own HP & items')}
            <span className="muted small block hint">{t('Off: only you (the DM) can.')}</span>
          </span>
        </label>
      )}
      {hpItemsLocked && !readOnly && (tab === 'Main' || tab === 'Items') && (
        <p className="notice">{t('Your DM manages your HP, items and coins. Ask them to unlock it if you need to change them.')}</p>
      )}
      {tab === 'Main' && portrait}
      {/* Keyed by the tab: a newly chosen tab fades in. */}
      <fieldset key={tab} className="sheet-body" disabled={readOnly}>

      {tab === 'Main' && (
        <>
          <HpBox character={draft} onHp={actions.adjustHp} onTemp={(v) => set('hpTemp', v)} readOnly={readOnly || hpItemsLocked} />
          <DeathSaves character={character} onRoll={readOnly ? undefined : (r) => void actions.deathSave(r)} />
          <ConcentrationBanner character={character} content={content} onAction={readOnly ? undefined : (a) => void actions.concentration(a)} />
          {/* The DM spends them for a player, or gives one back; players do it themselves outside sessions. */}
          <div className="hitdice-box">
            <HitDice
              character={character}
              content={content}
              canRoll={dice}
              onSpend={readOnly ? undefined : actions.spendHitDie}
              onRestore={readOnly ? undefined : () => void actions.restore('hitDice')}
            />
            {dmUnlock && character.resting && (
              <p className="muted small">{t('{name} is spending Hit Dice on their phone.', { name: character.name || t('The player') })}</p>
            )}
          </div>
          {/* Heroic Inspiration: the DM hands it out here; outside sessions its owner can only use it up. */}
          {dmUnlock ? (
            <button
              type="button"
              className={`secondary inspiration-give ${character.inspiration ? 'has' : ''}`}
              aria-pressed={character.inspiration}
              onClick={() => void actions.inspiration(character.inspiration ? 'take' : 'give')}
            >
              <InspirationStar />
              <span className="grow">
                {character.inspiration ? t('Has Heroic Inspiration') : t('Give Heroic Inspiration')}
                <span className="muted small block">
                  {character.inspiration ? t('Tap to take it back.') : t('{name} can give it up to reroll a die.', { name: character.name || t('The player') })}
                </span>
              </span>
            </button>
          ) : (
            !readOnly && <InspirationToken has={character.inspiration} onSpend={() => actions.inspiration('spend')} />
          )}
          {dmUnlock ? (
            <>
              <h3 className="section-label">{t('Conditions')}</h3>
              <ConditionEditor
                character={character}
                content={content}
                onConditions={(next) => void actions.update({ conditions: next })}
                onExhaustion={(n) => void actions.update({ exhaustion: n })}
              />
            </>
          ) : (
            <ConditionBadges character={character} content={content} />
          )}
          <div className="stat-row">
            <Stat label={t('AC')}>
              <NumInput value={draft.armorClass} onChange={(v) => { const n = num(v, 0, 99); if (n !== null) set('armorClass', n); }} />
            </Stat>
            <Stat label={t('Initiative')}>{formatModifier(stats.initiative)}</Stat>
            <Stat label={t('Speed##tile')}>
              <NumInput value={draft.speed} onChange={(v) => { const n = num(v, 0, 999); if (n !== null) set('speed', n); }} />
            </Stat>
            <Stat label={t('Prof.')}>{formatModifier(stats.proficiencyBonus)}</Stat>
            <Stat label={t('Passive Perc.')}>{stats.passivePerception}</Stat>
          </div>
          <div className="grid2">
            <label className="span2">{t('Name')}<input {...textProps('name')} /></label>
            <label>{t('Class')}<input placeholder={tx('Fighter')} {...textProps('className')} /></label>
            <label>{t('Subclass')}<input placeholder={t('from level 3')} {...textProps('subclass')} /></label>
            <label>{t('Species')}<input placeholder={tx('Elf')} {...textProps('species')} /></label>
            <label>{t('Background')}<input placeholder={tx('Sage')} {...textProps('background')} /></label>
            <label>{t('Level')}<NumInput value={draft.level} onChange={(v) => { const n = num(v, 1, 20); if (n !== null) set('level', n); }} /></label>
            <label>{t('Max HP')}<NumInput value={draft.hpMax} onChange={(v) => { const n = num(v, 1, 9999); if (n !== null) set('hpMax', n); }} /></label>
            <label>{t('Extra initiative')}<NumInput value={draft.initiativeBonus} onChange={(v) => { const n = num(v, -20, 20); if (n !== null) set('initiativeBonus', n); }} /></label>
            <label>
              {t('Hit Die')}
              <select value={draft.hitDie} onChange={(e) => set('hitDie', Number(e.target.value))}>
                <option value={0}>{t('From the class (d{die})', { die: hitDieSize({ className: draft.className, hitDie: 0 }, content) })}</option>
                {[6, 8, 10, 12].map((d) => <option key={d} value={d}>d{d}</option>)}
              </select>
            </label>
          </div>
          {/* Levelling up is done by the player on their own phone; in a session the DM only says when. */}
          {dmUnlock && character.level < 20 && (
            <button
              type="button"
              className={`secondary levelup-button ${character.levelUpReady ? 'waiting' : ''}`}
              onClick={() => void actions.update({ levelUpReady: !character.levelUpReady })}
            >
              {character.levelUpReady
                ? t('Waiting for {name} to level up on their phone · Cancel', { name: character.name || t('the player') })
                : t('⬆ Let {name} level up to {n}', { name: character.name || t('the player'), n: character.level + 1 })}
            </button>
          )}
          {!dmUnlock && !readOnly && character.level < 20 && (
            <button type="button" className="secondary levelup-button" onClick={() => setLevelling(true)}>
              {t('⬆ Level up to {n}', { n: character.level + 1 })}
            </button>
          )}
          {levelling && (
            <LevelUp
              character={character}
              onCancel={() => setLevelling(false)}
              onDone={async (choices) => {
                const ok = await actions.levelUp(choices);
                if (ok) setLevelling(false);
                return ok;
              }}
            />
          )}
        </>
      )}

      {tab === 'Abilities' && (
        <>
          <div className="abilities">
            {ABILITIES.map((a) => (
              <div key={a} className="ability">
                <div className="ability-name">{abilityShort(a)}</div>
                <div className="ability-mod">{formatModifier(stats.modifiers[a])}</div>
                <NumInput
                  ariaLabel={t(ABILITY_NAMES[a])}
                  value={draft.abilities[a]}
                  onChange={(v) => {
                    const n = num(v, 1, 30);
                    if (n !== null) set('abilities', { ...draft.abilities, [a]: n });
                  }}
                />
              </div>
            ))}
          </div>
          <h3>{t('Saving throws')}</h3>
          <ul className="checks">
            {ABILITIES.map((a) => (
              <ProfRow
                key={a}
                label={t(ABILITY_NAMES[a])}
                bonus={stats.saves[a]}
                level={draft.saveProficiencies.includes(a) ? 1 : 0}
                maxLevel={1}
                onChange={(lvl) => set('saveProficiencies', toggle(draft.saveProficiencies, a, lvl > 0))}
              />
            ))}
          </ul>
          <h3>{t('Skills')}</h3>
          {!readOnly && <p className="muted small hint">{t('Tap to cycle: not proficient → proficient → expertise.')}</p>}
          <ul className="checks">
            {SKILL_KEYS.map((s) => (
              <ProfRow
                key={s}
                label={t(SKILLS[s].name)}
                hint={abilityShort(SKILLS[s].ability)}
                bonus={stats.skills[s]}
                level={draft.skillExpertise.includes(s) ? 2 : draft.skillProficiencies.includes(s) ? 1 : 0}
                maxLevel={2}
                onChange={(lvl) => {
                  const skillProficiencies = toggle(draft.skillProficiencies, s, lvl >= 1);
                  const skillExpertise = toggle(draft.skillExpertise, s, lvl === 2);
                  setDraft((d) => ({ ...d, skillProficiencies, skillExpertise }));
                  void actions.update({ skillProficiencies, skillExpertise });
                }}
              />
            ))}
          </ul>
        </>
      )}

      {tab === 'Items' && (
        <fieldset className="sheet-body" disabled={hpItemsLocked}>
          <Items character={draft} actions={actions} onCoins={(coins) => set('coins', coins)} readOnly={readOnly || hpItemsLocked} content={content} />
        </fieldset>
      )}

      {tab === 'Spells' && (
        <>
          <Spells character={draft} stats={stats} set={set} readOnly={readOnly} content={content} />
          {spellSlots(character).length > 0 && (
            <>
              <h3 className="section-label">{t('Spell slots')}</h3>
              <SlotTracker character={character} onRestore={readOnly ? undefined : (id) => void actions.restore(id)} />
            </>
          )}
        </>
      )}

      {tab === 'Features' && (
        <>
          <h3 className="section-label">{t('Limited uses')}</h3>
          <UsesList
            character={character}
            content={content}
            onUse={readOnly ? undefined : actions.use}
            onRestore={readOnly ? undefined : (id) => void actions.restore(id)}
          />
          <CustomUsesEditor list={draft.customResources} readOnly={readOnly} onChange={(l) => set('customResources', l)} />
          {!readOnly && <RestButtons who={character.name || t('this character')} onRest={(k) => void actions.rest(k)} />}
          <Features character={draft} content={content} readOnly={readOnly} onChange={(f) => set('features', f)} />
        </>
      )}

      {tab === 'Features' && (
        <label>
          {t('Notes: proficiencies, languages, anything else')}
          <textarea
            rows={12}
            maxLength={5000}
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            onBlur={() => {
              if (draft.notes !== character.notes) void actions.update({ notes: draft.notes });
            }}
          />
        </label>
      )}
      </fieldset>
    </section>
  );
}

function toggle<T>(xs: T[], x: T, on: boolean): T[] {
  return on ? (xs.includes(x) ? xs : [...xs, x]) : xs.filter((y) => y !== x);
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-value">{children}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

/** Number input that lets you clear it while typing and saves valid numbers. */
function NumInput({ value, onChange, ariaLabel }: { value: number; onChange: (v: number) => void; ariaLabel?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '' && e.target.value !== '-') onChange(Number(e.target.value));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function ProfRow(props: {
  label: string;
  hint?: string;
  bonus: number;
  level: 0 | 1 | 2;
  maxLevel: 1 | 2;
  onChange: (level: number) => void;
}) {
  const marks = ['○', '●', '◆'];
  return (
    <li>
      <button
        className="check-row"
        aria-pressed={props.level > 0}
        onClick={() => props.onChange((props.level + 1) % (props.maxLevel + 1))}
      >
        <span className={`mark lvl${props.level}`}>{marks[props.level]}</span>
        <span className="bonus">{formatModifier(props.bonus)}</span>
        <span className="grow">{props.label}</span>
        {props.hint && <span className="muted small">{props.hint}</span>}
      </button>
    </li>
  );
}

export function HpBox({
  character,
  onHp,
  onTemp,
  readOnly = false,
}: {
  character: CharacterData;
  onHp: (delta: number) => Promise<boolean>;
  onTemp?: (v: number) => void;
  readOnly?: boolean;
}) {
  const [amount, setAmount] = useState('');
  const n = Number.parseInt(amount, 10);
  const valid = Number.isInteger(n) && n > 0;
  const apply = (sign: 1 | -1) => {
    if (!valid) return;
    void onHp(sign * n);
    setAmount('');
  };
  if (readOnly) {
    return (
      <div className="hp-box">
        <div className="hp-label">{t('Hit points')}</div>
        <HpFx value={character.hpCurrent} />
        <div className="hp-now big">
          <Num value={character.hpCurrent} />
          <span className="muted"> / {character.hpMax}</span>
          {character.hpTemp > 0 && <span className="temp-badge">{t('+{n} temp', { n: character.hpTemp })}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="hp-box">
      <HpFx value={character.hpCurrent} />
      <div className="hp-label">{t('Hit points')}</div>
      <div className="hp-row">
        <button aria-label={t('Take 5 damage')} onClick={() => void onHp(-5)}>−5</button>
        <button aria-label={t('Take 1 damage')} onClick={() => void onHp(-1)}>−1</button>
        <span className="hp-now">
          <Num value={character.hpCurrent} />
          <span className="muted"> / {character.hpMax}</span>
          {character.hpTemp > 0 && <span className="temp-badge">+{character.hpTemp}</span>}
        </span>
        <button aria-label={t('Heal 1')} onClick={() => void onHp(1)}>+1</button>
        <button aria-label={t('Heal 5')} onClick={() => void onHp(5)}>+5</button>
      </div>
      <div className="amount-row">
        <input type="number" inputMode="numeric" min={1} placeholder={t('Amount')} aria-label={t('Amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="damage" disabled={!valid} onClick={() => apply(-1)}>{t('Damage')}</button>
        <button className="heal" disabled={!valid} onClick={() => apply(1)}>{t('Heal')}</button>
      </div>
      {onTemp && (
        <label className="temp">
          {t('Temp HP')}
          <NumInput value={character.hpTemp} onChange={(v) => Number.isInteger(v) && v >= 0 && v <= 9999 && onTemp(v)} />
        </label>
      )}
    </div>
  );
}

export function Items({
  character,
  actions,
  onCoins,
  readOnly,
  content,
}: {
  character: CharacterData;
  actions: SheetActions;
  onCoins: (c: CharacterData['coins']) => void;
  readOnly: boolean;
  content: Content | null;
}) {
  /** Items added while the list is open slide in. */
  const fresh = useFresh(character.inventory.map((i) => i.id));
  return (
    <>
      <div className="coins">
        {COINS.map((c) => (
          <label key={c}>
            {t(c).toUpperCase()}
            <NumInput
              value={character.coins[c]}
              onChange={(v) => Number.isInteger(v) && v >= 0 && onCoins({ ...character.coins, [c]: v })}
            />
          </label>
        ))}
      </div>
      {character.inventory.length === 0 ? (
        <p className="muted">{t('No items yet.')}</p>
      ) : (
        <ul className="items">
          {character.inventory.map((item) => (
            <li key={item.id} className={fresh.has(item.id) ? 'fresh' : undefined}>
              <Info entry={itemEntry(content, item)} className="grow" tapToOpen>
                <span className="block">{item.name}</span>
                {item.notes && <span className="muted small block">{item.notes}</span>}
              </Info>
              {readOnly ? (
                <span className="qty">×<FlashNum value={item.qty} /></span>
              ) : (
                <>
                  <button aria-label={t('One less {name}', { name: item.name })} onClick={() => void actions.updateItem(item.id, { qty: item.qty - 1 })}>−</button>
                  <span className="qty"><FlashNum value={item.qty} /></span>
                  <button aria-label={t('One more {name}', { name: item.name })} onClick={() => void actions.updateItem(item.id, { qty: item.qty + 1 })}>+</button>
                  <button aria-label={t('Remove {name}', { name: item.name })} className="remove" onClick={() => void actions.removeItem(item.id)}>✕</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {character.inventory.length > 0 && <p className="muted small hint">{t('Tap an item to read it.')}</p>}
      {!readOnly && <AddItem content={content} onAdd={actions.addItem} />}
    </>
  );
}

function Spells({
  character,
  stats,
  set,
  readOnly,
  content,
}: {
  character: CharacterData;
  stats: ReturnType<typeof deriveStats>;
  set: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  readOnly: boolean;
  content: Content | null;
}) {
  const spells = [...character.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return (
    <>
      <label>
        {t('Spellcasting ability')}
        <select
          value={character.spellcastingAbility ?? ''}
          onChange={(e) => set('spellcastingAbility', (e.target.value || null) as Ability | null)}
        >
          <option value="">{t('None')}</option>
          {ABILITIES.map((a) => (
            <option key={a} value={a}>{t(ABILITY_NAMES[a])}</option>
          ))}
        </select>
      </label>
      {stats.spellSaveDc !== null && (
        <div className="stat-row">
          <div className="stat"><div className="stat-value">{stats.spellSaveDc}</div><div className="stat-label">{t('Spell save DC')}</div></div>
          <div className="stat"><div className="stat-value">{formatModifier(stats.spellAttack!)}</div><div className="stat-label">{t('Spell attack')}</div></div>
        </div>
      )}
      {spells.length === 0 ? (
        <p className="muted">{t('No spells yet.')}</p>
      ) : (
        <ul className="items">
          {spells.map((sp) => (
            <li key={sp.id}>
              <button
                className={`prep ${sp.prepared ? 'on' : ''}`}
                aria-pressed={sp.prepared}
                aria-label={t('{name} prepared', { name: sp.name })}
                onClick={() => set('spells', character.spells.map((x) => (x.id === sp.id ? { ...x, prepared: !x.prepared } : x)))}
              >
                {sp.prepared ? '●' : '○'}
              </button>
              <Info entry={spellEntry(content, sp)} className="grow" tapToOpen>
                <span className="block">
                  {sp.name}
                  <span className="muted small"> · {sp.level === 0 ? t('Cantrip') : t('Level {n}##spell', { n: sp.level })}</span>
                </span>
                {spellGlance(content, sp) && <span className="muted small block">{spellGlance(content, sp)}</span>}
              </Info>
              {!readOnly && (
                <button aria-label={t('Remove {name}', { name: sp.name })} className="remove" onClick={() => set('spells', character.spells.filter((x) => x.id !== sp.id))}>✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {spells.length > 0 && <p className="muted small hint">{t('Tap a spell to read what it does.')}</p>}
      {!readOnly && <AddSpell content={content} character={character} onAdd={(sp) => set('spells', [...character.spells, sp])} />}
    </>
  );
}

export type { Skill };
