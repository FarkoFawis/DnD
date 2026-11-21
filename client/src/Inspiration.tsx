/**
 * Heroic Inspiration (2024 rules): a character has it or doesn't. The DM
 * hands it out (on the player's sheet), the player gives it up to reroll a
 * die. Its mark everywhere is the four-pointed star.
 */
import { useState } from 'react';
import { BottomSheet } from './BottomSheet.tsx';
import { burst } from './fx/fx.ts';
import { t } from './i18n.tsx';

export function InspirationStar({ className = '' }: { className?: string }) {
  return (
    <svg className={`insp-star ${className}`} viewBox="-12 -12 24 24" aria-hidden>
      <path d="M0-10.5C.9-3.4 3.4-.9 10.5 0 3.4.9.9 3.4 0 10.5-.9 3.4-3.4.9-10.5 0-3.4-.9-.9-3.4 0-10.5z" />
    </svg>
  );
}

/**
 * The token on the player's own sheet, there only while they hold Heroic
 * Inspiration. Tapping it asks before it is gone: it is used at the table,
 * right after a roll.
 */
export function InspirationToken({ has, onSpend }: { has: boolean; onSpend: () => Promise<boolean> }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      {has && (
        <button type="button" className="inspiration-token" onClick={() => setAsking(true)}>
          <InspirationStar />
          <span className="grow">
            <strong>{t('Heroic Inspiration')}</strong>
            <span className="small block">{t('Reroll one die.')} <span className="hint">{t('Tap to use it.')}</span></span>
          </span>
        </button>
      )}
      {asking && (
        <BottomSheet label={t('Heroic Inspiration')} onClose={() => setAsking(false)}>
          {(close) => (
            <>
              <h2 className="info-title">{t('Heroic Inspiration')}</h2>
              <p className="insp-rule">{t('Give it up to reroll one die right after you rolled it. You have to take the new roll.')}</p>
              <button
                type="button"
                className="primary wide"
                disabled={!has}
                onClick={async () => {
                  burst('feature');
                  if (await onSpend()) close();
                }}
              >
                {t('Use it now')}
              </button>
              <button type="button" className="ghost" onClick={close}>{t('Keep it')}</button>
            </>
          )}
        </BottomSheet>
      )}
    </>
  );
}
