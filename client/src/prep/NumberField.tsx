import { useEffect, useState } from 'react';

/**
 * Whole-number input that is pleasant on phones: numeric keyboard, can be
 * emptied while typing, and only reports a value once it is a valid number.
 */
export function NumberField(props: {
  value: number | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /** Report the value only when the field loses focus or Enter is pressed. */
  commitOnBlur?: boolean;
  /** Called when the field is emptied (for values that may be missing). */
  onClear?: () => void;
}) {
  const { value, onChange, min = -9999, max = 9999, commitOnBlur, onClear } = props;
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);

  const parse = (t: string) => {
    if (!/^-?\d+$/.test(t.trim())) return null;
    return Math.max(min, Math.min(max, Number(t)));
  };
  const commit = () => {
    const n = parse(text);
    if (n === null) {
      if (text.trim() === '' && onClear && value !== null) onClear();
      else setText(value === null ? '' : String(value));
    } else if (n !== value) onChange(n);
    else setText(String(n));
  };

  return (
    <input
      className={props.className}
      aria-label={props['aria-label']}
      placeholder={props.placeholder}
      // "numeric" has no minus key on iOS; only offer it when negatives make no sense.
      inputMode={min >= 0 ? 'numeric' : 'text'}
      enterKeyHint="done"
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (commitOnBlur) return;
        if (n !== null && n !== value) onChange(n);
        else if (e.target.value.trim() === '' && value !== null) onClear?.();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
