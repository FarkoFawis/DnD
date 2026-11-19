/**
 * The parts of the sheet that use the game content: descriptions on hold /
 * hover for spells, items and features, and pickers to add them.
 */
import { useState } from 'react';
import {
  describeRef,
  itemInfo,
  spellInfo,
  type CharacterData,
  type CharacterFeature,
  type Content,
  type InfoEntry,
  type Item,
  type ItemDef,
  type Spell,
} from '@dnd/shared';
import { Info } from './Info.tsx';
import { PickerList, type PickerOption } from './Picker.tsx';
import { spellPickerOptions } from './creator/CharacterCreator.tsx';

export function spellEntry(content: Content | null, s: Spell): InfoEntry | null {
  const def = content && (s.ref ? content.spell(s.ref) : undefined) || content?.findByName('spells', s.name);
  if (def) return spellInfo(def);
  if (s.description) return { title: s.name, subtitle: s.level === 0 ? 'Cantrip (homebrew)' : `Level ${s.level} (homebrew)`, body: s.description };
  return null;
}

export function itemEntry(content: Content | null, i: Item): InfoEntry | null {
  const def = content && (i.ref ? content.item(i.ref) : undefined) || content?.findByName('items', i.name);
  if (def) {
    const e = itemInfo(def);
    return i.notes ? { ...e, body: `${e.body}\n**Your notes.** ${i.notes}` } : e;
  }
  if (i.notes) return { title: i.name, subtitle: 'Custom item', body: i.notes };
  return null;
}

export function featureEntry(content: Content | null, f: CharacterFeature): InfoEntry | null {
  const fromRef = content && f.ref ? describeRef(content, f.ref) : null;
  if (fromRef) return fromRef;
  if (f.description) return { title: f.name, subtitle: f.source, body: f.description };
  return null;
}

const KIND_GROUP: Record<ItemDef['kind'], string> = {
  weapon: 'Weapons',
  armor: 'Armor',
  gear: 'Adventuring gear',
  tool: 'Tools',
  magic: 'Magic items',
};

