import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { InfoEntry } from '@dnd/shared';
import { BottomSheet } from './BottomSheet.tsx';

const HOLD_MS = 450;
const HOVER_MS = 300;

/**
 * Wraps something (a spell, an item, a dropdown option) so that holding a
 * finger on it (phone) or hovering it with the mouse (PC) shows its full
 * description. A normal tap/click still does whatever the child does.
 * Works inside disabled (read-only) sheets too, since it is a plain span.
 */
export function Info({
  entry,
  children,
  className,
  tapToOpen = false,
}: {
  entry: InfoEntry | null | undefined;
  children: ReactNode;
  className?: string;
  /** Also open on a plain tap/click (for text that does nothing else when tapped). */
  tapToOpen?: boolean;
}) {
  const [open, setOpen] = useState<null | 'sheet' | 'hover'>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(leaveTimer.current);
  }, []);

  if (!entry) return <span className={className}>{children}</span>;

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };

  return (
    <>
      <span
        ref={anchor}
        className={`info-target ${tapToOpen ? 'tappable' : ''} ${className ?? ''}`}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return;
          fired.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            fired.current = true;
            navigator.vibrate?.(15);
            setOpen('sheet');
          }, HOLD_MS);
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          clearTimeout(leaveTimer.current);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setOpen((o) => o ?? 'hover'), HOVER_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') {
            clearTimeout(timer.current);
            leaveTimer.current = setTimeout(() => setOpen((o) => (o === 'hover' ? null : o)), 150);
          } else cancel();
        }}
        // A finished long-press must not also count as a tap on the child.
        onClickCapture={(e) => {
          if (fired.current) {
            e.preventDefault();
            e.stopPropagation();
            fired.current = false;
          }
        }}
        onClick={tapToOpen ? () => setOpen('sheet') : undefined}
        role={tapToOpen ? 'button' : undefined}
        tabIndex={tapToOpen ? 0 : undefined}
        onKeyDown={tapToOpen ? (e) => (e.key === 'Enter' || e.key === ' ') && setOpen('sheet') : undefined}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </span>
      {open === 'sheet' && (
        <BottomSheet label={entry.title} onClose={() => setOpen(null)}>
          {(close) => (
            <>
              <InfoBody entry={entry} />
              <button className="secondary info-close" onClick={close}>Close</button>
            </>
          )}
        </BottomSheet>
      )}
      {open === 'hover' &&
        anchor.current &&
        createPortal(
          <HoverCard
            rect={anchor.current.getBoundingClientRect()}
            onEnter={() => clearTimeout(leaveTimer.current)}
            onLeave={() => setOpen(null)}
          >
            <InfoBody entry={entry} />
          </HoverCard>,
          document.body,
        )}
    </>
  );
}

function HoverCard({ rect, children, onEnter, onLeave }: { rect: DOMRect; children: ReactNode; onEnter: () => void; onLeave: () => void }) {
  const width = Math.min(380, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = rect.bottom + 6;
  const roomBelow = window.innerHeight - below;
  const style: React.CSSProperties =
    roomBelow > 260 || roomBelow > rect.top
      ? { left, top: below, width, maxHeight: roomBelow - 8 }
      : { left, bottom: window.innerHeight - rect.top + 6, width, maxHeight: rect.top - 14 };
  return (
    <div className="info-hover" style={style} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      {children}
    </div>
  );
}

export function InfoBody({ entry }: { entry: InfoEntry }) {
  return (
    <div className="info-body">
      <h3 className="info-title">{entry.title}</h3>
      {entry.subtitle && <p className="info-subtitle">{entry.subtitle}</p>}
      {entry.source && <p className="info-source">{entry.source}</p>}
      {entry.facts && entry.facts.length > 0 && (
        <dl className="info-facts">
          {entry.facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <RichText text={entry.body} />
    </div>
  );
}

/** Paragraphs from newlines, **bold** run-in headings. */
export function RichText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split('\n').filter((l) => l.trim()).map((line, i) => (
        <p key={i} className="info-p">
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part,
          )}
        </p>
      ))}
    </>
  );
}
