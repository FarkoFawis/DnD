/**
 * Spell slots, limited-use features and rests on the sheet. The maximums come
 * from shared/resources.ts; the server counts what is spent (character:use).
 * Filled pips = still available.
 */
import { useState } from 'react';
import {
  RESET_LABEL,
  castOptions,
  describeRef,
  limitedUses,
  ordinal,
  spellSlots,
  used,
  type CharacterData,
  type Content,
  type CustomResource,
  type Spell,
  type UseRequest,
} from '@dnd/shared';
import { Info } from './Info.tsx';
import { newId } from './SheetContent.tsx';
import { t, tj, tx } from './i18n.tsx';

export function Pips({ max, spent, onRestore, label }: { max: number; spent: number; onRestore?: () => void; label: string }) {
  const left = Math.max(0, max - spent);
  return (
    <span className="pips" role="img" aria-label={t('{label}: {left} of {max} left', { label, left, max })}>
      {Array.from({ length: max }, (_, i) =>
        i < left || !onRestore ? (
          <span key={i} className={`pip ${i < left ? 'on' : ''}`} />
        ) : (
          <button key={i} type="button" className="pip" aria-label={t('Give back one {label}', { label })} onClick={onRestore} />
        ),
      )}
    </span>
  );
}

/** Spell slots by level. `onRestore` (DM): tap an empty pip to give a slot back. */
export function SlotTracker({ character: c, onRestore }: { character: CharacterData; onRestore?: (id: string) => void }) {
  const slots = spellSlots(c);
  if (slots.length === 0) return null;
  return (
    <div className="slots">
      {slots.map((s) => (
        <div key={s.id} className="slot-row">
          <span className="slot-label">{s.pact ? t('Pact slots ({nth})', { nth: ordinal(s.level) }) : t('{nth} level', { nth: ordinal(s.level) })}</span>
          <Pips max={s.max} spent={used(c, s.id)} onRestore={onRestore && (() => onRestore(s.id))} label={t('{nth}-level slot', { nth: ordinal(s.level) })} />
        </div>
      ))}
      <p className="muted small slot-hint hint">{slots[0]!.pact ? t('Pact slots come back on a Short or Long Rest.') : t('Spell slots come back on a Long Rest.')}</p>
    </div>
  );
}

