import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InfoEntry } from '@dnd/shared';
import { useClosing } from './fx/hooks.ts';
import { Info } from './Info.tsx';

export interface PickerOption {
  value: string;
  label: string;
  /** Small grey text under the label. */
  hint?: string;
  /** Section heading, e.g. "Cantrips" / "Level 1". */
  group?: string;
  info?: InfoEntry | null;
  disabled?: boolean;
}

export const CUSTOM_VALUE = 'custom';

/**
 * A dropdown that opens a full-screen list on phones. Every option (and the
 * chosen value) can be held / hovered to read its description. Searchable
 * when the list is long. `allowCustom` adds a "Homebrew / custom" choice.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose…',
  allowCustom = false,
  customLabel = 'Homebrew / custom…',
  searchable,
  disabled,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  allowCustom?: boolean;
  customLabel?: string;
  searchable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);
  const shown = value === CUSTOM_VALUE && allowCustom ? customLabel.replace(/…$/, '') : chosen?.label;
  return (
    <div className="picker">
      <span className="picker-label">{label}</span>
      <Info entry={chosen?.info}>
        <button type="button" className={`picker-button ${shown ? '' : 'empty'}`} onClick={() => setOpen(true)} disabled={disabled}>
          <span className="grow">{shown ?? placeholder}</span>
          <span className="chev">▾</span>
        </button>
      </Info>
      {open && (
        <PickerList
          title={label}
          value={value}
          options={allowCustom ? [...options, { value: CUSTOM_VALUE, label: customLabel, group: 'Not in the book list' }] : options}
          searchable={searchable ?? options.length > 12}
          onPick={onChange}
          closeOnPick
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function PickerList({
  title,
  value,
  options,
  searchable,
  onPick,
  onClose,
  multi,
  closeOnPick,
}: {
  title: string;
  value: string | string[];
  options: PickerOption[];
  searchable: boolean;
  onPick: (value: string) => void;
  onClose: () => void;
  /** For multi-select: "2 / 4 picked" in the header. */
  multi?: { count: number; max: number };
  /** Choosing an option also closes the list (it slides away; `onClose` follows). */
  closeOnPick?: boolean;
}) {
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  // The list slides back down before it is gone.
  const { closing, close } = useClosing(onClose);
  useEffect(() => {
    // Don't pop the phone keyboard open; only focus search on devices with a mouse.
    if (searchable && window.matchMedia('(pointer: fine)').matches) search.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchable, close]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t)) : options;
  }, [q, options]);
  const selected = new Set(Array.isArray(value) ? value : [value]);
  let lastGroup: string | undefined;
  return createPortal(
    <div className={`picker-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="picker-panel" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <strong className="grow">{title}</strong>
          {multi && <span className="muted small">{multi.count} / {multi.max} picked</span>}
          <button type="button" className="secondary" onClick={close}>{multi ? 'Done' : 'Close'}</button>
        </div>
        {searchable && (
          <input ref={search} className="picker-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        <p className="muted small picker-tip hint">Hold an option (or hover with the mouse) to read it.</p>
        <ul className="picker-options">
          {filtered.map((o) => {
            const head = o.group !== lastGroup ? o.group : undefined;
            lastGroup = o.group;
            return (
              <li key={o.value}>
                {head && <div className="picker-group">{head}</div>}
                <Info entry={o.info}>
                  <button
                    type="button"
                    className="picker-option"
                    aria-selected={selected.has(o.value)}
                    disabled={o.disabled && !selected.has(o.value)}
                    onClick={() => {
                      onPick(o.value);
                      if (closeOnPick) close();
                    }}
                  >
                    <span className="check">{selected.has(o.value) ? '✓' : ''}</span>
                    <span className="grow">
                      {o.label}
                      {o.hint && <span className="muted small block">{o.hint}</span>}
                    </span>
                  </button>
                </Info>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="muted">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** Pick N things from a list, shown as chips; each chip can be held for info. */
export function MultiPicker({
  label,
  values,
  options,
  max,
  onChange,
}: {
  label: string;
  values: string[];
  options: PickerOption[];
  max: number;
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const byValue = new Map(options.map((o) => [o.value, o]));
  const full = values.length >= max;
  return (
    <div className="picker">
      <span className="picker-label">
        {label} <span className={values.length === max ? 'ok-text' : 'muted'}>({values.length}/{max})</span>
      </span>
      <div className="chips">
        {values.map((v) => (
          <Info key={v} entry={byValue.get(v)?.info}>
            <span className="chip">
              {byValue.get(v)?.label ?? v}
              <button type="button" aria-label={`Remove ${byValue.get(v)?.label ?? v}`} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button>
            </span>
          </Info>
        ))}
        {!full && (
          <button type="button" className="chip add" onClick={() => setOpen(true)}>
            + {values.length === 0 ? `Choose ${max}` : 'Add'}
          </button>
        )}
        {full && (
          <button type="button" className="chip add" onClick={() => setOpen(true)}>Change</button>
        )}
      </div>
      {open && (
        <PickerList
          title={label}
          value={values}
          multi={{ count: values.length, max }}
          options={options.map((o) => ({ ...o, disabled: o.disabled || (full && !values.includes(o.value)) }))}
          searchable={options.length > 12}
          onPick={(v) => {
            const next = values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
            onChange(next.slice(0, max));
            if (max === 1 && !values.includes(v)) setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
