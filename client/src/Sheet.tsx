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
} from '@dnd/shared';
import type { Game } from './useGame.ts';

/** Edits one character (by id). The server decides who may: owner outside sessions, DM inside. */
export interface SheetActions {
  update: (patch: Partial<CharacterData>) => Promise<boolean>;
  adjustHp: (delta: number) => Promise<boolean>;
  addItem: (item: { name: string; qty?: number; notes?: string }) => Promise<boolean>;
  updateItem: (itemId: string, patch: Partial<Omit<Item, 'id'>>) => Promise<boolean>;
  removeItem: (itemId: string) => Promise<boolean>;
}

export function sheetActions(game: Game, characterId: string): SheetActions {
  return {
    update: (patch) => game.updateCharacter(characterId, patch),
    adjustHp: (delta) => game.adjustHp(characterId, delta),
    addItem: (item) => game.addItem(characterId, item),
    updateItem: (id, patch) => game.updateItem(characterId, id, patch),
    removeItem: (id) => game.removeItem(characterId, id),
  };
}

const TABS = ['Main', 'Abilities', 'Items', 'Spells', 'Notes'] as const;
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
  note,
}: {
  character: CharacterData;
  actions: SheetActions;
  title: ReactNode;
  readOnly?: boolean;
  note?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('Main');
  const [draft, setDraft] = useDraft(character);
  const stats = deriveStats(draft);

  /** Set + save immediately (toggles, numbers, selects). */
  const set = <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    void actions.update({ [key]: value } as Partial<CharacterData>);
  };
  /** Text inputs: edit locally, save on blur. */
  const textProps = (key: 'name' | 'className' | 'subclass' | 'species' | 'background', max = 40) => ({
    value: draft[key],
    maxLength: max,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => {
      if (draft[key] !== character[key]) void actions.update({ [key]: draft[key] });
    },
  });
  const num = (v: number, min: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : null);

  return (
    <section className="card sheet">
      <h2 className="card-title">{title}</h2>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {note}
      <fieldset className="sheet-body" disabled={readOnly}>

      {tab === 'Main' && (
        <>
          <HpBox character={draft} onHp={actions.adjustHp} onTemp={(v) => set('hpTemp', v)} readOnly={readOnly} />
          <div className="stat-row">
            <Stat label="AC">
              <NumInput value={draft.armorClass} onChange={(v) => { const n = num(v, 0, 99); if (n !== null) set('armorClass', n); }} />
            </Stat>
            <Stat label="Initiative">{formatModifier(stats.initiative)}</Stat>
            <Stat label="Speed">
              <NumInput value={draft.speed} onChange={(v) => { const n = num(v, 0, 999); if (n !== null) set('speed', n); }} />
            </Stat>
            <Stat label="Prof.">{formatModifier(stats.proficiencyBonus)}</Stat>
            <Stat label="Passive Perc.">{stats.passivePerception}</Stat>
          </div>
          <div className="grid2">
            <label className="span2">Name<input {...textProps('name')} /></label>
            <label>Class<input placeholder="Fighter" {...textProps('className')} /></label>
            <label>Subclass<input placeholder="from level 3" {...textProps('subclass')} /></label>
            <label>Species<input placeholder="Elf" {...textProps('species')} /></label>
            <label>Background<input placeholder="Sage" {...textProps('background')} /></label>
            <label>Level<NumInput value={draft.level} onChange={(v) => { const n = num(v, 1, 20); if (n !== null) set('level', n); }} /></label>
            <label>Max HP<NumInput value={draft.hpMax} onChange={(v) => { const n = num(v, 1, 9999); if (n !== null) set('hpMax', n); }} /></label>
            <label>Extra initiative<NumInput value={draft.initiativeBonus} onChange={(v) => { const n = num(v, -20, 20); if (n !== null) set('initiativeBonus', n); }} /></label>
          </div>
        </>
      )}

      {tab === 'Abilities' && (
        <>
          <div className="abilities">
            {ABILITIES.map((a) => (
              <div key={a} className="ability">
                <div className="ability-name">{a.toUpperCase()}</div>
                <div className="ability-mod">{formatModifier(stats.modifiers[a])}</div>
                <NumInput
                  ariaLabel={ABILITY_NAMES[a]}
                  value={draft.abilities[a]}
                  onChange={(v) => {
                    const n = num(v, 1, 30);
                    if (n !== null) set('abilities', { ...draft.abilities, [a]: n });
                  }}
                />
              </div>
            ))}
          </div>
          <h3>Saving throws</h3>
          <ul className="checks">
            {ABILITIES.map((a) => (
              <ProfRow
                key={a}
                label={ABILITY_NAMES[a]}
                bonus={stats.saves[a]}
                level={draft.saveProficiencies.includes(a) ? 1 : 0}
                maxLevel={1}
                onChange={(lvl) => set('saveProficiencies', toggle(draft.saveProficiencies, a, lvl > 0))}
              />
            ))}
          </ul>
          <h3>Skills</h3>
          {!readOnly && <p className="muted small">Tap to cycle: not proficient → proficient → expertise.</p>}
          <ul className="checks">
            {SKILL_KEYS.map((s) => (
              <ProfRow
                key={s}
                label={SKILLS[s].name}
                hint={SKILLS[s].ability.toUpperCase()}
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

      {tab === 'Items' && <Items character={draft} actions={actions} onCoins={(coins) => set('coins', coins)} readOnly={readOnly} />}

      {tab === 'Spells' && <Spells character={draft} stats={stats} set={set} readOnly={readOnly} />}

      {tab === 'Notes' && (
        <label>
          Feats, features, proficiencies, languages…
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
        <div className="hp-label">Hit points</div>
        <div className="hp-now big">
          {character.hpCurrent}
          <span className="muted"> / {character.hpMax}</span>
          {character.hpTemp > 0 && <span className="temp-badge">+{character.hpTemp} temp</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="hp-box">
      <div className="hp-label">Hit points</div>
      <div className="hp-row">
        <button aria-label="Take 5 damage" onClick={() => void onHp(-5)}>−5</button>
        <button aria-label="Take 1 damage" onClick={() => void onHp(-1)}>−1</button>
        <span className="hp-now">
          {character.hpCurrent}
          <span className="muted"> / {character.hpMax}</span>
          {character.hpTemp > 0 && <span className="temp-badge">+{character.hpTemp}</span>}
        </span>
        <button aria-label="Heal 1" onClick={() => void onHp(1)}>+1</button>
        <button aria-label="Heal 5" onClick={() => void onHp(5)}>+5</button>
      </div>
      <div className="amount-row">
        <input type="number" inputMode="numeric" min={1} placeholder="Amount" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="damage" disabled={!valid} onClick={() => apply(-1)}>Damage</button>
        <button className="heal" disabled={!valid} onClick={() => apply(1)}>Heal</button>
      </div>
      {onTemp && (
        <label className="temp">
          Temp HP
          <NumInput value={character.hpTemp} onChange={(v) => Number.isInteger(v) && v >= 0 && v <= 9999 && onTemp(v)} />
        </label>
      )}
    </div>
  );
}

function Items({
  character,
  actions,
  onCoins,
  readOnly,
}: {
  character: CharacterData;
  actions: SheetActions;
  onCoins: (c: CharacterData['coins']) => void;
  readOnly: boolean;
}) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = Number.parseInt(qty, 10);
    if (await actions.addItem({ name, qty: Number.isInteger(q) && q > 0 ? q : 1 })) {
      setName('');
      setQty('1');
    }
  };
  return (
    <>
      <div className="coins">
        {COINS.map((c) => (
          <label key={c}>
            {c.toUpperCase()}
            <NumInput
              value={character.coins[c]}
              onChange={(v) => Number.isInteger(v) && v >= 0 && onCoins({ ...character.coins, [c]: v })}
            />
          </label>
        ))}
      </div>
      {character.inventory.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : (
        <ul className="items">
          {character.inventory.map((item) => (
            <li key={item.id}>
              <span className="grow">
                {item.name}
                {item.notes && <span className="muted small block">{item.notes}</span>}
              </span>
              {readOnly ? (
                <span className="qty">×{item.qty}</span>
              ) : (
                <>
                  <button aria-label={`One less ${item.name}`} onClick={() => void actions.updateItem(item.id, { qty: item.qty - 1 })}>−</button>
                  <span className="qty">{item.qty}</span>
                  <button aria-label={`One more ${item.name}`} onClick={() => void actions.updateItem(item.id, { qty: item.qty + 1 })}>+</button>
                  <button aria-label={`Remove ${item.name}`} className="remove" onClick={() => void actions.removeItem(item.id)}>✕</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <form onSubmit={add} className="inline-form">
        <label>
          Add item
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Potion of Healing" maxLength={80} required />
        </label>
        <label className="qty-input">
          Qty
          <input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <button className="secondary" type="submit">Add</button>
      </form>}
    </>
  );
}

function Spells({
  character,
  stats,
  set,
  readOnly,
}: {
  character: CharacterData;
  stats: ReturnType<typeof deriveStats>;
  set: <K extends keyof CharacterData>(key: K, value: CharacterData[K]) => void;
  readOnly: boolean;
}) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState(0);
  const spells = [...character.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return (
    <>
      <label>
        Spellcasting ability
        <select
          value={character.spellcastingAbility ?? ''}
          onChange={(e) => set('spellcastingAbility', (e.target.value || null) as Ability | null)}
        >
          <option value="">None</option>
          {ABILITIES.map((a) => (
            <option key={a} value={a}>{ABILITY_NAMES[a]}</option>
          ))}
        </select>
      </label>
      {stats.spellSaveDc !== null && (
        <div className="stat-row">
          <div className="stat"><div className="stat-value">{stats.spellSaveDc}</div><div className="stat-label">Spell save DC</div></div>
          <div className="stat"><div className="stat-value">{formatModifier(stats.spellAttack!)}</div><div className="stat-label">Spell attack</div></div>
        </div>
      )}
      {spells.length === 0 ? (
        <p className="muted">No spells yet.</p>
      ) : (
        <ul className="items">
          {spells.map((sp) => (
            <li key={sp.id}>
              <button
                className={`prep ${sp.prepared ? 'on' : ''}`}
                aria-pressed={sp.prepared}
                aria-label={`${sp.name} prepared`}
                onClick={() => set('spells', character.spells.map((x) => (x.id === sp.id ? { ...x, prepared: !x.prepared } : x)))}
              >
                {sp.prepared ? '●' : '○'}
              </button>
              <span className="grow">
                {sp.name}
                <span className="muted small"> · {sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`}</span>
              </span>
              {!readOnly && (
                <button aria-label={`Remove ${sp.name}`} className="remove" onClick={() => set('spells', character.spells.filter((x) => x.id !== sp.id))}>✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          set('spells', [...character.spells, { id: newId(), name: name.trim(), level, prepared: true }]);
          setName('');
        }}
      >
        <label>
          Add spell
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Magic Missile" maxLength={80} required />
        </label>
        <label className="qty-input">
          Level
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => (
              <option key={l} value={l}>{l === 0 ? 'C' : l}</option>
            ))}
          </select>
        </label>
        <button className="secondary" type="submit">Add</button>
      </form>}
    </>
  );
}

export type { Skill };

/** crypto.randomUUID only exists on HTTPS/localhost; phones on the LAN dev server use plain http. */
function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
