/**
 * Character portraits: the uploaded picture, or a drawn default (a hooded
 * figure tinted by class) when there is none. Pictures are shrunk in the
 * browser before upload, so a phone photo becomes a few dozen kilobytes.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { CharacterData } from '@dnd/shared';
import { portraitUrl, removePortrait, uploadPortrait } from './api.ts';
import { t, tx } from './i18n.tsx';

/** Portraits are 2:3, like a playing card. */
const WIDTH = 400;
const HEIGHT = 600;

function hue(text: string): number {
  let h = 7;
  for (const ch of text.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** The picture shown when a character has no portrait. */
export function DefaultPortrait({ character: c }: { character: Pick<CharacterData, 'name' | 'className'> }) {
  const id = useId();
  const h = hue(c.className || c.name || 'adventurer');
  const initial = (c.name.trim()[0] ?? '?').toUpperCase();
  return (
    <svg className="portrait-img" viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" role="img" aria-label={t('{name} (no portrait yet)', { name: c.name || t('Character') })}>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="38%" r="75%">
          <stop offset="0%" stopColor={`hsl(${h} 45% 34%)`} />
          <stop offset="100%" stopColor={`hsl(${h} 50% 9%)`} />
        </radialGradient>
        <linearGradient id={`${id}-fig`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${h} 30% 20%)`} />
          <stop offset="100%" stopColor={`hsl(${h} 35% 7%)`} />
        </linearGradient>
      </defs>
      <rect width="200" height="300" fill={`url(#${id}-bg)`} />
      {/* hooded figure: hood, face shadow, shoulders */}
      <path d="M100 62c-30 0-46 26-46 58 0 18 6 30 14 38-30 10-52 34-58 72v70h180v-70c-6-38-28-62-58-72 8-8 14-20 14-38 0-32-16-58-46-58z" fill={`url(#${id}-fig)`} />
      <path d="M100 84c-18 0-28 16-28 36 0 22 12 38 28 38s28-16 28-38c0-20-10-36-28-36z" fill={`hsl(${h} 40% 5%)`} />
      <text x="100" y="134" textAnchor="middle" fontSize="40" style={{ fontFamily: 'var(--font-display)' }} fontWeight="700" fill={`hsl(${h} 60% 72%)`} opacity="0.9">{initial}</text>
    </svg>
  );
}

/** A character's portrait (or the default), filling its box. */
export function Portrait({ characterId, character, className = '' }: { characterId: string; character: Pick<CharacterData, 'name' | 'className' | 'portrait'>; className?: string }) {
  const url = portraitUrl(characterId, character.portrait);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`portrait ${className}`}>
      {url && failed !== url ? (
        <img className="portrait-img" src={url} alt={t("{name}'s portrait", { name: character.name || t('Character') })} loading="lazy" onError={() => setFailed(url)} />
      ) : (
        <DefaultPortrait character={character} />
      )}
    </span>
  );
}

/** Crops to 2:3 around the middle, shrinks, and re-encodes as JPEG. */
export async function shrinkPicture(file: Blob): Promise<Blob> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(t('That file is not a picture this phone can read.')));
      el.src = src;
    });
    const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('Could not prepare the picture.'));
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    // Keep the top of tall pictures (faces are usually there).
    ctx.drawImage(img, (WIDTH - w) / 2, Math.min(0, (HEIGHT - h) / 3), w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error(t('Could not prepare the picture.'));
    return blob;
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** A portrait with "Choose picture" / "Remove" under it. The caller decides what picking does. */
export function PortraitInput({
  preview,
  hasPicture,
  onPick,
  onRemove,
}: {
  preview: ReactNode;
  hasPicture: boolean;
  onPick: (picture: Blob) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Something went wrong.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="portrait-input">
      <div className="portrait-frame">{preview}</div>
      <div className="portrait-actions">
        <span className="muted small">{t('Portrait')}</span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void run(async () => onPick(await shrinkPicture(file)));
          }}
        />
        <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('Saving…') : hasPicture ? t('Change picture') : t('Choose picture')}
        </button>
        {hasPicture && (
          <button type="button" className="link" disabled={busy} onClick={() => void run(onRemove)}>{t('Remove')}</button>
        )}
        {error && <span className="error small">{tx(error)}</span>}
      </div>
    </div>
  );
}

/** Portrait of a saved character with upload and remove, for its owner. */
export function PortraitPicker({ characterId, character, onChanged }: { characterId: string; character: CharacterData; onChanged: () => void }) {
  return (
    <PortraitInput
      preview={<Portrait characterId={characterId} character={character} />}
      hasPicture={character.portrait !== ''}
      onPick={async (picture) => {
        await uploadPortrait(characterId, picture);
        onChanged();
      }}
      onRemove={async () => {
        await removePortrait(characterId);
        onChanged();
      }}
    />
  );
}

/** Portrait chooser for a character that isn't saved yet (the creator): keeps the picture until creation. */
export function NewPortraitInput({ character, value, onChange }: { character: Pick<CharacterData, 'name' | 'className'>; value: Blob | null; onChange: (picture: Blob | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return setUrl(null);
    const u = URL.createObjectURL(value);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);
  return (
    <PortraitInput
      preview={<span className="portrait">{url ? <img className="portrait-img" src={url} alt={t('Chosen portrait')} /> : <DefaultPortrait character={character} />}</span>}
      hasPicture={value !== null}
      onPick={(picture) => onChange(picture)}
      onRemove={() => onChange(null)}
    />
  );
}