/** "Add from the rulebook" + a custom item form. */
export function AddItem({ content, onAdd }: { content: Content | null; onAdd: (item: { name: string; qty: number; notes?: string; ref?: string }) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const options: PickerOption[] = content
    ? content.items
        .map((d) => ({ value: d.id, label: d.name, hint: [d.rarity ?? d.category, d.summary, d.cost].filter(Boolean).join(' · '), group: KIND_GROUP[d.kind], info: itemInfo(d) }))
        .sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
    : [];
  return (
    <div className="add-box">
      <div className="add-buttons">
        <button type="button" className="secondary grow" disabled={!content} onClick={() => setOpen(true)}>+ Add item from the rulebook</button>
        <button type="button" className="secondary" onClick={() => setCustom(!custom)}>{custom ? 'Close' : 'Custom'}</button>
      </div>
      {open && (
        <PickerList
          title="Add an item"
          value=""
          options={options}
          searchable
          onPick={(id) => {
            const d = content!.item(id)!;
            void onAdd({ name: d.name, qty: 1, ref: d.id });
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {custom && (
        <form
          className="custom-box"
          onSubmit={async (e) => {
            e.preventDefault();
            const q = Number.parseInt(qty, 10);
            if (await onAdd({ name, qty: Number.isInteger(q) && q > 0 ? q : 1, notes })) {
              setName('');
              setQty('1');
              setNotes('');
              setCustom(false);
            }
          }}
        >
          <div className="inline-form">
            <label>Item name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grandpa's lucky coin" maxLength={80} required /></label>
            <label className="qty-input">Qty<input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          </div>
          <label>Description (shown when held)<textarea rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <button className="secondary" type="submit">Add custom item</button>
        </form>
      )}
    </div>
  );
}

/** "Add from the rulebook" (class list first) + a homebrew spell form. */
export function AddSpell({ content, character, onAdd }: { content: Content | null; character: CharacterData; onAdd: (s: Spell) => void }) {
  const [open, setOpen] = useState(false);
  const [onlyClass, setOnlyClass] = useState(true);
  const [custom, setCustom] = useState(false);
  const [name, setName] = useState('');
  const [level, setLevel] = useState(0);
  const [description, setDescription] = useState('');
  const cls = content?.classes.find((c) => c.name.toLowerCase() === character.className.trim().toLowerCase());
  const have = new Set(character.spells.map((s) => s.ref).filter(Boolean));
  const list = content ? (cls && onlyClass ? content.spellsFor(cls.id, 9) : content.spells) : [];
  const options = spellPickerOptions(list.filter((s) => !have.has(s.id)));
  return (
    <div className="add-box">
      <div className="add-buttons">
        <button type="button" className="secondary grow" disabled={!content} onClick={() => setOpen(true)}>+ Add spell from the rulebook</button>
        <button type="button" className="secondary" onClick={() => setCustom(!custom)}>{custom ? 'Close' : 'Homebrew'}</button>
      </div>
      {open && (
        <PickerList
          title={cls && onlyClass ? `${cls.name} spells` : 'All spells'}
          value=""
          options={cls ? [{ value: '__toggle', label: onlyClass ? `Show every class's spells` : `Show only ${cls.name} spells`, group: 'Filter' }, ...options] : options}
          searchable
          onPick={(id) => {
            if (id === '__toggle') return setOnlyClass(!onlyClass);
            const d = content!.spell(id)!;
            onAdd({ id: newId(), name: d.name, level: d.level, prepared: true, ref: d.id });
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
      {custom && (
        <form
          className="custom-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            onAdd({ id: newId(), name: name.trim(), level, prepared: true, ...(description.trim() ? { description: description.trim() } : {}) });
            setName('');
            setDescription('');
            setCustom(false);
          }}
        >
          <div className="inline-form">
            <label>Spell name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Chromatic Orb" maxLength={80} required /></label>
            <label className="qty-input">Level
              <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => <option key={l} value={l}>{l === 0 ? 'C' : l}</option>)}
              </select>
            </label>
          </div>
          <label>Description (shown when held)<textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <button className="secondary" type="submit">Add homebrew spell</button>
        </form>
      )}
    </div>
  );
}

/** Class features, species traits and feats, each holdable for its text. */
export function Features({
  character,
  content,
  readOnly,
  onChange,
}: {
  character: CharacterData;
  content: Content | null;
  readOnly: boolean;
  onChange: (features: CharacterFeature[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const list = character.features;
  return (
    <>
      <h3>Features &amp; traits</h3>
      {list.length === 0 ? (
        <p className="muted small">None yet. Characters made with the guide get theirs automatically.</p>
      ) : (
        <>
          <p className="muted small">Hold one (or hover with the mouse) to read it.</p>
          <ul className="items">
            {list.map((f) => (
              <li key={f.id}>
                <Info entry={featureEntry(content, f)} className="grow">
                  <span className="block">{f.name}</span>
                  {f.source && <span className="muted small block">{f.source}</span>}
                </Info>
                {!readOnly && (
                  <button type="button" className="remove" aria-label={`Remove ${f.name}`} onClick={() => onChange(list.filter((x) => x.id !== f.id))}>✕</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && (
        adding ? (
          <form
            className="custom-box"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              onChange([...list, { id: newId(), name: name.trim(), source: 'Custom', ...(description.trim() ? { description: description.trim() } : {}) }]);
              setName('');
              setDescription('');
              setAdding(false);
            }}
          >
            <label>Feature name<input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required /></label>
            <label>Description<textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <div className="add-buttons">
              <button type="submit" className="secondary grow">Add feature</button>
              <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className="secondary add-feature" onClick={() => setAdding(true)}>+ Add a feature or feat</button>
        )
      )}
    </>
  );
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