/** Class and species features with limited uses, with a Use button each. */
export function UsesList({
  character: c,
  content,
  onUse,
  onRestore,
}: {
  character: CharacterData;
  content: Content | null;
  onUse?: (req: UseRequest) => Promise<boolean>;
  onRestore?: (id: string) => void;
}) {
  const uses = limitedUses(c, content);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  if (uses.length === 0) return <p className="muted small">{t('No limited-use features.')}</p>;
  return (
    <ul className="uses">
      {uses.map((u) => {
        const spent = used(c, u.id);
        const left = Math.max(0, u.max - spent);
        const entry = u.ref && content ? describeRef(content, u.ref) : null;
        const amount = Number(amounts[u.id] ?? '1');
        return (
          <li key={u.id} className="use-row">
            <span className="grow">
              <Info entry={entry} tapToOpen>
                <strong>{u.name}</strong>
              </Info>
              <span className="muted small block">{t(RESET_LABEL[u.resetOn])}</span>
              {u.pool ? (
                <span className="pool">
                  {tj('{left} / {max} left', { left: <strong>{left}</strong>, max: u.max })}
                  {onRestore && spent > 0 && (
                    <button type="button" className="link" onClick={() => onRestore(u.id)}>+1</button>
                  )}
                </span>
              ) : (
                <Pips max={u.max} spent={spent} onRestore={onRestore && (() => onRestore(u.id))} label={u.name} />
              )}
            </span>
            {onUse && (
              <span className="use-controls">
                {u.pool && (
                  <input
                    className="use-amount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={left}
                    aria-label={t('How many {name}', { name: u.name })}
                    value={amounts[u.id] ?? '1'}
                    onChange={(e) => setAmounts((a) => ({ ...a, [u.id]: e.target.value }))}
                  />
                )}
                <button
                  type="button"
                  className="use-button"
                  disabled={left === 0 || (u.pool && !(amount >= 1 && amount <= left))}
                  onClick={() => void onUse({ kind: 'feature', useId: u.id, amount: u.pool ? amount : undefined })}
                >
                  {left === 0 ? t('Used') : t('Use')}
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cast button for one spell. Cantrips are free; a leveled spell spends the
 * lowest free slot, or asks which one when there is a choice (higher slot, ritual).
 */
export function CastButton({
  character: c,
  spell,
  content,
  onUse,
}: {
  character: CharacterData;
  spell: Spell;
  content: Content | null;
  onUse: (req: UseRequest) => Promise<boolean>;
}) {
  const [choosing, setChoosing] = useState(false);
  const ritual = !!(spell.ref && content?.spell(spell.ref)?.ritual);
  const options = castOptions(c, spell.level);
  const cast = (extra: { slot?: string; ritual?: boolean } = {}) => {
    setChoosing(false);
    void onUse({ kind: 'spell', spellId: spell.id, ...extra });
  };
  if (spell.level === 0) {
    return <button type="button" className="use-button" onClick={() => cast()}>{t('Cast')}</button>;
  }
  const choices = options.length + (ritual ? 1 : 0);
  if (choices === 0) {
    return <button type="button" className="use-button" disabled>{t('No slots')}</button>;
  }
  if (!choosing) {
    return (
      <button type="button" className="use-button" onClick={() => (choices === 1 && !ritual ? cast({ slot: options[0]!.id }) : setChoosing(true))}>
        {t('Cast')}
      </button>
    );
  }
  return (
    <span className="cast-choices" role="group" aria-label={t('Cast {name} with', { name: spell.name })}>
      {options.map((o) => (
        <button key={o.id} type="button" className="use-button" onClick={() => cast({ slot: o.id })}>
          {o.pact ? t('Pact') : ordinal(o.level)} <span className="small">({o.max - used(c, o.id)})</span>
        </button>
      ))}
      {ritual && (
        <button type="button" className="use-button" onClick={() => cast({ ritual: true })}>{t('Ritual')}</button>
      )}
      <button type="button" className="link" onClick={() => setChoosing(false)}>{t('Cancel')}</button>
    </span>
  );
}

export function RestButtons({ onRest, who }: { onRest: (kind: 'short' | 'long') => void; who: string }) {
  const ask = (kind: 'short' | 'long') => {
    const msg =
      kind === 'short'
        ? t('Short Rest for {who}? Pact slots and short-rest features come back.', { who })
        : t('Long Rest for {who}? HP, spell slots and every feature come back.', { who });
    if (window.confirm(msg)) onRest(kind);
  };
  return (
    <div className="rest-buttons">
      <button type="button" className="secondary" onClick={() => ask('short')}>{t('Short rest')}</button>
      <button type="button" className="secondary" onClick={() => ask('long')}>{t('Long rest')}</button>
    </div>
  );
}

/** Add limited-use things by hand (a feat like Lucky, a magic item's charges, homebrew). */
export function CustomUsesEditor({
  list,
  onChange,
  readOnly,
}: {
  list: CustomResource[];
  onChange: (next: CustomResource[]) => void;
  readOnly: boolean;
}) {
  const [name, setName] = useState('');
  const [max, setMax] = useState('1');
  const [resetOn, setResetOn] = useState<'short' | 'long'>('long');
  const n = Number(max);
  return (
    <div className="custom-uses">
      {list.length > 0 && (
        <ul className="items">
          {list.map((r) => (
            <li key={r.id}>
              <span className="grow">{r.name} <span className="muted small">{r.resetOn === 'short' ? t('{n}× per Short Rest', { n: r.max }) : t('{n}× per Long Rest', { n: r.max })}</span></span>
              {!readOnly && (
                <button type="button" aria-label={t('Remove {name}', { name: r.name })} onClick={() => onChange(list.filter((x) => x.id !== r.id))}>✕</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="add-box custom-use-add">
          <input placeholder={t('Other limited use (e.g. Lucky)')} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <input type="number" inputMode="numeric" min={1} max={99} aria-label={t('Uses')} value={max} onChange={(e) => setMax(e.target.value)} />
          <select aria-label={t('Comes back on')} value={resetOn} onChange={(e) => setResetOn(e.target.value as 'short' | 'long')}>
            <option value="long">{t('per Long Rest')}</option>
            <option value="short">{t('per Short Rest')}</option>
          </select>
          <button
            type="button"
            className="secondary"
            disabled={!name.trim() || !(Number.isInteger(n) && n >= 1 && n <= 99)}
            onClick={() => {
              onChange([...list, { id: newId(), name: name.trim(), max: n, resetOn }]);
              setName('');
              setMax('1');
            }}
          >
            {t('Add')}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Magic Missile · 1st-level slot", for the DM's party list. */
export function actionText(a: CharacterData['lastAction']): string | null {
  if (!a) return null;
  return a.detail ? `${tx(a.name)} · ${tx(a.detail)}` : tx(a.name);
}
