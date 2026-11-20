import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useClosing } from './fx/hooks.ts';

/**
 * A sheet that slides up from the bottom of the screen over a dimmed page
 * (descriptions, the dice roller, "Who is fighting?"). Tapping outside it or
 * pressing Escape closes it; it slides back down before it is gone.
 * `children` gets `close` for its own Close button.
 */
export function BottomSheet(props: {
  label: string;
  onClose: () => void;
  className?: string;
  modal?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const { closing, close } = useClosing(props.onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return createPortal(
    <div className={`info-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div
        className={`info-sheet ${props.className ?? ''}`}
        role="dialog"
        aria-modal={props.modal || undefined}
        aria-label={props.label}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children(close)}
      </div>
    </div>,
    document.body,
  );
}
